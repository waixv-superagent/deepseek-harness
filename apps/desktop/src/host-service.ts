/** A Host that keeps running after its owning shell: attach, chat, and stop it over its control endpoint. */

import { DesktopHostUncleanExitError, type DesktopHostReady, type DesktopQuitInspection } from './host-process.ts'
import {
  inspectDiscoveredHost, readDiscoveredPlatformSession, requestDesktopControl, resolveDiscoveredDragResource,
  stopDiscoveredHost, updateDiscoveredHostTasks, type DesktopHostDiscovery,
} from './host-discovery.ts'

/** Replies a later shell receives from a Host it did not spawn. */
export class DesktopServiceHost {
  constructor(private readonly discovery: DesktopHostDiscovery) {}

  /** Confirm the Host is still answering, then report the same readiness an owned child would. */
  async start(): Promise<DesktopHostReady> {
    const health = await requestDesktopControl(this.discovery, 'GET', '/health', undefined, { timeoutMs: 2_000 })
    if (typeof health !== 'object' || health === null || !('ok' in health) || health.ok !== true) {
      throw new Error('desktop Host control is unavailable')
    }
    return { url: this.discovery.url, injections: this.discovery.injections }
  }

  /** Stop the Host; `requireGraceful` refuses the bounded kill because an update must not replace files under it. */
  async stop(requireGraceful = false): Promise<void> {
    try {
      await stopDiscoveredHost(this.discovery, requireGraceful)
    } catch (error) {
      // The update flow classifies an unclean teardown by type; the control client's bounded kill
      // reports the same fact for an attached Host.
      if (requireGraceful && error instanceof Error && error.message.includes('graceful')) {
        throw new DesktopHostUncleanExitError(error.message)
      }
      throw error
    }
  }

  /** What quitting the Host now would interrupt. */
  async inspectQuit(): Promise<DesktopQuitInspection> {
    return inspectDiscoveredHost(this.discovery)
  }

  /** Update admission and task inspection for one installation handoff. */
  async updateTasks(action: 'inspect' | 'lock' | 'unlock'): Promise<boolean> {
    return updateDiscoveredHostTasks(this.discovery, action)
  }

  /** Authorize one local file for a drag started in this shell. */
  async resolveDragResource(address: string, signal?: AbortSignal): Promise<
    { readonly path: string; readonly sha256: string; readonly size: number } | null
  > {
    return resolveDiscoveredDragResource(this.discovery, address, signal)
  }

  /** Latest Platform credential snapshot for embedded views. */
  async platformSession(): Promise<unknown> {
    return readDiscoveredPlatformSession(this.discovery)
  }
}
