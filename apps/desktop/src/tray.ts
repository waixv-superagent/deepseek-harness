/** Windows system tray: the always-present way back to a hidden window, the Host's state, and the explicit quit entry. */

import { Menu, nativeImage, Tray } from 'electron'
import type { DesktopLocale } from './locale.ts'

/** What the Host is doing, as the tray shows it. */
export type TrayHostState = 'starting' | 'running' | 'stopped'
export interface TrayHostStatus {
  readonly state: TrayHostState
  /** The Host's loopback host:port while it runs, for the menu and the tooltip. */
  readonly detail?: string
}

/** One label for the status line and the tooltip, in the current language. */
export function trayHostLabel(messages: DesktopLocale['messages'], status: TrayHostStatus): string {
  const label = status.state === 'running' ? messages.hostRunning
    : status.state === 'starting' ? messages.hostStarting : messages.hostStopped
  return status.detail === undefined ? label : `${label} (${status.detail})`
}

/** Main-process actions the tray triggers; both run the same paths as the window and application menu. */
export interface DesktopTrayOptions {
  /** Multi-size ICO rendered by `scripts/render-tray-icon.ts`; Windows picks the bitmap for the display scale. */
  readonly iconPath: string
  readonly locale: () => DesktopLocale
  /** The Host's state at the moment the tray renders; read again on every refresh. */
  readonly hostStatus: () => TrayHostStatus
  /** Show and focus the primary window. */
  readonly open: () => void
  /** Request quit through the same confirmation as every other quit entry. */
  readonly quit: () => void
}

/** Tray icon present for the whole run, not only while the window is hidden. */
export class DesktopTray {
  private tray: Tray | undefined
  /** The last rendered state, locale and port; a relabel only rebuilds the menu when this changes. */
  private rendered: string | undefined

  /** @param options - Icon path, locale and Host status readers, and the open and quit actions. */
  constructor(private readonly options: DesktopTrayOptions) {
    const tray = new Tray(nativeImage.createFromPath(options.iconPath))
    this.tray = tray
    tray.on('click', () => { options.open() })
    this.relabel()
  }

  /** Rebuild the tooltip and context menu in the current locale when the Host state changed. */
  relabel(): void {
    const tray = this.tray
    if (tray === undefined) return
    const { messages } = this.options.locale()
    const status = this.options.hostStatus()
    const label = trayHostLabel(messages, status)
    const rendered = `${messages.aboutProduct}\u0000${status.state}\u0000${status.detail ?? ''}\u0000${label}`
    if (rendered === this.rendered) return
    this.rendered = rendered
    tray.setToolTip(`${messages.aboutProduct} — ${label}`)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      { label: messages.openApplication, click: () => { this.options.open() } },
      { type: 'separator' },
      { label: messages.quitApplication, click: () => { this.options.quit() } },
    ]))
  }

  /** Remove the icon; called once the quit is confirmed so no dead icon outlives the process. */
  dispose(): void {
    const tray = this.tray
    this.tray = undefined
    tray?.destroy()
  }
}
