/** What the shell remembers across a quit: window geometry and the work a stopped Host interrupted. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

/** Version of the restore file; an unknown version is ignored like a missing one. */
export const LIFECYCLE_STATE_VERSION = 1

/** Window rectangle as Electron reports it. */
export const LifecycleWindowBoundsSchema = z.object({
  x: z.number().int().min(-100_000).max(100_000),
  y: z.number().int().min(-100_000).max(100_000),
  width: z.number().int().min(200).max(20_000),
  height: z.number().int().min(200).max(20_000),
  maximized: z.boolean(),
})
export type LifecycleWindowBounds = z.infer<typeof LifecycleWindowBoundsSchema>

/** The restore record written by every quit that stops the Host. */
export const LifecycleStateSchema = z.object({
  version: z.literal(LIFECYCLE_STATE_VERSION),
  quitAt: z.string().min(1).max(64),
  stopHost: z.boolean(),
  /** The quit dialog's inspection, so the next launch can say what it interrupted. */
  interrupted: z.union([
    z.object({ activeTasks: z.boolean(), scheduledTasks: z.boolean() }),
    z.null(),
  ]),
  window: z.union([LifecycleWindowBoundsSchema, z.null()]),
})
export type LifecycleState = z.infer<typeof LifecycleStateSchema>

/** The restore file inside a Desktop user-data directory. */
export function lifecycleStatePath(userData: string): string {
  return join(userData, 'desktop', 'lifecycle.json')
}

/** Read the last restore record, or undefined when absent, malformed, or from another version. */
export function readLifecycleState(path: string): LifecycleState | undefined {
  let text: string
  try { text = readFileSync(path, 'utf8') } catch { return undefined }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return undefined }
  const result = LifecycleStateSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

/**
 * Write the restore record atomically. The quit path calls this synchronously so the record is on
 * disk before teardown, and a failed write must not block quitting.
 */
export function writeLifecycleState(path: string, state: LifecycleState): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${String(process.pid)}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, 'utf8')
  renameSync(temporary, path)
}

/** One display's usable area, as Electron's `screen` reports it. */
export interface LifecycleWorkArea {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** How much of a saved rectangle must stay visible before it is restored as-is. */
const MIN_VISIBLE_EDGE = 80

/**
 * Keep a saved rectangle only when it still overlaps a display's work area; a monitor that was
 * unplugged must not leave the next window off-screen.
 * @param bounds - rectangle saved at the last quit.
 * @param workAreas - current displays' usable areas.
 * @returns the rectangle to apply, or undefined to use the default window placement.
 */
export function restoreLifecycleBounds(
  bounds: LifecycleWindowBounds | null | undefined,
  workAreas: readonly LifecycleWorkArea[],
): LifecycleWindowBounds | undefined {
  if (bounds === null || bounds === undefined) return undefined
  const visible = workAreas.some((area) => {
    const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    return overlapX >= MIN_VISIBLE_EDGE && overlapY >= MIN_VISIBLE_EDGE
  })
  return visible ? bounds : undefined
}
