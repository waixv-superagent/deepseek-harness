/** Configuration shared by plugin mounting and direct executor construction. @module */
import z from '@deepseek-ai/schemastery'

/** Program execution limits and SDK presentation controls. */
export interface Config {
  /** Maximum overlapping concurrency-safe program subcalls. */
  maxParallelSubCalls: number
  /**
   * Tool-name patterns whose SDK declarations stay compact: `*` matches any
   * run of characters and `?` matches one character. A compact declaration
   * keeps the generic `JsonValue` argument and result types and drops the
   * inline schema; `describe_tools` serves the exact schema on demand.
   */
  lazyTools: string[]
}

/** Validated program subcall concurrency and compact-SDK selection. */
export const Config: z<Partial<Config>, Config> = z.object({
  maxParallelSubCalls: z.natural().min(1).default(10),
  lazyTools: z.array(z.string()).default([]),
})
