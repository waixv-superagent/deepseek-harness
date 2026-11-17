import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeRemoteUrl, readRemoteEndpoint, remoteEndpointPath, sameRemoteOrigin, writeRemoteEndpoint,
} from '../src/remote-endpoint.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-endpoint-'))
  directories.push(directory)
  return directory
}

describe('remote addresses', () => {
  it('accepts an absolute http(s) address and trims a fragment', () => {
    expect(normalizeRemoteUrl(' https://192.0.2.10:9443/?token=abc#section ')).toBe('https://192.0.2.10:9443/?token=abc')
    expect(normalizeRemoteUrl('http://host:8080/')).toBe('http://host:8080/')
  })

  it('refuses text that names no address, another protocol, or embedded credentials', () => {
    expect(normalizeRemoteUrl('')).toBeUndefined()
    expect(normalizeRemoteUrl('192.0.2.10:9443')).toBeUndefined()
    expect(normalizeRemoteUrl('file:///tmp/dsh')).toBeUndefined()
    expect(normalizeRemoteUrl('https://user:secret@host:9443/')).toBeUndefined()
    expect(normalizeRemoteUrl(`https://host:9443/${'a'.repeat(4_096)}`)).toBeUndefined()
  })

  it('compares the origin, ignoring path and token', () => {
    expect(sameRemoteOrigin('https://host:9443/?token=one', 'https://host:9443/other')).toBe(true)
    expect(sameRemoteOrigin('https://host:9443/', 'https://host:9444/')).toBe(false)
    expect(sameRemoteOrigin('not a url', 'https://host/')).toBe(false)
  })
})

describe('remembered remote files', () => {
  it('round-trips the last address under the desktop directory', async () => {
    const directory = await temporaryDirectory()
    const path = remoteEndpointPath(directory)
    expect(readRemoteEndpoint(path)).toBeUndefined()
    writeRemoteEndpoint(path, 'https://192.0.2.10:9443/?token=abc')
    expect(readRemoteEndpoint(path)).toEqual({ version: 1, url: 'https://192.0.2.10:9443/?token=abc' })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, url: 'https://192.0.2.10:9443/?token=abc' })
  })

  it('ignores a malformed record or another version', async () => {
    const directory = await temporaryDirectory()
    const path = remoteEndpointPath(directory)
    await mkdir(join(directory, 'desktop'), { recursive: true })
    await writeFile(path, 'not json')
    expect(readRemoteEndpoint(path)).toBeUndefined()
    await writeFile(path, JSON.stringify({ version: 1, url: 'not a url' }))
    expect(readRemoteEndpoint(path)).toBeUndefined()
    await writeFile(path, JSON.stringify({ version: 2, url: 'https://host:9443/' }))
    expect(readRemoteEndpoint(path)).toBeUndefined()
  })

  it('refuses to remember an invalid address', async () => {
    const directory = await temporaryDirectory()
    expect(() => { writeRemoteEndpoint(remoteEndpointPath(directory), 'ftp://host/') }).toThrow(/invalid address/u)
  })
})
