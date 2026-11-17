/** Isolated preload of the launch/quit lifecycle window. */

import { contextBridge, ipcRenderer } from 'electron'
import { LIFECYCLE_IPC, type LifecycleChoice, type LifecycleState } from './lifecycle-ipc.ts'

/** What the lifecycle window may ask the shell. */
export interface LifecycleWindowApi {
  /** @returns the presentation to render now. */
  state(): Promise<LifecycleState>
  /** @param choice - the option a person activated. */
  choose(choice: LifecycleChoice): Promise<void>
  /** @param listener - presentation updates until the returned disposer runs. */
  onState(listener: (state: LifecycleState) => void): () => void
}

const api: LifecycleWindowApi = {
  state: () => ipcRenderer.invoke(LIFECYCLE_IPC.state) as Promise<LifecycleState>,
  choose: choice => ipcRenderer.invoke(LIFECYCLE_IPC.choose, choice) as Promise<void>,
  onState: (listener) => {
    const handle = (_event: Electron.IpcRendererEvent, state: LifecycleState): void => { listener(state) }
    ipcRenderer.on(LIFECYCLE_IPC.state, handle)
    return () => { ipcRenderer.off(LIFECYCLE_IPC.state, handle) }
  },
}

contextBridge.exposeInMainWorld('dshLifecycle', api)
