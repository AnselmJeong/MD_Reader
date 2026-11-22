import * as THREE from 'three';
import { THEME_PALETTES, type BookDocument, type ThemeMode } from '../types/book';

interface CacheEntry {
  key: string;
  pageIndex: number;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  lastUsed: number;
}

export class PageTextureCache {
  private doc: BookDocument | null = null;
  private theme: ThemeMode = 'light';
  private maxAnisotropy: number;
  private maxEntries: number;
  private pixelWidth = 1024;
  private pixelHeight = 1456;
  private generation = 0;

  private entries = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<THREE.CanvasTexture>>();
  private blankTexture: THREE.CanvasTexture;
  private blankCanvas: HTMLCanvasElement;
  private useClock = 0;

  constructor(maxAnisotropy: number, maxEntries = 14) {
    this.maxAnisotropy = Math.min(16, Math.max(1, maxAnisotropy));
    this.maxEntries = maxEntries;

    this.blankCanvas = document.createElement('canvas');
    this.blankCanvas.width = 64;
    this.blankCanvas.height = 64;
    this.blankTexture = new THREE.CanvasTexture(this.blankCanvas);
    this.blankTexture.colorSpace = THREE.SRGBColorSpace;
    this.paintBlank(this.theme);
  }

  private paintBlank(theme: ThemeMode): void {
    const ctx = this.blankCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = THEME_PALETTES[theme].paperBg;
      ctx.fillRect(0, 0, this.blankCanvas.width, this.blankCanvas.height);
      this.blankTexture.needsUpdate = true;
    }
  }

  public setDocument(doc: BookDocument | null): void {
    this.doc = doc;
    this.invalidateAll();
  }

  public setTheme(theme: ThemeMode): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.paintBlank(theme);
    this.invalidateAll();
  }

  public setResolution(pixelWidth: number, pixelHeight: number): void {
    const w = Math.round(Math.max(512, Math.min(2048, pixelWidth)));
    const h = Math.round(Math.max(512, Math.min(2048, pixelHeight)));
    if (Math.abs(w - this.pixelWidth) < 48 && Math.abs(h - this.pixelHeight) < 48) return;
    this.pixelWidth = w;
    this.pixelHeight = h;
    this.invalidateAll();
  }

  public getBlankTexture(): THREE.CanvasTexture {
    return this.blankTexture;
  }

  public getCachedCount(): number {
    return this.entries.size;
  }

  public getMaxEntries(): number {
    return this.maxEntries;
  }

  public getResolution(): { width: number; height: number } {
    return { width: this.pixelWidth, height: this.pixelHeight };
  }

  private makeKey(pageIndex: number): string {
    return `${this.generation}:${this.theme}:${this.pixelWidth}x${this.pixelHeight}:${pageIndex}`;
  }

  public peekTexture(pageIndex: number): THREE.CanvasTexture | null {
    if (!this.doc || pageIndex < 0 || pageIndex >= this.doc.getPageCount()) {
      return this.blankTexture;
    }
    const key = this.makeKey(pageIndex);
    const hit = this.entries.get(key);
    if (hit) {
      hit.lastUsed = ++this.useClock;
      return hit.texture;
    }
    return null;
  }

  public async getTexture(pageIndex: number): Promise<THREE.CanvasTexture> {
    if (!this.doc || pageIndex < 0 || pageIndex >= this.doc.getPageCount()) {
      return this.blankTexture;
    }

    const key = this.makeKey(pageIndex);
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastUsed = ++this.useClock;
      return existing.texture;
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const genSnapshot = this.generation;
    const docSnapshot = this.doc;
    const themeSnapshot = this.theme;
    const w = this.pixelWidth;
    const h = this.pixelHeight;

    const promise = (async () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;

      await docSnapshot.renderPage(pageIndex, canvas, w, h, themeSnapshot);

      if (genSnapshot !== this.generation || docSnapshot !== this.doc) {
        return this.blankTexture;
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.maxAnisotropy;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;

      this.entries.set(key, {
        key,
        pageIndex,
        texture,
        canvas,
        lastUsed: ++this.useClock
      });
      this.evictIfNeeded();
      return texture;
    })();

    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  public prefetchRange(centerPage: number, radius = 3): void {
    if (!this.doc) return;
    const total = this.doc.getPageCount();
    const order: number[] = [];
    for (let d = 0; d <= radius; d++) {
      if (centerPage + d < total) order.push(centerPage + d);
      if (d > 0 && centerPage - d >= 0) order.push(centerPage - d);
    }
    for (const idx of order) {
      if (!this.peekTexture(idx)) {
        void this.getTexture(idx);
      }
    }
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, entry] of this.entries.entries()) {
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      const victim = this.entries.get(oldestKey);
      if (victim) {
        victim.texture.dispose();
        victim.canvas.width = 1;
        victim.canvas.height = 1;
      }
      this.entries.delete(oldestKey);
    }
  }

  /** Redraw cached pages in place (e.g. new underlines) without dropping their textures. */
  public async repaintPages(pageIndices: number[]): Promise<void> {
    if (!this.doc || pageIndices.length === 0) return;
    const wanted = new Set(pageIndices);
    const jobs: Promise<void>[] = [this.repaintEntries(wanted)];
    // A page still being drawn may have read the old marks: redraw it once it lands.
    for (const [key, pending] of this.inFlight.entries()) {
      const pageIndex = Number(key.slice(key.lastIndexOf(':') + 1));
      if (wanted.has(pageIndex)) jobs.push(pending.then(() => this.repaintEntries(new Set([pageIndex]))));
    }
    await Promise.all(jobs);
  }

  private async repaintEntries(wanted: Set<number>): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const generation = this.generation;
    const jobs: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      if (!wanted.has(entry.pageIndex)) continue;
      jobs.push(doc.renderPage(entry.pageIndex, entry.canvas, entry.canvas.width, entry.canvas.height, this.theme).then(() => {
        if (generation === this.generation && doc === this.doc) entry.texture.needsUpdate = true;
      }));
    }
    await Promise.all(jobs);
  }

  public invalidateAll(): void {
    this.generation++;
    for (const entry of this.entries.values()) {
      entry.texture.dispose();
      entry.canvas.width = 1;
      entry.canvas.height = 1;
    }
    this.entries.clear();
    this.inFlight.clear();
  }

  public dispose(): void {
    this.invalidateAll();
    this.blankTexture.dispose();
  }
}
