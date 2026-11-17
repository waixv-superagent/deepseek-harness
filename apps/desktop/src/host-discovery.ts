/** Find, trust and control a Host that outlived its owning Desktop shell. */

import { readFile } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import { z } from 'zod'
import type { DesktopQuitInspection } from './host-process.ts'

/** File the service Host publishes under the Desktop user-data directory once it is ready. */
export const HOST_DISCOVERY_FILE = 'host.json'
/** A later shell attaches only to a Host running the same application build. */
export const HOST_DISCOVERY_VERSION = 1

/** Facts the service Host publishes for the shell that attaches. */
export const DesktopHostDiscoverySchema = z.object({
  version: z.literal(HOST_DISCOVERY_VERSION),
  pid: z.number().int().positive().max(2 ** 31),
  url: z.url(),
  injections: z.array(z.unknown()).max(64),
  startedAt: z.string().min(1).max(64),
  control: z.object({
    port: z.number().int().min(1).max(65_535),
    token: z.string().min(32).max(200),
  }),
  projectDir: z.string().min(1).max(4_096),
  runtimeDir: z.string().min(1).max(4_096),
  clientVersion: z.string().max(200),
})
export type DesktopHostDiscovery = z.infer<typeof DesktopHostDiscoverySchema>

/** Why a discovered record cannot be attached. */
export type DesktopHostRejection = 'dead' | 'unreachable' | 'profile-mismatch' | 'build-mismatch'

/** One probe result: either an attachable record or why it was refused. */
export type DesktopHostProbe =
  | { readonly live: true; readonly discovery: DesktopHostDiscovery }
  | { readonly live: false; readonly discovery?: DesktopHostDiscovery; readonly reason: DesktopHostRejection }

/** The discovery path inside a Desktop user-data directory. */
export function desktopHostDiscoveryPath(userData: string): string {
  return join(userData, 'desktop', HOST_DISCOVERY_FILE)
}

/** The log file an owned Host writes, because its inherited pipes close when the shell exits. */
export function desktopHostLogPath(userData: string): string {
  return join(userData, 'desktop', 'host.log')
}

