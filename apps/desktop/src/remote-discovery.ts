/** Find the DSH Host a Caddy gateway exposes on the local network. */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { networkInterfaces } from 'node:os'
import { normalizeRemoteUrl } from './remote-endpoint.ts'

/** Port the documented Caddy gateway listens on; a remembered address may name another port. */
export const REMOTE_DISCOVERY_PORT = 9_443
/** Per-address budget; a closed port is refused immediately, an open one answers within this. */
export const REMOTE_DISCOVERY_TIMEOUT_MS = 400
/** Whole-scan budget; the launch decision proceeds with whatever answered by then. */
export const REMOTE_DISCOVERY_DEADLINE_MS = 2_500
/** Parallel probes; a /24 finishes in about eight rounds. */
export const REMOTE_DISCOVERY_CONCURRENCY = 32

/** One address to probe. */
export interface RemoteCandidate {
  readonly protocol: 'http:' | 'https:'
  readonly host: string
  readonly port: number
}

/** A gateway that answered the DSH challenge. */
export interface DiscoveredRemoteHost extends RemoteCandidate {
  /** Address the launch window connects to; a remembered seed keeps its token query. */
  readonly url: string
  /** True when the address came from the last connection rather than the subnet scan. */
  readonly remembered: boolean
}

/** Network interface table; tests supply their own. */
export type RemoteInterfaceTable = ReturnType<typeof networkInterfaces>

/** Inputs of one discovery run; production supplies none of them. */
export interface RemoteDiscoveryOptions {
  /** Addresses from the remembered endpoint; probed even outside every local subnet. */
  readonly seeds?: readonly string[]
  readonly interfaces?: RemoteInterfaceTable
  readonly probe?: (candidate: RemoteCandidate, signal: AbortSignal) => Promise<boolean>
  readonly deadlineMs?: number
  readonly concurrency?: number
  /** Cancels the scan, such as when the launch window closes before it finishes. */
  readonly signal?: AbortSignal
}

/** The launch window's address for a probed candidate. */
function candidateUrl(candidate: RemoteCandidate): string {
  return `${candidate.protocol}//${candidate.host}:${String(candidate.port)}/`
}

/**
 * Whether a response is the Caddy gateway's Basic challenge for its DSH upstream.
 * @param statusCode - response status.
 * @param header - `WWW-Authenticate` value or values.
 * @returns true for the documented `Basic realm="dsh"` challenge.
 */
export function isDshGatewayChallenge(statusCode: number | undefined, header: string | string[] | undefined): boolean {
  if (statusCode !== 401) return false
  const value = Array.isArray(header) ? header.join(',') : header
  if (value === undefined) return false
  return /(?:^|,)\s*basic\s+realm\s*=\s*"?dsh"?/iu.test(value)
}

/**
 * Candidate addresses for every IPv4 interface: the /24 containing each station address.
 * A wider mask is scanned as its /24 only, so a /16 does not turn into 65k probes.
 * @param table - interface table from `os.networkInterfaces`.
 * @param port - gateway port.
 * @returns unique candidates, without the local station addresses.
 */
export function remoteCandidates(table: RemoteInterfaceTable, port = REMOTE_DISCOVERY_PORT): RemoteCandidate[] {
  const seen = new Set<string>()
  const candidates: RemoteCandidate[] = []
  for (const infos of Object.values(table)) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      const octets = info.address.split('.')
      if (octets.length !== 4) continue
      if (info.address.startsWith('169.254.') || info.address.startsWith('127.')) continue
      const prefix = `${octets[0]}.${octets[1]}.${octets[2]}`
      for (let last = 1; last <= 254; last += 1) {
        const host = `${prefix}.${String(last)}`
        if (host === info.address) continue
        const key = `https://${host}:${String(port)}`
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push({ protocol: 'https:', host, port })
      }
    }
  }
  return candidates
}

