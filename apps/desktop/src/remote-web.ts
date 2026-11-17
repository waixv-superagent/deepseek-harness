/**
 * Choosing the DSH Web host an application window displays.
 *
 * A Desktop installation normally owns its bundled Host. A deployment that keeps its Superagent
 * service on a separate DSH Web process instead names that process here: the shell displays its
 * pages in the application window and falls back to the bundled Host when no named process answers.
 * @module @deepseek-ai/dsh-desktop/remote-web
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Environment variable holding one DSH Web URL. */
export const REMOTE_WEB_URL_ENV = 'DSH_DESKTOP_REMOTE_WEB_URL'

/** Environment variable naming a file whose lines hold DSH Web URLs. */
export const REMOTE_WEB_FILE_ENV = 'DSH_DESKTOP_REMOTE_WEB_FILE'

/** Profile file read when neither environment variable names the Web host. */
export const REMOTE_WEB_PROFILE_FILE = 'remote-web.url'

/** A line starting with this prefix names another file to read URLs from. */
const INDIRECTION = '@'

/** How long one candidate may take to answer before the shell keeps its bundled Host. */
export const REMOTE_WEB_PROBE_TIMEOUT_MS = 4_000

/** Most files one configuration may chain through an indirection. */
const MAX_INDIRECTION_DEPTH = 1

/** Read one UTF-8 text file; tests supply their own implementation. */
export type ReadText = (path: string) => Promise<string>

/** Test whether a Web host answers at `url`. */
export type RemoteWebProbe = (url: string) => Promise<boolean>

/** Where the configuration reader looks for a named Web host. */
export interface RemoteWebOptions {
  /** Process environment, read for the two configuration variables. */
  readonly env: NodeJS.ProcessEnv
  /** Managed Desktop profile directory holding {@link REMOTE_WEB_PROFILE_FILE}. */
  readonly profileDir: string
  /** File reader, so a test needs no real configuration file. */
  readonly readText?: ReadText
}

/**
 * Validate one configured Web URL.
 * @param value - A trimmed configuration line.
 * @returns The normalized URL, or undefined when the line is not an HTTP(S) URL.
 */
export function parseRemoteWebUrl(value: string): string | undefined {
  let url: URL
  try { url = new URL(value) } catch { return undefined }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') return undefined
  return url.href
}

/**
 * Read the URLs one configuration file names, following one indirection.
 * @param path - Absolute configuration file path.
 * @param readText - UTF-8 reader.
 * @param depth - Indirections already taken.
 * @returns Candidate URLs in file order.
 */
async function readCandidates(path: string, readText: ReadText, depth: number): Promise<string[]> {
  const text = await readText(path)
  const candidates: string[] = []
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith(INDIRECTION)) {
      if (depth >= MAX_INDIRECTION_DEPTH) throw new Error(`desktop remote web: indirection depth exceeded in ${path}`)
      const target = resolve(dirname(path), line.slice(INDIRECTION.length).trim())
      candidates.push(...await readCandidates(target, readText, depth + 1))
      continue
    }
    const url = parseRemoteWebUrl(line)
    if (url === undefined) throw new Error(`desktop remote web: invalid URL in ${path}: ${line}`)
    candidates.push(url)
  }
  return candidates
}

/**
 * Read every Web host URL the environment or profile names.
 * @param options - Environment, profile directory, and optional reader.
 * @returns Candidate URLs in the order they should be probed.
 * @throws When a configured file is malformed or names no URL.
 */
export async function remoteWebCandidates(options: RemoteWebOptions): Promise<string[]> {
  const readText = options.readText ?? (async path => readFile(path, 'utf8'))
  const direct = options.env[REMOTE_WEB_URL_ENV]?.trim()
  if (direct !== undefined && direct !== '') {
    const url = parseRemoteWebUrl(direct)
    if (url === undefined) throw new Error(`desktop remote web: ${REMOTE_WEB_URL_ENV} is not an HTTP(S) URL`)
    return [url]
  }
  const configured = options.env[REMOTE_WEB_FILE_ENV]?.trim()
  const path = configured !== undefined && configured !== ''
    ? resolve(configured) : join(options.profileDir, REMOTE_WEB_PROFILE_FILE)
  let text: string
  try {
    text = await readText(path)
  } catch (error) {
    // Absence means the installation owns its bundled Host; any other read failure is configuration.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const candidates: string[] = []
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith(INDIRECTION)) {
      candidates.push(...await readCandidates(resolve(dirname(path), line.slice(INDIRECTION.length).trim()),
        readText, 1))
      continue
    }
    const url = parseRemoteWebUrl(line)
    if (url === undefined) throw new Error(`desktop remote web: invalid URL in ${path}: ${line}`)
    candidates.push(url)
  }
  if (candidates.length === 0) throw new Error(`desktop remote web: ${path} names no URL`)
  return candidates
}

/**
 * Test whether one Web host answers.
 * @param url - Candidate Web URL.
 * @param fetchImpl - Fetch implementation; tests supply their own.
 * @returns Whether the host answered with a redirect or a successful page.
 */
export async function probeRemoteWeb(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REMOTE_WEB_PROBE_TIMEOUT_MS),
    })
    await response.body?.cancel()
    return response.status >= 200 && response.status < 400
  } catch {
    return false
  }
}

/**
 * Choose the first configured Web host that answers.
 * @param options - Environment, profile directory, and optional reader.
 * @param probe - Availability probe; tests supply their own.
 * @returns The URL to display, or undefined to keep the bundled Host.
 * @throws When the configuration is malformed; callers report it before falling back.
 */
export async function resolveRemoteWebTarget(
  options: RemoteWebOptions, probe: RemoteWebProbe = probeRemoteWeb,
): Promise<string | undefined> {
  for (const candidate of await remoteWebCandidates(options)) {
    if (await probe(candidate)) return candidate
  }
  return undefined
}