/** Compare directories the way the platform compares paths. */
export function sameDirectory(left: string, right: string): boolean {
  const a = normalize(resolve(left))
  const b = normalize(resolve(right))
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Read and validate the discovery file; an unreadable or malformed file is simply absent. */
export async function readDesktopHostDiscovery(path: string): Promise<DesktopHostDiscovery | undefined> {
  let text: string
  try { text = await readFile(path, 'utf8') } catch { return undefined }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return undefined }
  const result = DesktopHostDiscoverySchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

/** Whether a process id is still running. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user; this process owns it, so that
    // still counts as alive and the control endpoint decides.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** One authenticated control request; the Host answers JSON or the call fails. */
export async function requestDesktopControl(
  discovery: DesktopHostDiscovery,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<unknown> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 5_000)
  const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal])
  const response = await fetch(`http://127.0.0.1:${String(discovery.control.port)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${discovery.control.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`desktop Host control ${path} answered ${String(response.status)}${text === '' ? '' : `: ${text.slice(0, 200)}`}`)
  }
  return await response.json()
}

/**
 * Decide whether a discovery record names a Host this shell may attach to.
 * The record is trusted only after its process answers on the authenticated control port;
 * a stale record from a crashed Host, another profile, or another build is refused.
 */
export async function probeDesktopHost(
  discovery: DesktopHostDiscovery,
  expected: { readonly projectDir: string; readonly runtimeDir: string; readonly clientVersion: string },
): Promise<DesktopHostProbe> {
  if (!isProcessAlive(discovery.pid)) return { live: false, discovery, reason: 'dead' }
  if (!sameDirectory(discovery.projectDir, expected.projectDir)) return { live: false, discovery, reason: 'profile-mismatch' }
  if (!sameDirectory(discovery.runtimeDir, expected.runtimeDir)
    || (discovery.clientVersion !== '' && expected.clientVersion !== '' && discovery.clientVersion !== expected.clientVersion)) {
    return { live: false, discovery, reason: 'build-mismatch' }
  }
  try {
    const health = await requestDesktopControl(discovery, 'GET', '/health', undefined, { timeoutMs: 1_500 })
    if (typeof health !== 'object' || health === null || !('ok' in health) || health.ok !== true) {
      return { live: false, discovery, reason: 'unreachable' }
    }
    return { live: true, discovery }
  } catch {
    return { live: false, discovery, reason: 'unreachable' }
  }
}

/** Ask what stopping this Host would interrupt. */
export async function inspectDiscoveredHost(discovery: DesktopHostDiscovery): Promise<DesktopQuitInspection> {
  const answer = await requestDesktopControl(discovery, 'POST', '/inspect', {})
  if (typeof answer !== 'object' || answer === null
    || !('activeTasks' in answer) || typeof answer.activeTasks !== 'boolean'
    || !('scheduledTasks' in answer) || typeof answer.scheduledTasks !== 'boolean') {
    throw new Error('desktop Host control returned an invalid quit inspection')
  }
  return { activeTasks: answer.activeTasks, scheduledTasks: answer.scheduledTasks }
}

/** Update admission and task inspection over the control endpoint. */
export async function updateDiscoveredHostTasks(
  discovery: DesktopHostDiscovery,
  action: 'inspect' | 'lock' | 'unlock',
): Promise<boolean> {
  const answer = await requestDesktopControl(discovery, 'POST', '/update-tasks', { action }, { timeoutMs: 10_000 })
  if (typeof answer !== 'object' || answer === null || !('active' in answer) || typeof answer.active !== 'boolean') {
    throw new Error('desktop Host control returned an invalid task answer')
  }
  return answer.active
}

/** Authorize one Session-scoped file for a drag started in this shell. */
export async function resolveDiscoveredDragResource(
  discovery: DesktopHostDiscovery,
  address: string,
  signal?: AbortSignal,
): Promise<{ readonly path: string; readonly sha256: string; readonly size: number } | null> {
  const answer = await requestDesktopControl(discovery, 'POST', '/file-drag-resource', { address },
    signal === undefined ? { timeoutMs: 12_000 } : { timeoutMs: 12_000, signal })
  if (typeof answer !== 'object' || answer === null || !('resource' in answer)) throw new Error('desktop Host control returned an invalid drag answer')
  const resource = answer.resource
  if (resource === null) return null
  if (typeof resource !== 'object' || !('path' in resource) || typeof resource.path !== 'string'
    || !('sha256' in resource) || typeof resource.sha256 !== 'string'
    || !('size' in resource) || typeof resource.size !== 'number') {
    throw new Error('desktop Host control returned an invalid drag resource')
  }
  return { path: resource.path, sha256: resource.sha256, size: resource.size }
}

/** Latest private Platform credential snapshot the attached shell may hand to its embedded views. */
export async function readDiscoveredPlatformSession(discovery: DesktopHostDiscovery): Promise<unknown> {
  const answer = await requestDesktopControl(discovery, 'GET', '/platform-session', undefined, { timeoutMs: 5_000 })
  if (typeof answer !== 'object' || answer === null || !('session' in answer)) throw new Error('desktop Host control returned an invalid platform session')
  return answer.session
}

/**
 * Ask a discovered Host to shut down and wait until its process is gone.
 * The control answer arrives before teardown starts, so the wait is the real confirmation.
 * @param requireGraceful - when true, a process that had to be killed rejects, because an update
 *   handoff must not replace files under an unclean teardown.
 */
export async function stopDiscoveredHost(discovery: DesktopHostDiscovery, requireGraceful = false): Promise<void> {
  try {
    await requestDesktopControl(discovery, 'POST', '/shutdown', {}, { timeoutMs: 3_000 })
  } catch (error) {
    // The Host may have exited between the probe and the request; the liveness wait below decides.
    if (!isProcessAlive(discovery.pid)) return
    throw error
  }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (!isProcessAlive(discovery.pid)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  // A Host that does not finish teardown must still yield its profile and port; this is the
  // bounded last resort, and an update handoff refuses it.
  try { process.kill(discovery.pid) } catch { /* It exited after the deadline. */ }
  const killDeadline = Date.now() + 5_000
  while (Date.now() < killDeadline) {
    if (!isProcessAlive(discovery.pid)) {
      if (requireGraceful) throw new Error('desktop Host did not complete graceful task teardown')
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('desktop Host did not exit after a termination request')
}
