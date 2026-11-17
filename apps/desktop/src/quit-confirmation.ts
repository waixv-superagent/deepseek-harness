/** Quit confirmation: what stopping the Host would interrupt, and whether the user keeps it running. */

import type { MessageBoxOptions, MessageBoxReturnValue, NativeImage } from 'electron'
import type { DesktopQuitInspection } from './host-process.ts'
import type { DesktopLocale, DesktopMessages } from './locale.ts'

/** Locale key of the explanation shown before quitting, or none when quitting interrupts nothing. */
export type DesktopQuitPrompt = Extract<keyof DesktopMessages, 'quitActiveTasks' | 'quitScheduledTasks' | 'quitActiveAndScheduledTasks'> | undefined

/** What the shell does after an approved quit. */
export interface DesktopQuitDecision {
  /** True stops the Host; false lets a detached Host keep running in the background. */
  readonly stopHost: boolean
  /** The inspection the dialog explained, or `unknown` when it failed. */
  readonly inspection: DesktopQuitInspection | 'unknown'
}

/**
 * Choose the confirmation copy for one inspection result.
 * @param inspection - Host answer, or `unknown` when the inspection failed or missed its deadline.
 * @returns the explanation key; an unknown state warns about running tasks rather than quitting silently.
 */
export function resolveDesktopQuitPrompt(inspection: DesktopQuitInspection | 'unknown'): DesktopQuitPrompt {
  if (inspection === 'unknown') return 'quitActiveTasks'
  if (inspection.activeTasks && inspection.scheduledTasks) return 'quitActiveAndScheduledTasks'
  if (inspection.activeTasks) return 'quitActiveTasks'
  if (inspection.scheduledTasks) return 'quitScheduledTasks'
  return undefined
}

/** Main-process collaborators of the confirmation. */
export interface DesktopQuitConfirmationOptions {
  readonly locale: () => DesktopLocale
  /** Start one Host inspection; undefined while no Host is ready, when nothing can be running and the quit proceeds. */
  readonly inspect: () => Promise<DesktopQuitInspection> | undefined
  /** Native message box without an owner window: hidden windows stay hidden and the box comes to the front. */
  readonly show: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>
  /** Bring the open confirmation to the front when quit is requested again while it is open. */
  readonly focus: () => void
  readonly platform?: NodeJS.Platform
  /** Application icon for the Windows task dialog; macOS composes the app icon onto its warning icon itself. */
  readonly icon?: NativeImage
}

/** One quit decision at a time; repeated quit requests join the open confirmation instead of stacking. */
export class DesktopQuitConfirmation {
  private pending: Promise<DesktopQuitDecision | false> | undefined
  private disposed = false

  /** @param options - Locale, inspection, and native dialog collaborators. */
  constructor(private readonly options: DesktopQuitConfirmationOptions) {}

  /**
   * Decide whether the quit may proceed and whether the Host stops with it.
   * The box asks even when nothing is running while a Host is ready: its checkbox is how a person
   * chooses between closing the App and stopping the Host. A second request joins the open decision;
   * approval never re-inspects.
   * @returns the decision, or false when the user cancelled.
   */
  confirm(): Promise<DesktopQuitDecision | false> {
    if (this.disposed) return Promise.resolve(false)
    if (this.pending !== undefined) {
      this.options.focus()
      return this.pending
    }
    const pending = this.decide().finally(() => { if (this.pending === pending) this.pending = undefined })
    this.pending = pending
    return pending
  }

  /**
   * The application is quitting through a path that does not ask: a pending decision resolves to
   * false without opening a box, and later requests do the same. An already open native box has no
   * close API and disappears with the process.
   */
  dispose(): void { this.disposed = true }

  private async decide(): Promise<DesktopQuitDecision | false> {
    const inspection = this.options.inspect()
    if (inspection === undefined) return { stopHost: true, inspection: 'unknown' }
    const outcome: DesktopQuitInspection | 'unknown' = await inspection.catch((error: unknown) => {
      console.warn('desktop quit: task inspection unavailable', error)
      return 'unknown' as const
    })
    if (this.disposed) return false
    const prompt = resolveDesktopQuitPrompt(outcome)
    const { messages } = this.options.locale()
    const windows = (this.options.platform ?? process.platform) === 'win32'
    // The checkbox is the lifecycle choice: checked (the current behaviour) stops the Host, while
    // unchecking leaves a detached Host running for the next launch to connect to. A ready Host
    // always asks, because even idle it may be serving Sources a person wants left online.
    const detail = prompt === undefined ? messages.quitHostKeepNote : `${messages[prompt]}\n${messages.quitHostKeepNote}`
    // Button order follows each platform: macOS lays buttons out right-to-left from index 0, so
    // "Quit" sits right of "Cancel"; the Windows task dialog keeps array order, "Quit" left of "Cancel".
    const result = await this.options.show({
      type: windows ? 'none' : 'warning',
      ...(windows && this.options.icon !== undefined ? { icon: this.options.icon } : {}),
      title: messages.aboutProduct,
      message: messages.quitTitle,
      detail,
      checkboxLabel: messages.quitStopHost,
      checkboxChecked: true,
      buttons: [messages.quit, messages.cancel],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- A bypassing quit can dispose while the box is open.
    if (this.disposed) return false
    if (result.response !== 0) return false
    return { stopHost: result.checkboxChecked, inspection: outcome }
  }
}
