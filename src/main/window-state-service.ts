import { app, BrowserWindow, screen, type Rectangle } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface WindowState { bounds: Rectangle; maximized: boolean; fullscreen: boolean }
const stateFile = () => path.join(app.getPath('userData'), 'md-reader-window.json')

export function fitWindowBounds(value: unknown, workAreas: Rectangle[], primary: Rectangle): Rectangle {
  const candidate = value && typeof value === 'object' ? value as Rectangle : null
  const valid = candidate && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(candidate[key as keyof Rectangle]))
    && candidate.width > 0 && candidate.height > 0
  const requested = valid ? candidate : { x: primary.x + (primary.width - 1400) / 2, y: primary.y + (primary.height - 900) / 2, width: 1400, height: 900 }
  const overlap = (area: Rectangle) => Math.max(0, Math.min(area.x + area.width, requested.x + requested.width) - Math.max(area.x, requested.x))
    * Math.max(0, Math.min(area.y + area.height, requested.y + requested.height) - Math.max(area.y, requested.y))
  const area = workAreas.reduce((best, item) => overlap(item) > overlap(best) ? item : best, primary)
  const width = Math.min(area.width, Math.max(800, requested.width))
  const height = Math.min(area.height, Math.max(600, requested.height))
  return {
    width, height,
    x: Math.round(Math.min(Math.max(requested.x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(requested.y, area.y), area.y + area.height - height))
  }
}

export function readWindowState(): WindowState {
  let saved: Partial<WindowState> = {}
  try { saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) ?? {} } catch { /* First launch or invalid state. */ }
  return {
    bounds: fitWindowBounds(saved.bounds, screen.getAllDisplays().map(display => display.workArea), screen.getPrimaryDisplay().workArea),
    maximized: saved.maximized === true,
    fullscreen: saved.fullscreen === true
  }
}

export function rememberWindowState(win: BrowserWindow, restored: WindowState) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let shown = false
  const save = () => {
    clearTimeout(timer)
    if (win.isDestroyed() || !shown) return
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() }
    const target = stateFile(), temporary = `${target}.tmp`
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(temporary, JSON.stringify(state))
      fs.renameSync(temporary, target)
    } catch (error) { console.error('[WindowState] Could not save window layout:', error) }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(save, 250) }
  win.on('resize', schedule).on('move', schedule).on('maximize', schedule).on('unmaximize', schedule)
    .on('enter-full-screen', schedule).on('leave-full-screen', schedule)
  win.once('ready-to-show', () => {
    if (restored.maximized) win.maximize()
    win.show()
    if (restored.fullscreen) win.setFullScreen(true)
    shown = true
  })
  win.on('close', save)
  app.on('before-quit', save)
  win.once('closed', () => { clearTimeout(timer); app.removeListener('before-quit', save) })
}
