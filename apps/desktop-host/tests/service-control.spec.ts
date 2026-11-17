import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDesktopControlServer, type DesktopControlOperations, type DesktopControlServer } from '../src/service-control.ts'

let server: DesktopControlServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

/** A fake operation set plus the shutdown mock the endpoint test asserts on. */
interface FakeOperations {
  readonly operations: DesktopControlOperations
  readonly shutdown: ReturnType<typeof vi.fn>
}

function operations(): FakeOperations {
  const shutdown = vi.fn()
  return {
    operations: {
      inspect: async () => ({ activeTasks: true, scheduledTasks: false }),
      updateTasks: async action => action === 'inspect',
      dragResource: async () => ({ path: 'C:/work/a.png', sha256: 'a'.repeat(64), size: 3 }),
      platformSession: () => ({ origin: 'https://platform.example', token: 'token' }),
      shutdown,
    },
    shutdown,
  }
}

async function start(): Promise<{ base: string; token: string; ops: FakeOperations }> {
  const ops = operations()
  server = await startDesktopControlServer(ops.operations)
  return { base: `http://127.0.0.1:${String(server.port)}`, token: server.token, ops }
}

function authenticated(base: string, token: string, path: string, method = 'GET', body?: unknown): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

describe('desktop Host control endpoint', () => {
  it('refuses a request without the discovery token', async () => {
    const { base } = await start()
    expect((await fetch(`${base}/health`)).status).toBe(401)
  })

  it('answers health, quit inspection, task admission and the platform session', async () => {
    const { base, token, ops } = await start()
    expect(await (await authenticated(base, token, '/health')).json()).toMatchObject({ ok: true, pid: process.pid })
    expect(await (await authenticated(base, token, '/inspect', 'POST')).json()).toEqual({ activeTasks: true, scheduledTasks: false })
    expect(await (await authenticated(base, token, '/update-tasks', 'POST', { action: 'inspect' })).json()).toEqual({ active: true })
    expect((await authenticated(base, token, '/update-tasks', 'POST', { action: 'wrong' })).status).toBe(400)
    expect(await (await authenticated(base, token, '/platform-session')).json()).toEqual({
      session: { origin: 'https://platform.example', token: 'token' },
    })
    expect(ops.operations.updateTasks).toBeTypeOf('function')
  })

  it('authorizes one Session-scoped drag resource', async () => {
    const { base, token } = await start()
    expect(await (await authenticated(base, token, '/file-drag-resource', 'POST', { address: 'session:one/a.png' })).json()).toEqual({
      resource: { path: 'C:/work/a.png', sha256: 'a'.repeat(64), size: 3 },
    })
    expect((await authenticated(base, token, '/file-drag-resource', 'POST', { address: 4 })).status).toBe(400)
  })

  it('acknowledges a shutdown before tearing down', async () => {
    const { base, token, ops } = await start()
    const response = await authenticated(base, token, '/shutdown', 'POST')
    expect(response.status).toBe(202)
    await vi.waitFor(() => { expect(ops.shutdown).toHaveBeenCalledOnce() })
  })

  it('rejects an unknown operation', async () => {
    const { base, token } = await start()
    expect((await authenticated(base, token, '/unknown', 'POST')).status).toBe(404)
  })
})
