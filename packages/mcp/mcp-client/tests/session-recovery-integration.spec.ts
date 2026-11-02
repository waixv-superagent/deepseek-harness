/**
 * End-to-end session recovery over a real Streamable HTTP server: a server that
 * forgets the session it issued must not leave the plugin permanently broken.
 * The supervisor rebuilds the connection, the server issues a new session, and
 * the tools serve again under the same public names.
 */
import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { apply } from '@deepseek-ai/dsh-mcp-client/src/index.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

const testToolSignal = new AbortController().signal

/** Sessions the fixture still remembers; clearing it simulates a restarted server. */
const sessions = new Map<string, StreamableHTTPServerTransport>()
/** Fixture objects to close after the suite. */
const fixtureServers: Array<{ transport: StreamableHTTPServerTransport; server: McpServer }> = []

let ctx: Context
let httpServer: Server
let callSeq = 0

function nextCallId(): ToolCallId {
  return ToolCallId(`session-recovery-${++callSeq}`)
}

function sleep(ms: number): Promise<void> {
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  setTimeout(gate.resolve, ms)
  return gate.promise
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await sleep(25)
  }
  throw new Error('condition not met before the deadline')
}

async function mountRegistry(): Promise<Context> {
  const mounted = new Context()
  await mounted.plugin(SystemPrompt)
  await mounted.plugin(ToolRuntime)
  return mounted
}

/** Call the fixture tool and return its text, or throw when it did not succeed. */
async function callPing(): Promise<string> {
  const result = await ctx.tools.execute({
    signal: testToolSignal,
    callId: nextCallId(),
    name: 'mcp__recover__ping',
    arguments: {},
  })
  if (result.isError) throw new Error('ping returned an error result')
  const part = result.content[0]
  if (part === undefined || part.type !== 'text') throw new Error('ping returned no text part')
  return part.text
}

/**
 * Stateful MCP endpoint: one session per `initialize`, and a 404 for any later
 * request whose session the fixture no longer holds.
 */
async function handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const header = req.headers['mcp-session-id']
  const sessionId = Array.isArray(header) ? header[0] : header
  if (sessionId !== undefined) {
    const known = sessions.get(sessionId)
    if (known === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Streamable HTTP session not found')
      return
    }
    await known.handleRequest(req, res)
    return
  }
  let issued: string | undefined
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => {
      issued = randomUUID()
      return issued
    },
  })
  const server = new McpServer({ name: 'session-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.registerTool('ping', { description: 'Replies pong.', inputSchema: {} }, async () => ({
    content: [{ type: 'text', text: 'pong' }],
  }))
  await server.connect(transport as Transport)
  await transport.handleRequest(req, res)
  // Record the session only after the response carried its id.
  if (issued !== undefined) sessions.set(issued, transport)
  fixtureServers.push({ transport, server })
}

describe('streamable-http session recovery', () => {
  beforeAll(async () => {
    httpServer = createServer((req, res) => {
      handleMcpRequest(req, res).catch((error: unknown) => { res.writeHead(500).end(String(error)) })
    })
    const listening: PromiseWithResolvers<void> = Promise.withResolvers()
    httpServer.listen(0, '127.0.0.1', listening.resolve)
    await listening.promise
    const address = httpServer.address()
    if (address === null || typeof address === 'string') throw new Error(`expected a TCP AddressInfo, got ${String(address)}`)
    ctx = await mountRegistry()
    const config: Config = {
      transport: 'streamable-http',
      serverName: 'recover',
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: {},
      toolCallTimeoutMs: 5_000,
      failOnStartupError: true,
      reconnect: { enabled: true, initialDelayMs: 10, maxDelayMs: 50, maxAttempts: 10 },
    }
    await apply(ctx, config)
  }, 30_000)

  afterAll(async () => {
    await ctx.fiber.dispose()
    for (const entry of fixtureServers) {
      await entry.transport.close().catch(() => undefined)
      await entry.server.close().catch(() => undefined)
    }
    const closed: PromiseWithResolvers<void> = Promise.withResolvers()
    httpServer.close(() => { closed.resolve() })
    await closed.promise
  })

  it('reconnects with a new session after the server forgets the old one', async () => {
    expect(await callPing()).toBe('pong')
    const firstSession = [...sessions.keys()][0]
    expect(firstSession).toBeDefined()
    // The server restarts its session table: the old session id now 404s, and
    // no connection closes, which is what a restarted MCP server looks like.
    sessions.clear()
    expect(await callPing().catch(() => undefined)).not.toBe('pong')
    await waitFor(async () => await callPing().catch(() => undefined) === 'pong')
    expect([...sessions.keys()]).not.toContain(firstSession)
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('mcp__recover__ping')
  }, 30_000)
})
