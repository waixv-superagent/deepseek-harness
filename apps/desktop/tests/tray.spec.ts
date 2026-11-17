import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveDesktopLocale } from '../src/locale.ts'
import { DesktopTray, trayHostLabel, type TrayHostStatus } from '../src/tray.ts'

const native = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const trays: FakeTray[] = []
  class FakeTray extends EventEmitter {
    readonly setToolTip = vi.fn()
    readonly setContextMenu = vi.fn()
    readonly destroy = vi.fn()
    constructor(readonly image: unknown) { super(); trays.push(this) }
  }
  const menus: MenuItemConstructorOptions[][] = []
  return {
    trays, FakeTray, menus,
    createFromPath: vi.fn((path: string) => ({ path })),
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => { menus.push(template); return { template } }),
  }
})
vi.mock('electron', () => ({
  Tray: native.FakeTray,
  nativeImage: { createFromPath: native.createFromPath },
  Menu: { buildFromTemplate: native.buildFromTemplate },
}))

afterEach(() => { native.trays.length = 0; native.menus.length = 0; vi.clearAllMocks() })

function setup(locale = 'en', status: TrayHostStatus = { state: 'starting' }) {
  let current = resolveDesktopLocale(locale)
  const open = vi.fn()
  const quit = vi.fn()
  const tray = new DesktopTray({ iconPath: 'C:/app/resources/tray.ico', locale: () => current,
    hostStatus: () => status, open, quit })
  return { tray, open, quit, native: native.trays[0]!, setLocale: (next: string) => { current = resolveDesktopLocale(next) } }
}

function labels(menu: MenuItemConstructorOptions[]): (string | undefined)[] {
  return menu.map(item => item.type === 'separator' ? 'separator' : item.label)
}

it('shows the application icon with the Host state as the tooltip and an Open / Quit menu', () => {
  const f = setup()
  expect(native.createFromPath).toHaveBeenCalledWith('C:/app/resources/tray.ico')
  expect(f.native.image).toEqual({ path: 'C:/app/resources/tray.ico' })
  expect(f.native.setToolTip).toHaveBeenCalledWith('DeepSeek Harness — Host starting…')
  expect(labels(native.menus[0]!)).toEqual(['Host starting…', 'separator', 'Open DeepSeek Harness', 'separator', 'Quit DeepSeek Harness'])
  expect(f.native.setContextMenu).toHaveBeenCalledWith({ template: native.menus[0] })
})

it('opens the window on a single click and routes menu entries to the open and quit actions', () => {
  const f = setup()
  f.native.emit('click')
  expect(f.open).toHaveBeenCalledOnce()
  const menu = native.menus[0]!
  ;(menu[2] as { click: () => void }).click()
  ;(menu[4] as { click: () => void }).click()
  expect(f.open).toHaveBeenCalledTimes(2)
  expect(f.quit).toHaveBeenCalledOnce()
})

it('shows a running Host with its host:port and updates when the state changes', () => {
  const status: TrayHostStatus = { state: 'starting' }
  const tray = new DesktopTray({ iconPath: 'C:/app/resources/tray.ico', locale: () => resolveDesktopLocale('en'),
    hostStatus: () => status, open: () => {}, quit: () => {} })
  const fake = native.trays[0]!
  expect(fake.setToolTip).toHaveBeenLastCalledWith('DeepSeek Harness — Host starting…')
  Object.assign(status, { state: 'running', detail: '127.0.0.1:14513' })
  tray.relabel()
  expect(fake.setToolTip).toHaveBeenLastCalledWith('DeepSeek Harness — Host running (127.0.0.1:14513)')
  expect(labels(native.menus.at(-1)!)[0]).toBe('Host running (127.0.0.1:14513)')
  tray.dispose()
})

it('labels each Host state in the current language', () => {
  const messages = resolveDesktopLocale('zh').messages
  expect(trayHostLabel(messages, { state: 'running', detail: '127.0.0.1:1' })).toBe('Host 运行中 (127.0.0.1:1)')
  expect(trayHostLabel(messages, { state: 'starting' })).toBe('Host 启动中…')
  expect(trayHostLabel(messages, { state: 'stopped' })).toBe('Host 未运行')
})

it('relabels the menu in the current locale and ignores relabel after disposal', () => {
  const f = setup()
  f.setLocale('zh')
  f.tray.relabel()
  expect(labels(native.menus[1]!)).toEqual(['Host 启动中…', 'separator', '打开 DeepSeek Harness', 'separator', '退出 DeepSeek Harness'])
  f.tray.dispose()
  f.tray.dispose()
  expect(f.native.destroy).toHaveBeenCalledOnce()
  f.tray.relabel()
  expect(native.menus).toHaveLength(2)
})
