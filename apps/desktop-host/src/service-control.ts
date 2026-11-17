/** Loopback control channel for a shell that attached to a Host whose owning shell exited. */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { DesktopQuitInspection } from './quit-inspection.ts'
import type { LocalDragResource } from './file-drag.ts'

/** Operations the owning Desktop shell may request over the control channel. */
export interface DesktopControlOperations {
  /** What quitting the Host now would interrupt. */
  readonly inspect: () => Promise<DesktopQuitInspection>
  /** Update admission and task inspection, exactly as the IPC control exposes them. */
  readonly updateTasks: (action: 'inspect' | 'lock' | 'unlock') => Promise<boolean>
  /** Authorize a Session-scoped local file for a drag started by the shell. */
  readonly dragResource: (address: string, signal: AbortSignal) => Promise<LocalDragResource | null>
  /** Latest private Platform credential snapshot for embedded views; null after sign-out. */
  readonly platformSession: () => unknown
  /** Ask the Host to shut down; the answer has already been sent when this runs. */
  readonly shutdown: () => void
}

/** One running control endpoint. `token` is written only to the discovery file. */
export interface DesktopControlServer {
  readonly port: number
  readonly token: string
  close(): Promise<void>
}

const MAX_BODY_BYTES = 64 * 1024
const AUTHORIZATION_PREFIX = 'Bearer '

/** Constant-time bearer check; a length mismatch still costs a comparison. */
function authorized(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith(AUTHORIZATION_PREFIX)) return false
  const supplied = Buffer.from(header.slice(AUTHORIZATION_PREFIX.length))
  const expected = Buffer.from(token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

/** Read at most `MAX_BODY_BYTES`; a larger body destroys the request instead of buffering it. */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('control request body is too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    request.on('error', reject)
  })
}

/** Parse a JSON object body, or `{}` for an empty one. */
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const text = (await readBody(request)).trim()
  if (text === '') return {}
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('control request body must be a JSON object')
  return parsed as Record<string, unknown>
}

/** Write one JSON answer. */
function reply(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  response.end(text)
}

/**
 * Parse the update action without trusting the caller's type.
 * @param value - request field.
 * @returns the action, or undefined for an invalid one.
 */
function updateAction(value: unknown): 'inspect' | 'lock' | 'unlock' | undefined {
  return value === 'inspect' || value === 'lock' || value === 'unlock' ? value : undefined
}

/**
 * Start the authenticated control endpoint on a loopback port.
 * The Host writes `port` and `token` into its discovery file; no other process learns the
 * token, and every request carries it as a bearer credential.
 * @param operations - Host-owned operations the endpoint may invoke.
 * @returns the bound port and closing handle.
 */
export async function startDesktopControlServer(operations: DesktopControlOperations): Promise<DesktopControlServer> {
  const token = randomBytes(32).toString('base64url')
  const pending = new Set<AbortController>()
  const server = createServer((request, response) => {
    void (async () => {
      if (!authorized(request.headers.authorization, token)) {
        reply(response, 401, { error: 'unauthorized' })
        return
      }
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (request.method === 'GET' && path === '/health') {
        reply(response, 200, { ok: true, pid: process.pid })
        return
      }
      if (request.method === 'GET' && path === '/platform-session') {
        reply(response, 200, { session: operations.platformSession() })
        return
      }
      if (request.method === 'POST' && path === '/inspect') {
        reply(response, 200, await operations.inspect())
        return
      }
      if (request.method === 'POST' && path === '/update-tasks') {
        const body = await readJson(request)
        const action = updateAction(body.action)
        if (action === undefined) { reply(response, 400, { error: 'invalid action' }); return }
        reply(response, 200, { active: await operations.updateTasks(action) })
        return
      }
      if (request.method === 'POST' && path === '/file-drag-resource') {
        const body = await readJson(request)
        if (typeof body.address !== 'string' || body.address.length === 0) { reply(response, 400, { error: 'invalid address' }); return }
        const cancellation = new AbortController()
        pending.add(cancellation)
        response.once('close', () => { cancellation.abort() })
        try {
          reply(response, 200, { resource: await operations.dragResource(body.address, cancellation.signal) })
        } finally { pending.delete(cancellation) }
        return
      }
      if (request.method === 'POST' && path === '/shutdown') {
        reply(response, 202, { stopping: true })
        setImmediate(operations.shutdown)
        return
      }
      reply(response, 404, { error: 'unknown operation' })
    })().catch((error: unknown) => {
      if (response.headersSent) { response.destroy(); return }
      reply(response, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const port = (server.address() as AddressInfo).port
  return {
    port,
    token,
    close: async () => {
      for (const cancellation of pending) cancellation.abort()
      pending.clear()
      // Fetch keep-alive sockets would otherwise hold close() open.
      server.closeIdleConnections()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}
