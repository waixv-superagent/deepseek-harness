import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  discoverRemoteHosts, isDshGatewayChallenge, remoteCandidates, type RemoteInterfaceTable,
} from '../src/remote-discovery.ts'

function table(...addresses: string[]): RemoteInterfaceTable {
  const entries: NetworkInterfaceInfo[] = addresses.map((address) => {
    const [network, last] = [address.slice(0, address.lastIndexOf('.')), address.slice(address.lastIndexOf('.') + 1)]
    return {
      address,
      netmask: '255.255.255.0',
      family: 'IPv4',
      mac: '00:00:00:00:00:00',
      internal: false,
      cidr: `${network}.${last}/24`,
    }
  })
  return { ethernet: entries }
}

describe('gateway challenge', () => {
  it('recognizes the documented Caddy challenge for its DSH upstream', () => {
    expect(isDshGatewayChallenge(401, 'Basic realm="dsh"')).toBe(true)
    expect(isDshGatewayChallenge(401, 'basic realm=dsh')).toBe(true)
    expect(isDshGatewayChallenge(401, ['Basic realm="dsh"'])).toBe(true)
    expect(isDshGatewayChallenge(401, 'Basic realm="other"')).toBe(false)
    expect(isDshGatewayChallenge(200, 'Basic realm="dsh"')).toBe(false)
    expect(isDshGatewayChallenge(401, undefined)).toBe(false)
  })
})

describe('scan candidates', () => {
  it('covers the /24 around a station address without probing the station itself', () => {
    const candidates = remoteCandidates(table('10.0.0.5'))
    expect(candidates).toHaveLength(253)
    expect(candidates.some(candidate => candidate.host === '10.0.0.5')).toBe(false)
    expect(candidates[0]).toEqual({ protocol: 'https:', host: '10.0.0.1', port: 9_443 })
  })

  it('deduplicates stations on the same subnet', () => {
    // Each station's scan covers the other's address, so the union is every host in the /24 once.
    const candidates = remoteCandidates(table('10.0.0.5', '10.0.0.6'))
    expect(candidates).toHaveLength(254)
  })
})

describe('discovery runs', () => {
  it('offers the remembered address first and preserves its token query', async () => {
    const probed: string[] = []
    const found = await discoverRemoteHosts({
      interfaces: table('10.0.0.5'),
      seeds: ['https://10.0.0.40:9443/?token=abc'],
      concurrency: 8,
      deadlineMs: 5_000,
      probe: async (candidate) => {
        probed.push(candidate.host)
        return candidate.host === '10.0.0.40' || candidate.host === '10.0.0.9'
      },
    })
    expect(found.map(host => host.url)).toEqual([
      'https://10.0.0.40:9443/?token=abc',
      'https://10.0.0.9:9443/',
    ])
    expect(found[0]?.remembered).toBe(true)
    expect(found[1]?.remembered).toBe(false)
    expect(probed).toContain('10.0.0.40')
  })

  it('probes a remembered address outside every local subnet', async () => {
    const found = await discoverRemoteHosts({
      interfaces: table('10.0.0.5'),
      seeds: ['https://192.168.1.20:9443/'],
      concurrency: 4,
      deadlineMs: 5_000,
      probe: async candidate => candidate.host === '192.168.1.20',
    })
    expect(found.map(host => host.url)).toEqual(['https://192.168.1.20:9443/'])
  })

  it('stops at the deadline even when a probe never resolves', async () => {
    const started = Date.now()
    const found = await discoverRemoteHosts({
      interfaces: table('10.0.0.5'),
      concurrency: 4,
      deadlineMs: 30,
      probe: async () => new Promise<boolean>(() => { /* Never answers. */ }),
    })
    expect(found).toEqual([])
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})
