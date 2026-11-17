/** Native launch decision window: connect to a Host left running, or start a new one. */

import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { LIFECYCLE_IPC, parseLifecycleChoice, type LifecycleChoice, type LifecycleState } from './lifecycle-ipc.ts'

/**
 * The one launch window of this process.
 * Its renderer is isolated like Welcome: a private preload exposes only the current presentation
 * and the chosen option, and no Host credential reaches it.
 */
export class DesktopLifecycleWindow {
  private window: BrowserWindow | undefined
  private presentation: LifecycleState | undefined
  private accepted: LifecycleChoice | undefined
  private pendingChoice: { readonly promise: Promise<LifecycleChoice>; readonly resolve: (choice: LifecycleChoice) => void } | undefined
  private closing = false
  private disposed = false

  /** @param preload - absolute built preload path. */
  constructor(private readonly preload: string) {}

  /** Current presentation; undefined before the first `update`. */
  get state(): LifecycleState | undefined { return this.presentation }

  /**
   * Create and show the window. The load must succeed before any choice can arrive.
   * @param initial - presentation rendered immediately, normally the searching phase.
   */
  async open(initial: LifecycleState): Promise<void> {
    if (this.disposed) return
    this.presentation = initial
    this.disposeHandlers()
    const window = new BrowserWindow({
      width: 640,
      height: 620,
      useContentSize: true,
      center: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      title: 'DeepSeek Harness',
      webPreferences: {
        preload: this.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: false,
      },
    })
    this.window = window
    const assertSender = (event: IpcMainInvokeEvent): void => {
      if (this.window !== window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('desktop lifecycle: rejected action from an unowned frame')
      }
    }
    ipcMain.handle(LIFECYCLE_IPC.state, (event) => {
      assertSender(event)
      return this.presentation
    })
    ipcMain.handle(LIFECYCLE_IPC.choose, (event, value: unknown) => {
      assertSender(event)
      const choice = parseLifecycleChoice(value)
      if (choice === undefined) throw new Error('desktop lifecycle: invalid choice')
      this.accept(choice)
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => { event.preventDefault() })
    window.on('close', (event) => {
      if (this.closing || this.disposed) return
      // Closing the window means "continue with the default", never "leave the shell without a way
      // to start"; the native frame is otherwise not closable during startup.
      event.preventDefault()
      this.accept(this.fallbackChoice())
    })
    window.once('closed', () => {
      if (this.window === window) this.window = undefined
      this.disposeHandlers()
      // A renderer crash must not strand startup: continue with the default.
      this.accept(this.fallbackChoice())
    })
    window.once('ready-to-show', () => {
      if (!this.closing && !window.isDestroyed()) window.show()
    })
    try {
      await window.loadFile(join(app.getAppPath(), 'renderer', 'lifecycle.html'))
    } catch (error) {
      this.dispose()
      throw error
    }
    if (this.closing || window.isDestroyed()) return
    window.show()
    window.focus()
  }

  /** Replace the rendered presentation; the last one is replayed on a late `state` request. */
  update(state: LifecycleState): void {
    this.presentation = state
    const window = this.window
    if (window !== undefined && !window.isDestroyed()) window.webContents.send(LIFECYCLE_IPC.state, state)
  }

  /**
   * The next answer the window reported, or a promise that settles when it does. A reported answer
   * is consumed: a caller that re-asks after `update` gets the next one instead of the same one.
   * @returns the option a person activated; the default when the window closes first.
   */
  choose(): Promise<LifecycleChoice> {
    if (this.accepted !== undefined) {
      const accepted = this.accepted
      this.accepted = undefined
      return Promise.resolve(accepted)
    }
    if (this.pendingChoice === undefined) {
      const { promise, resolve } = Promise.withResolvers<LifecycleChoice>()
      this.pendingChoice = { promise, resolve }
    }
    return this.pendingChoice.promise
  }

  /** Fade out, then destroy; safe to call repeatedly. */
  async close(): Promise<void> {
    const window = this.window
    if (window === undefined || window.isDestroyed()) { this.dispose(); return }
    this.closing = true
    this.presentation = this.presentation === undefined ? undefined : { ...this.presentation, closing: true }
    if (this.presentation !== undefined) window.webContents.send(LIFECYCLE_IPC.state, this.presentation)
    await new Promise(resolve => setTimeout(resolve, 180))
    if (!window.isDestroyed()) window.destroy()
    this.dispose()
  }

  /** Remove handlers and the native window without waiting for a fade. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposeHandlers()
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }

  /** The default when the window closes without a reported answer. */
  private fallbackChoice(): LifecycleChoice {
    const state = this.presentation
    // A credential window answers an HTTP challenge; closing it must refuse the challenge rather
    // than start a local Host the window never offered.
    if (state?.phase === 'credentials' || state?.credentials !== undefined) return { choice: 'cancel' }
    return state?.primary?.choice ?? { choice: 'spawn' }
  }

  private accept(choice: LifecycleChoice): void {
    this.accepted = choice
    const pending = this.pendingChoice
    this.pendingChoice = undefined
    pending?.resolve(choice)
  }

  private disposeHandlers(): void {
    ipcMain.removeHandler(LIFECYCLE_IPC.state)
    ipcMain.removeHandler(LIFECYCLE_IPC.choose)
  }
}
