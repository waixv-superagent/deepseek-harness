/** PTC execution plugin for the mounting Agent, preset, or deployment scope. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { PtcProgramFormat } from '@deepseek-ai/dsh-ptc-runtime'
import { RUN_CODE_NAME, ToolNotFoundError, defineTool, projectToolSchema } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecutor, ToolModelInput, ToolPromptSection, ToolBatchInput, ToolBatchResult } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline, executeToolBatch } from '@deepseek-ai/dsh-tools/pipeline'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { createRunCodeTool, requirePtcRuntime, type PtcSdkLanguage } from './ptc.ts'
import { renderToolsSdk, type ToolSdkSchema } from './ts-types.ts'
import { renderToolsSdkPy } from './py-types.ts'
import { Config } from './config.ts'
import { lazyToolNames } from './lazy.ts'

/** Reserved model-facing tool that serves an exact tool contract on demand. */
export const DESCRIBE_TOOLS_NAME = 'describe_tools'

const PTC_ONLY_INSTRUCTION = `\`${RUN_CODE_NAME}\` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.`

const PTC_ONLY_LAZY_INSTRUCTION = `\`${RUN_CODE_NAME}\` and \`${DESCRIBE_TOOLS_NAME}\` are the only tools you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside a program; call \`${DESCRIBE_TOOLS_NAME}\` when a compact binding's exact parameters matter.`

const LAZY_SDK_NOTE = `Some declarations above are compact: their argument and result types are \`JsonValue\`, and their exact parameters are not inlined. Call \`${DESCRIBE_TOOLS_NAME}\` with the tool name to read its description and input/output JSON Schema before using that binding.`

/** Longest original description kept on a compact declaration; the rest is one `describe_tools` call away. */
const COMPACT_DESCRIPTION_MAX = 240

/** Drop a tool's inline schema and mark the declaration as describe-on-demand. */
function compactSdkSchema(schema: ToolSdkSchema): ToolSdkSchema {
  const note = `compact declaration: call \`${DESCRIBE_TOOLS_NAME}\` with this name to read the exact parameters`
  const original = schema.description.length > COMPACT_DESCRIPTION_MAX
    ? `${schema.description.slice(0, COMPACT_DESCRIPTION_MAX)}…`
    : schema.description
  return {
    name: schema.name,
    description: original.length > 0 ? `${original} (${note})` : note,
    parameters: {},
    output: {},
  }
}

/**
 * Build the direct `describe_tools` transport. It is exposed only while at
 * least one visible tool is selected by `lazyTools`, so configurations with no
 * compact declarations keep the single-`run_code` surface.
 * @param ctx - context owning the tool registry lookup.
 * @returns the transport definition.
 */
