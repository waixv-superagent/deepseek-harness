import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LIFECYCLE_STATE_VERSION, lifecycleStatePath, readLifecycleState, restoreLifecycleBounds, writeLifecycleState,
  type LifecycleState,
} from '../src/lifecycle-state.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-state-'))
  directories.push(directory)
  return directory
}

const state: LifecycleState = {
  version: LIFECYCLE_STATE_VERSION,
  quitAt: '2026-11-17T13:00:00.000Z',
  stopHost: true,
  interrupted: { activeTasks: true, scheduledTasks: false },
  window: { x: 100, y: 120, width: 1280, height: 820, maximized: false },
}

describe('lifecycle restore record', () => {
  it('round-trips the last quit and ignores an unknown format', async () => {
    const directory = await temporaryDirectory()
    const path = lifecycleStatePath(directory)
    writeLifecycleState(path, state)
    expect(readLifecycleState(path)).toEqual(state)
    writeLifecycleState(path, { ...state, version: 2 as never })
    expect(readLifecycleState(path)).toBeUndefined()
    writeLifecycleState(path, { ...state, window: null, interrupted: null })
    expect(readLifecycleState(path)).toMatchObject({ window: null, interrupted: null })
  })
})

describe('window restoration', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 }

  it('restores a rectangle that is still visible and keeps maximization', () => {
    expect(restoreLifecycleBounds({ ...state.window!, maximized: true }, [area])).toEqual({ ...state.window, maximized: true })
  })

  it('drops a rectangle whose monitor disappeared', () => {
    expect(restoreLifecycleBounds({ x: 4000, y: 4000, width: 1280, height: 820, maximized: false }, [area])).toBeUndefined()
    expect(restoreLifecycleBounds(null, [area])).toBeUndefined()
    expect(restoreLifecycleBounds(undefined, [area])).toBeUndefined()
  })

  it('keeps a window that straddles the display edge', () => {
    expect(restoreLifecycleBounds({ x: 1840, y: 1000, width: 1280, height: 820, maximized: false }, [area])).toBeDefined()
  })
})
