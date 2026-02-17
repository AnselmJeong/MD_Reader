import { app } from 'electron'
import path from 'path'
import fs from 'fs'

/**
 * Simple JSON-based store for Electron main process settings.
 * Replaces electron-store to avoid ESM/CJS compatibility issues.
 */
class SimpleStore<T extends object> {
  private filePath: string
  private data: T

  constructor(name: string, defaults: T) {
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, `${name}.json`)
    this.data = { ...defaults }

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(raw)
        this.data = { ...defaults, ...parsed }
      }
    } catch {
      this.data = { ...defaults }
    }
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key]
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value
    this.save()
  }

  getAll(): T {
    return { ...this.data }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
    } catch (error) {
      console.error('[SimpleStore] Failed to save:', error)
    }
  }
}

export { SimpleStore }
