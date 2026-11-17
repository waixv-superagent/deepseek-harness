/** Typed messages between the shell and its isolated lifecycle window. */

/** Private lifecycle window channels. */
export const LIFECYCLE_IPC = {
  /** Main answers the current presentation. */
  state: 'dsh-lifecycle:state',
  /** The window reports which option a person chose. */
  choose: 'dsh-lifecycle:choose',
} as const

/** One answer the launch or credential window offers. */
export type LifecycleChoice =
  | { readonly choice: 'connect' }
  | { readonly choice: 'restart' }
  | { readonly choice: 'spawn' }
  | { readonly choice: 'cancel' }
  /** A remote address typed or picked; credentials are the gateway's HTTP credentials, not persisted. */
  | { readonly choice: 'remote'; readonly url: string; readonly username?: string; readonly password?: string }
  /** One credential answer for a gateway challenge. */
  | { readonly choice: 'credentials'; readonly username: string; readonly password: string }

/** Which launch decision window the shell is showing. */
export type LifecyclePhase = 'searching' | 'found' | 'stale' | 'starting' | 'error' | 'remote' | 'manual' | 'credentials'

/** One selectable option. */
export interface LifecycleOption {
  readonly choice: LifecycleChoice
  readonly label: string
  readonly hint?: string
}

/** One remote Host the scan or the last connection named. */
export interface LifecycleRemote {
  /** Address the window connects to, including a remembered token query. */
  readonly url: string
  readonly label: string
  readonly hint?: string
}

/** Credential form content for an HTTP gateway challenge. */
export interface LifecycleCredentials {
  readonly origin: string
  readonly username?: string
  /** Set after a rejected attempt, so the form can say the credentials were refused. */
  readonly error?: string
}

/** Labels of the remote-address and credential forms. */
export interface LifecycleFormCopy {
  readonly url: string
  readonly urlPlaceholder: string
  readonly username: string
  readonly password: string
  readonly connect: string
  readonly back: string
  readonly signIn: string
  readonly cancel: string
  /** Inline error for an address that is not an absolute http(s) URL. */
  readonly invalidUrl: string
}

/** The card that opens the remote-address form. */
export interface LifecycleManualOption {
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
  /** Remote Hosts offered as their own cards, remembered address first. */
  readonly remotes?: readonly LifecycleRemote[]
  /** Prefilled address for the manual form. */
  readonly remoteUrl?: string
  /** The renderer keeps the manual form open and shows this error. */
  readonly error?: string
  /** The window shows only the credential form when set. */
  readonly credentials?: LifecycleCredentials
  /** The card that opens the manual form; absent when the window asks for credentials only. */
  readonly manual?: LifecycleManualOption
  /** Labels of the forms this window can show. */
  readonly form?: LifecycleFormCopy
  /** Last-exit facts shown under the options. */
  readonly footnote?: string
  /** The window is fading out; buttons are disabled. */
  readonly closing?: boolean
}

/**
 * Validate one choice the window reports. Anything malformed is refused rather than defaulted, so a
 * renderer fault cannot silently start a Host the person did not choose.
 * @param value - the unknown IPC payload.
 * @returns the typed choice, or undefined when the message names no supported action.
 */
export function parseLifecycleChoice(value: unknown): LifecycleChoice | undefined {
  if (typeof value !== 'object' || value === null || !('choice' in value)) return undefined
  const choice = value.choice
  if (choice === 'connect' || choice === 'restart' || choice === 'spawn' || choice === 'cancel') return { choice }
  if (choice === 'remote') {
    if (!('url' in value) || typeof value.url !== 'string') return undefined
    const url = value.url.trim()
    if (url === '' || url.length > 4_096) return undefined
    const username = 'username' in value && typeof value.username === 'string' ? value.username : undefined
    const password = 'password' in value && typeof value.password === 'string' ? value.password : undefined
    return {
      choice,
      url,
      ...(username === undefined || username === '' ? {} : { username }),
      ...(password === undefined || password === '' ? {} : { password }),
    }
  }
  if (choice === 'credentials') {
    if (!('username' in value) || typeof value.username !== 'string'
      || !('password' in value) || typeof value.password !== 'string') return undefined
    if (value.username.length > 500 || value.password.length > 500) return undefined
    return { choice, username: value.username, password: value.password }
  }
  return undefined
}