function createDescribeTool(ctx: Context): ToolDefinition {
  return defineTool({
    name: DESCRIBE_TOOLS_NAME,
    description: 'Return one visible tool\'s exact contract: its description, input JSON Schema, and output JSON Schema. Use it before calling a compact SDK binding, whose declaration uses `JsonValue` instead of the exact parameter type.',
    parameters: {
      name: { type: 'string', required: true, description: 'Exact tool name as declared in the SDK.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      const definition = ctx.tools.executable(args.name, exec.agent, exec.toolSet)
      if (definition === undefined) {
        throw new Error(`tool "${args.name}" is not visible in this scope; use a name declared in the SDK`)
      }
      return {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        output: definition.output.schema,
      } as unknown as JsonValue
    },
    presentCall: args => ({
      card: 'generic',
      title: `Describe ${args.name}`,
      kind: 'search',
      rawInput: args.name,
    }),
  })
}

const SDK_RENDERERS = {
  typescript: renderToolsSdk,
  python: renderToolsSdkPy,
} satisfies Record<PtcSdkLanguage, (schemas: readonly ToolSdkSchema[], programFormat: PtcProgramFormat) => string>

/** Runs programs whose nested tool calls use the shared guarded invocation pipeline. */
export class PtcExecutor implements ToolExecutor {
  readonly sections: readonly ToolPromptSection[]
  private readonly pipeline: ToolExecutionPipeline
  private readonly maxParallelSubCalls: number
  private readonly lazyTools: readonly string[]
  private ptcTransport: ToolDefinition | undefined
  private describeTool: ToolDefinition | undefined

  constructor(private readonly ctx: Context, config: Partial<Config> = {}, private readonly maxParallel: () => number = () => 10) {
    const resolved = Config(config)
    this.maxParallelSubCalls = resolved.maxParallelSubCalls
    this.lazyTools = resolved.lazyTools
    const tools = ctx.tools
    this.sections = [
      { name: 'tools:ptc-only', order: ctx.systemPrompt.getSectionOrder('PTC_ONLY'), text: tools => this.renderPtcOnly(tools), interpolate: false },
      { name: 'tools:sdk', order: ctx.systemPrompt.getSectionOrder('TOOLS_SDK'), text: tools => this.renderSdk(tools), interpolate: false },
    ]
    this.pipeline = new ToolExecutionPipeline(ctx, {
      get: (name, scope, toolSet) => name === RUN_CODE_NAME
        ? this.requirePtcTransport()
        : name === DESCRIBE_TOOLS_NAME ? this.requireDescribeTool() : tools.executable(name, scope, toolSet),
      reject: (name, nested) => !nested && name !== RUN_CODE_NAME && name !== DESCRIBE_TOOLS_NAME
        ? new ToolNotFoundError(name, `\`${name}\` is not callable directly — call it from inside a \`${RUN_CODE_NAME}\` program instead`)
        : undefined,
    })
  }

  describe(tools: readonly ToolDefinition[]): ToolModelInput {
    const schemas = [projectToolSchema(this.requirePtcTransport(), false)]
    if (this.compactTools(tools).size > 0) schemas.push(projectToolSchema(this.requireDescribeTool(), false))
    return { schemas, knownNames: schemas.map(schema => schema.name) }
  }

  private renderPtcOnly(tools: readonly ToolDefinition[]): string {
    return this.compactTools(tools).size === 0 ? PTC_ONLY_INSTRUCTION : PTC_ONLY_LAZY_INSTRUCTION
  }

  private renderSdk(tools: readonly ToolDefinition[]): string {
    const runtime = requirePtcRuntime(this.ctx)
    const render = SDK_RENDERERS[runtime.language]
    const compact = this.compactTools(tools)
    const schemas = tools.map((definition) => {
      const schema: ToolSdkSchema = {
        ...projectToolSchema(definition, false),
        output: definition.output.schema,
      }
      return compact.has(definition.name) ? compactSdkSchema(schema) : schema
    })
    const sdk = render(schemas, runtime.programFormat)
    return compact.size === 0 ? sdk : `${sdk}\n\n${LAZY_SDK_NOTE}`
  }

  /** Names whose declarations stay compact under this executor's configuration. */
  private compactTools(tools: readonly ToolDefinition[]): ReadonlySet<string> {
    return lazyToolNames(tools, this.lazyTools)
  }

  execute(input: ToolBatchInput): Promise<ToolBatchResult> {
    return executeToolBatch(input, this.pipeline, this.maxParallel)
  }

  /** Keep the reserved transport outside registered capabilities and their restrictions. */
  private requirePtcTransport(): ToolDefinition {
    this.ptcTransport ??= createRunCodeTool(this.ctx, this.pipeline, this.maxParallelSubCalls)
    return this.ptcTransport
  }

  /** Keep the on-demand contract transport outside registered capabilities. */
  private requireDescribeTool(): ToolDefinition {
    this.describeTool ??= createDescribeTool(this.ctx)
    return this.describeTool
  }
}

export { Config } from './config.ts'
export { CodeRunFailedError } from './errors.ts'
export type { PtcDispatchLog } from './runtime-types.ts'
export type { PtcDispatchStartEventData, PtcDispatchEventData } from './types.ts'
export { jsonSchemaToTs, renderToolsSdk, type ToolSdkSchema } from './ts-types.ts'
export { jsonSchemaToPy, renderToolsSdkPy } from './py-types.ts'

/** Cordis plugin name. */
export const name = 'ptc-tool-executor'
/** Activate the executor only while its registry, prompt service, and runtime are available. */
export const inject = ['tools', 'systemPrompt', 'ptcRuntime']

/**
 * Select PTC execution in the mounting scope.
 * @param ctx - context owning this executor's selection and lifetime.
 * @param config - program subcall concurrency limits.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.setExecutor(new PtcExecutor(ctx, config))
}
