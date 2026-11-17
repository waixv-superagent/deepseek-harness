import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  parseRemoteWebUrl, probeRemoteWeb, remoteWebCandidates, resolveRemoteWebTarget, REMOTE_WEB_FILE_ENV,
  REMOTE_WEB_URL_ENV, type ReadText,
} from '../src/remote-web.ts'

function files(entries: Record<string, string>): ReadText {
  return async (path) => {
    if (!(path in entries)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return entries[path]!
  }
}

const profile = resolve('C:/dsh/profiles/desktop')
const profileFile = join(profile, 'remote-web.url')

describe('remote Web URL configuration', () => {
  it('accepts HTTP(S) URLs without credentials and rejects everything else', () => {
    expect(parseRemoteWebUrl('http://127.0.0.1:3082/?token=abc')).toBe('http://127.0.0.1:3082/?token=abc')
    expect(parseRemoteWebUrl('https://host.example/dsh/')).toBe('https://host.example/dsh/')
    expect(parseRemoteWebUrl('ftp://host/file')).toBeUndefined()
    expect(parseRemoteWebUrl('http://user:pass@host/')).toBeUndefined()
    expect(parseRemoteWebUrl('not a url')).toBeUndefined()
  })

  it('prefers the environment URL over the profile file', async () => {
    const readText = vi.fn<ReadText>(files({ [profileFile]: 'http://127.0.0.1:1/' }))
    const candidates = await remoteWebCandidates({
      env: { [REMOTE_WEB_URL_ENV]: 'http://127.0.0.1:2/?token=t' }, profileDir: profile, readText,
    })
    expect(candidates).toEqual(['http://127.0.0.1:2/?token=t'])
    expect(readText).not.toHaveBeenCalled()
  })

  it('rejects an environment URL that is not HTTP(S)', async () => {
    await expect(remoteWebCandidates({ env: { [REMOTE_WEB_URL_ENV]: 'ftp://host/' }, profileDir: profile }))
      .rejects.toThrow('DSH_DESKTOP_REMOTE_WEB_URL is not an HTTP(S) URL')
  })

  it('keeps the bundled Host when the profile names no file', async () => {
    await expect(remoteWebCandidates({ env: {}, profileDir: profile, readText: files({}) })).resolves.toEqual([])
  })

  it('reads configured URLs in file order and follows one indirection', async () => {
    const readText = files({
      [profileFile]: '# local first\nhttp://127.0.0.1:3082/?token=local\n@C:/dsh/superagent.url\n',
      [resolve('C:/dsh/superagent.url')]: 'https://gateway.example:9443/?token=remote\n',
    })
    await expect(remoteWebCandidates({ env: {}, profileDir: profile, readText })).resolves.toEqual([
      'http://127.0.0.1:3082/?token=local', 'https://gateway.example:9443/?token=remote',
    ])
  })

  it('honors a configured file path', async () => {
    const readText = files({ [resolve('C:/deploy/service.url')]: 'http://127.0.0.1:9000/?token=x\n' })
    await expect(remoteWebCandidates({
      env: { [REMOTE_WEB_FILE_ENV]: resolve('C:/deploy/service.url') }, profileDir: profile, readText,
    })).resolves.toEqual(['http://127.0.0.1:9000/?token=x'])
  })

  it('reports a malformed line, an empty file, and a second indirection', async () => {
    await expect(remoteWebCandidates({
      env: {}, profileDir: profile, readText: files({ [profileFile]: 'nonsense\n' }),
    })).rejects.toThrow('invalid URL')
    await expect(remoteWebCandidates({
      env: {}, profileDir: profile, readText: files({ [profileFile]: '# only comments\n' }),
    })).rejects.toThrow('names no URL')
    await expect(remoteWebCandidates({
      env: {},
      profileDir: profile,
      readText: files({
        [profileFile]: '@C:/dsh/a.url\n',
        [resolve('C:/dsh/a.url')]: '@C:/dsh/b.url\n',
        [resolve('C:/dsh/b.url')]: 'http://127.0.0.1:1/\n',
      }),
    })).rejects.toThrow('indirection depth')
  })

  it('displays the first candidate that answers', async () => {
    const probe = vi.fn(async (url: string) => url.includes(':2/'))
    await expect(resolveRemoteWebTarget({
      env: {}, profileDir: profile, readText: files({
        [profileFile]: 'http://127.0.0.1:1/\nhttp://127.0.0.1:2/\n',
      }),
    }, probe)).resolves.toBe('http://127.0.0.1:2/')
    expect(probe.mock.calls.map(call => call[0])).toEqual(['http://127.0.0.1:1/', 'http://127.0.0.1:2/'])
  })

  it('keeps the bundled Host when no candidate answers', async () => {
    await expect(resolveRemoteWebTarget({
      env: { [REMOTE_WEB_URL_ENV]: 'http://127.0.0.1:1/' }, profileDir: profile,
    }, async () => false)).resolves.toBeUndefined()
  })
})

describe('remote Web host probe', () => {
  it('accepts a redirect to the authenticated page', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 303 })) as unknown as typeof fetch
    await expect(probeRemoteWeb('http://127.0.0.1:3082/?token=t', fetchImpl)).resolves.toBe(true)
  })

  it('rejects an error status and an unreachable host', async () => {
    await expect(probeRemoteWeb('http://127.0.0.1:3082/', async () => new Response(null, { status: 401 })))
      .resolves.toBe(false)
    await expect(probeRemoteWeb('http://127.0.0.1:3082/', async () => { throw new Error('ECONNREFUSED') }))
      .resolves.toBe(false)
  })
})
