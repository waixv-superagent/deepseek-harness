import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopHostDiscoverySchema, desktopHostDiscoveryPath, probeDesktopHost, readDesktopHostDiscovery,
  requestDesktopControl, sameDirectory, type DesktopHostDiscovery,
} from '../src/host-discovery.ts'

const directories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-host-discovery-'))
  directories.push(directory)
  return directory
}

const STARTED_AT = '2026-11-17T12:00:00.000Z'

function discovery(overrides: Partial<DesktopHostDiscovery> = {}): DesktopHostDiscovery {
  return {
    version: 1,
    pid: process.pid,
    url: 'http://127.0.0.1:4321/?token=abc',
    injections: [],
    startedAt: STARTED_AT,
    control: { port: 4322, token: 'x'.repeat(43) },
    projectDir: 'C:/profiles/desktop',
    runtimeDir: 'C:/app/dsh',
    clientVersion: '0.2.2-alpha.3',
    ...overrides,
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('discovery records', () => {
  it('reads a well-formed record and ignores malformed ones', async () => {
    const directory = await temporaryDirectory()
    const path = desktopHostDiscoveryPath(directory)
    await mkdir(join(directory, 'desktop'), { recursive: true })
    await writeFile(path, 'not json')
    expect(await readDesktopHostDiscovery(path)).toBeUndefined()
    await writeFile(path, JSON.stringify(discovery()))
    expect(await readDesktopHostDiscovery(path)).toEqual(discovery())
    await writeFile(path, JSON.stringify({ ...discovery(), version: 2 }))
    expect(await readDesktopHostDiscovery(path)).toBeUndefined()
  })

  it('rejects a token too short to be a credential', () => {
    expect(DesktopHostDiscoverySchema.safeParse(discovery({ control: { port: 1, token: 'short' } })).success).toBe(false)
  })

  it('compares directories by platform path semantics', () => {
    expect(sameDirectory('C:/Profiles/Desktop', 'c:\\profiles\\desktop')).toBe(process.platform === 'win32')
  })
})

describe('probing a discovered Host', () => {
  const expected = { projectDir: 'C:/profiles/desktop', runtimeDir: 'C:/app/dsh', clientVersion: '0.2.2-alpha.3' }

  it('attaches only after the authenticated control port answers', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true, pid: process.pid }))
    vi.stubGlobal('fetch', fetch)
    await expect(probeDesktopHost(discovery(), expected)).resolves.toEqual({ live: true, discovery: discovery() })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('refuses a dead process without a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const dead = discovery({ pid: 999_999 })
    expect(await probeDesktopHost(dead, expected)).toEqual({ live: false, discovery: dead, reason: 'dead' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuses another profile and another build before a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const record = discovery()
    expect(await probeDesktopHost(record, { ...expected, projectDir: 'D:/other' })).toEqual({ live: false, discovery: record, reason: 'profile-mismatch' })
    expect(await probeDesktopHost(record, { ...expected, clientVersion: 'other' })).toEqual({ live: false, discovery: record, reason: 'build-mismatch' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('treats an unreachable or rejecting control port as not live', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED') }))
    expect((await probeDesktopHost(discovery(), expected)).live).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)))
    const refused = await probeDesktopHost(discovery(), expected)
    expect(refused.live).toBe(false)
    if (!refused.live) expect(refused.reason).toBe('unreachable')
  })
})

describe('control requests', () => {
  it('carry the discovery token and parsed JSON body', async () => {
    const fetch = vi.fn(async () => jsonResponse({ active: true }))
    vi.stubGlobal('fetch', fetch)
    await expect(requestDesktopControl(discovery(), 'POST', '/update-tasks', { action: 'inspect' })).resolves.toEqual({ active: true })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:4322/update-tasks')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: `Bearer ${'x'.repeat(43)}` })
    expect(init.body).toBe(JSON.stringify({ action: 'inspect' }))
  })

  it('surface a non-success answer as an error without leaking the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 403 })))
    await expect(requestDesktopControl(discovery(), 'GET', '/health')).rejects.toThrow(/403/)
  })
})
