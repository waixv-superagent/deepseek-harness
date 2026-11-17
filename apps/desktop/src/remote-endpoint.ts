/** The remote Host a person connected to last, offered again on the next launch. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { parseRemoteWebUrl } from './remote-web.ts'

/** Version of the remembered-remote file; an unknown version is ignored like a missing one. */
export const REMOTE_ENDPOINT_VERSION = 1

/** The remembered remote endpoint as written on disk. */
export const RemoteEndpointSchema = z.object({
  version: z.literal(REMOTE_ENDPOINT_VERSION),
  url: z.string().min(1).max(4_096),
})
export type RemoteEndpoint = z.infer<typeof RemoteEndpointSchema>

/**
 * The remembered-remote file inside a Desktop user-data directory.
 * @param userData - Electron user-data directory.
 * @returns the path of `remote.json` under it.
 */
export function remoteEndpointPath(userData: string): string {
  return join(userData, 'desktop', 'remote.json')
}

/**
 * Normalize a remote address entered in the launch window.
 * Only an http(s) address naming a host is usable; embedded credentials are refused because the
 * gateway asks for them separately, and a fragment cannot reach the Host.
 * @param input - text from the launch window's address field.
 * @returns the canonical address, or undefined when the text names no usable remote.
 */
export function normalizeRemoteUrl(input: string): string | undefined {
  const text = input.trim()
  if (text === '' || text.length > 4_096) return undefined
  // The configured remote-Web reader owns the http(s) and embedded-credentials rules; the launch
  // window additionally refuses a fragment, which never reaches the Host.
  const parsed = parseRemoteWebUrl(text)
  if (parsed === undefined) return undefined
  const url = new URL(parsed)
  url.hash = ''
  return url.href
}

/**
 * Whether two addresses name the same remote origin.
 * @param left - one address.
 * @param right - the other address.
 * @returns true when both parse to the same scheme, host and port.
 */
export function sameRemoteOrigin(left: string, right: string): boolean {
  try { return new URL(left).origin === new URL(right).origin } catch { return false }
}

/**
 * Read the remembered remote, or undefined when absent, malformed or from another version.
 * @param path - path from `remoteEndpointPath`.
 * @returns the validated record, or undefined.
 */
export function readRemoteEndpoint(path: string): RemoteEndpoint | undefined {
  let text: string
  try { text = readFileSync(path, 'utf8') } catch { return undefined }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return undefined }
  const result = RemoteEndpointSchema.safeParse(parsed)
  if (!result.success) return undefined
  const url = normalizeRemoteUrl(result.data.url)
  return url === undefined ? undefined : { version: REMOTE_ENDPOINT_VERSION, url }
}

/**
 * Remember one remote address atomically. A failed write must not stop the connection the person
 * just chose, so the caller reports the failure instead of aborting.
 * @param path - path from `remoteEndpointPath`.
 * @param url - address the person connected to.
 */
export function writeRemoteEndpoint(path: string, url: string): void {
  const normalized = normalizeRemoteUrl(url)
  if (normalized === undefined) throw new Error('desktop remote: refusing to remember an invalid address')
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${String(process.pid)}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ version: REMOTE_ENDPOINT_VERSION, url: normalized })}\n`, 'utf8')
  renameSync(temporary, path)
}
