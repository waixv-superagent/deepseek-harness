/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * Whether the SDK rejected a request because the server no longer knows the
 * session id that request carried.
 */
function isExpiredSession(error: unknown): boolean {
  return error instanceof StreamableHTTPError && error.code === 404
}

/**
 * Streamable HTTP transport that turns a dropped server session into a close
 * signal.
 *
 * The transport specification requires a client whose request carries a session
 * id to start a new session when the server answers 404. The MCP SDK throws
 * that 404 to the caller without firing `onclose`, so the connection supervisor
 * never observes the dead generation and every later call fails the same way —
 * the state a restarted MCP server leaves behind. Signalling close routes the
 * failure into the supervisor's reconnect path, whose next attempt builds a new
 * transport and therefore initializes a new session.
 */
class SessionRecoveringStreamableHTTPTransport extends StreamableHTTPClientTransport {
  override async send(
    message: JSONRPCMessage | JSONRPCMessage[],
    options?: { resumptionToken?: string; onresumptiontoken?: (token: string) => void },
  ): Promise<void> {
    // Only a request that carried a session id can prove the session died; a
    // 404 without one is an unreachable endpoint, which the connect path
    // already reports as a failed attempt.
    const hadSession = this.sessionId !== undefined
    try {
      await super.send(message, options)
    } catch (error) {
      if (hadSession && isExpiredSession(error)) this.signalClose()
      throw error
    }
  }

  /**
   * Fire `onclose` on a macrotask so the request that observed the expired
   * session rejects with its own 404 first; closing synchronously would make
   * the SDK reject that request with a generic connection-closed error instead.
   */
  private signalClose(): void {
    const timer = setTimeout(() => { this.onclose?.() }, 0)
    timer.unref()
  }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      // The MCP SDK transport declares its optional callbacks without
      // `| undefined`, which exactOptionalPropertyTypes rejects against the
      // Transport interface; the cast records only that widening.
      return new SessionRecoveringStreamableHTTPTransport(
        new URL(config.url),
        { requestInit: { headers: config.headers } },
      ) as Transport
  }
}
