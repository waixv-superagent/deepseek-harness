/** Typed messages between the shell and its isolated lifecycle window. */

/** Private lifecycle window channels. */
export const LIFECYCLE_IPC = {
  /** Main answers the current presentation. */
  state: 'dsh-lifecycle:state',
  /** The window reports which option a person chose. */
  choose: 'dsh-lifecycle:choose',
} as const

/** The two answers a launch choice window offers. */
export type LifecycleChoice = 'connect' | 'restart'

/** Which launch decision the window is showing. */
export type LifecyclePhase = 'searching' | 'found' | 'stale' | 'starting' | 'error'

/** One selectable option. */
export interface LifecycleOption {
  readonly choice: LifecycleChoice
  readonly label: string
  readonly hint?: string
}

/** Ready-to-render copy composed by the main process from the shell locale. */
export interface LifecycleState {
  readonly phase: LifecyclePhase
  readonly title: string
  readonly detail: string
  readonly primary?: LifecycleOption
  readonly secondary?: LifecycleOption
  /** Last-exit facts shown under the options. */
  readonly footnote?: string
  /** The window is fading out; buttons are disabled. */
  readonly closing?: boolean
}