/** Parse a remembered address into its probe target; the probe always uses the origin root. */
function seedCandidate(url: string): RemoteCandidate | undefined {
  const normalized = normalizeRemoteUrl(url)
  if (normalized === undefined) return undefined
  const parsed = new URL(normalized)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  const port = parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  return { protocol: parsed.protocol, host: parsed.hostname, port }
}

/**
 * One gateway probe: the origin root of a Caddy front must answer the DSH Basic challenge.
 * The scan sends no credentials and ignores the certificate, because it only classifies the port;
 * the window later authenticates and verifies TLS normally.
 */
function probeGateway(candidate: RemoteCandidate, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    const options = {
      host: candidate.host,
      port: candidate.port,
      path: '/',
      method: 'GET',
      timeout: timeoutMs,
      headers: { accept: 'text/html' },
    }
    const onResponse = (response: import('node:http').IncomingMessage): void => {
      const challenge = isDshGatewayChallenge(response.statusCode, response.headers['www-authenticate'])
      response.resume()
      finish(challenge)
    }
    const request = candidate.protocol === 'https:'
      ? httpsRequest({ ...options, rejectUnauthorized: false }, onResponse)
      : httpRequest(options, onResponse)
    request.on('timeout', () => { request.destroy(); finish(false) })
    request.on('error', () => { finish(false) })
    request.end()
  })
}

/**
 * Probe the remembered remote and every address in the current subnets.
 * A remembered seed keeps its full address (including the Host token); scanned gateways use their
 * origin. The scan stops starting probes at the deadline and returns what answered.
 * @param options - seeds, interface table, probe and budgets; tests inject the probe.
 * @returns gateways ordered with the remembered address first.
 */
export async function discoverRemoteHosts(options: RemoteDiscoveryOptions = {}): Promise<readonly DiscoveredRemoteHost[]> {
  const deadlineMs = options.deadlineMs ?? REMOTE_DISCOVERY_DEADLINE_MS
  const concurrency = Math.max(1, options.concurrency ?? REMOTE_DISCOVERY_CONCURRENCY)
  const table = options.interfaces ?? networkInterfaces()
  const entries: { readonly candidate: RemoteCandidate; readonly url: string; readonly remembered: boolean }[] = []
  const seen = new Set<string>()
  const add = (candidate: RemoteCandidate, url: string, remembered: boolean): void => {
    const key = `${candidate.protocol}//${candidate.host}:${String(candidate.port)}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push({ candidate, url, remembered })
  }
  for (const seed of options.seeds ?? []) {
    const candidate = seedCandidate(seed)
    const normalized = normalizeRemoteUrl(seed)
    if (candidate !== undefined && normalized !== undefined) add(candidate, normalized, true)
  }
  for (const candidate of remoteCandidates(table)) add(candidate, candidateUrl(candidate), false)

  const deadline = AbortSignal.timeout(deadlineMs)
  const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
  // One shared abort promise; a probe that outlives the deadline is abandoned instead of awaited.
  const aborted = new Promise<boolean>((resolve) => {
    if (signal.aborted) resolve(false)
    else signal.addEventListener('abort', () => { resolve(false) }, { once: true })
  })
  const probe = options.probe ?? ((candidate, probeSignal) => probeGateway(candidate, REMOTE_DISCOVERY_TIMEOUT_MS, probeSignal))
  const found = new Map<number, DiscoveredRemoteHost>()
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal.aborted) return
      const index = next
      next += 1
      const entry = entries[index]
      if (entry === undefined) return
      let answered = false
      try {
        answered = await Promise.race([probe(entry.candidate, signal).catch(() => false), aborted])
      } catch {
        answered = false
      }
      if (!answered) continue
      found.set(index, { ...entry.candidate, url: entry.url, remembered: entry.remembered })
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker))
  return [...found.entries()].sort((left, right) => left[0] - right[0]).map(([, host]) => host)
}
