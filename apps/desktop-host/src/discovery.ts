/** The Host's public address for a later shell: URL, boot injections, control endpoint and owner identity. */

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Version of the discovery file format; a mismatch is a stale Host, not an attachable one. */
export const DESKTOP_HOST_DISCOVERY_VERSION = 1

/** Facts a detached Host publishes once it is ready, under the Desktop user-data directory. */
export interface DesktopHostDiscoveryRecord {
  readonly version: typeof DESKTOP_HOST_DISCOVERY_VERSION
  readonly pid: number
  /** Authenticated launch URL; its token stays valid for this Host process. */
  readonly url: string
  readonly injections: readonly unknown[]
  readonly startedAt: string
  readonly control: { readonly port: number; readonly token: string }
  /** Desktop profile the Host owns, so a shell with another profile cannot attach. */
  readonly projectDir: string
  /** Bundled runtime directory, so a replaced application attaches only to its own Host. */
  readonly runtimeDir: string
  readonly clientVersion: string
}

/** Write the record atomically with owner-only permissions where the platform supports them. */
export async function writeDesktopHostDiscovery(path: string, record: DesktopHostDiscoveryRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${String(process.pid)}.tmp`
  await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

/** Remove the record; a missing file is already the desired state. */
export async function removeDesktopHostDiscovery(path: string): Promise<void> {
  await rm(path, { force: true })
}

/** Record why a service-mode Host could not start, next to the discovery path, for the next shell. */
export async function writeDesktopHostFailure(path: string, message: string, diagnostic: string | undefined): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const text = `${JSON.stringify({ message, ...(diagnostic === undefined ? {} : { diagnostic }), at: new Date().toISOString() })}\n`
  await writeFile(`${path}.error`, text, { encoding: 'utf8', mode: 0o600 }).catch(() => undefined)
}

/** Remove a previous failure record before a Host tries again. */
export async function removeDesktopHostFailure(path: string): Promise<void> {
  await rm(`${path}.error`, { force: true })
}
