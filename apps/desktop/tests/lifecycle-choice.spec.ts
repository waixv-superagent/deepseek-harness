import { describe, expect, it } from 'vitest'
import { parseLifecycleChoice } from '../src/lifecycle-ipc.ts'

describe('launch choices', () => {
  it('accepts the local decisions and the cancel answer', () => {
    expect(parseLifecycleChoice({ choice: 'connect' })).toEqual({ choice: 'connect' })
    expect(parseLifecycleChoice({ choice: 'restart' })).toEqual({ choice: 'restart' })
    expect(parseLifecycleChoice({ choice: 'spawn' })).toEqual({ choice: 'spawn' })
    expect(parseLifecycleChoice({ choice: 'cancel' })).toEqual({ choice: 'cancel' })
  })

  it('trims a remote address and keeps optional credentials', () => {
    expect(parseLifecycleChoice({ choice: 'remote', url: ' https://192.0.2.10:9443/?token=abc ', username: 'operator', password: 'secret' }))
      .toEqual({ choice: 'remote', url: 'https://192.0.2.10:9443/?token=abc', username: 'operator', password: 'secret' })
    expect(parseLifecycleChoice({ choice: 'remote', url: 'https://host:9443/', username: '', password: '' }))
      .toEqual({ choice: 'remote', url: 'https://host:9443/' })
  })

  it('accepts one credential answer and refuses an oversized one', () => {
    expect(parseLifecycleChoice({ choice: 'credentials', username: 'operator', password: 'secret' }))
      .toEqual({ choice: 'credentials', username: 'operator', password: 'secret' })
    expect(parseLifecycleChoice({ choice: 'credentials', username: 'u', password: 'p'.repeat(501) })).toBeUndefined()
  })

  it('refuses unknown, malformed, or legacy string answers', () => {
    expect(parseLifecycleChoice(undefined)).toBeUndefined()
    expect(parseLifecycleChoice('connect')).toBeUndefined()
    expect(parseLifecycleChoice({ choice: 'launch-a-host' })).toBeUndefined()
    expect(parseLifecycleChoice({ choice: 'remote' })).toBeUndefined()
    expect(parseLifecycleChoice({ choice: 'remote', url: '' })).toBeUndefined()
    expect(parseLifecycleChoice({ choice: 'credentials', username: 'u' })).toBeUndefined()
  })
})
