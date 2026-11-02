/**
 * Tests for Streamable HTTP session recovery: a request whose session the
 * server has dropped (404) must signal a close so the connection supervisor
 * rebuilds the connection, while a 404 without a session and every other
 * failure must leave the generation alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { createTransport } from '@deepseek-ai/dsh-mcp-client/src/transport.ts'
import type { Config } from '@deepseek-ai/dsh-mcp-client'

const SESSION_ID = 'session-abc'

const initialize: JSONRPCMessage = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
}

const list: JSONRPCMessage = { jsonrpc: '2.0', id: 2, method: 'tools/list' }

function httpConfig(): Config {
  return {
    transport: 'streamable-http',
    serverName: 'srv',
    url: 'http://127.0.0.1:1/mcp',
    headers: {},
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
}

/** A successful initialize response that opens `SESSION_ID`. */
function initializeResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake', version: '1.0.0' } },
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': SESSION_ID } },
  )
}

/** The response the fixture server sends once it has forgotten the session. */
function expiredSessionResponse(): Response {
  return new Response('Streamable HTTP session not found', { status: 404 })
}

/**
 * Stub global fetch before the transport exists: the factory passes a
 * `requestInit`, so the SDK captures the fetch function at construction.
 *
 * @param handler - Response for one request, given the session id it carried.
 * @returns The transport under test and the session id of each request.
 */
function stubServer(handler: (session: string | null) => Response | Promise<Response>): {
  transport: Transport
  sessions: Array<string | null>
} {
  const sessions: Array<string | null> = []
  vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit): Promise<Response> => {
    const session = new Headers(init?.headers).get('mcp-session-id')
    sessions.push(session)
    return await handler(session)
  })
  return { transport: createTransport(httpConfig()), sessions }
}

function macrotask(): Promise<void> {
  const gate: PromiseWithResolvers<void> = Promise.withResolvers()
  setTimeout(gate.resolve, 0)
  return gate.promise
}

afterEach(() => { vi.unstubAllGlobals() })

describe('streamable-http session recovery', () => {
  it('signals close after the server drops the session', async () => {
    const { transport, sessions } = stubServer(session => session === null ? initializeResponse() : expiredSessionResponse())
    const onclose = vi.fn()
    transport.onclose = onclose
    await transport.send(initialize)
    await expect(transport.send(list)).rejects.toThrow('Streamable HTTP session not found')
    expect(sessions).toEqual([null, SESSION_ID])
    // The close signal waits for a macrotask, so this call's own 404 lands first.
    expect(onclose).not.toHaveBeenCalled()
    await macrotask()
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  it('leaves the generation alone for a 404 without a session', async () => {
    const { transport, sessions } = stubServer(() => expiredSessionResponse())
    const onclose = vi.fn()
    transport.onclose = onclose
    await expect(transport.send(list)).rejects.toThrow('Streamable HTTP session not found')
    expect(sessions).toEqual([null])
    await macrotask()
    expect(onclose).not.toHaveBeenCalled()
  })

  it('leaves the generation alone for a non-404 rejection', async () => {
    const { transport, sessions } = stubServer(session => session === null
      ? initializeResponse()
      : new Response('boom', { status: 500 }))
    const onclose = vi.fn()
    transport.onclose = onclose
    await transport.send(initialize)
    await expect(transport.send(list)).rejects.toThrow('boom')
    expect(sessions).toEqual([null, SESSION_ID])
    await macrotask()
    expect(onclose).not.toHaveBeenCalled()
  })

  it('leaves the generation alone for a transport-level failure', async () => {
    const { transport } = stubServer((session) => {
      if (session === null) return initializeResponse()
      throw new TypeError('fetch failed')
    })
    const onclose = vi.fn()
    transport.onclose = onclose
    await transport.send(initialize)
    await expect(transport.send(list)).rejects.toThrow('fetch failed')
    await macrotask()
    expect(onclose).not.toHaveBeenCalled()
  })

  it('tolerates an expired session when no close callback is installed', async () => {
    const { transport } = stubServer(session => session === null ? initializeResponse() : expiredSessionResponse())
    await transport.send(initialize)
    await expect(transport.send(list)).rejects.toThrow('Streamable HTTP session not found')
    await macrotask()
  })
})
