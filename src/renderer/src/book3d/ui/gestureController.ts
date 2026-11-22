import type { BookStage } from '../stage/bookStage';
import type { TurnDirection } from '../stage/turnAnimator';

// Keyboard handling is left to the host app (MD_Reader has its own shortcuts); this class
// only handles pointer drags, taps and ctrl/cmd + wheel zoom on the canvas.
export interface GestureCallbacks {
  onZoomChanged?: (zoom: number) => void;
  /** A tap that should not turn the page (e.g. on an underlined word). */
  isTapBlocked?: (event: PointerEvent) => boolean;
}

export class GestureController {
  private stage: BookStage;
  private canvas: HTMLCanvasElement;
  private callbacks: GestureCallbacks;

  private pointerDown = false;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private lastMoveTime = 0;
  private velocityX = 0;
  private mode: 'undecided' | 'turn' | 'pan' = 'undecided';
  private turnDirection: TurnDirection = 'next';
  private dragTurnStarted = false;

  constructor(stage: BookStage, callbacks: GestureCallbacks = {}) {
    this.stage = stage;
    this.canvas = stage.getDomElement();
    this.callbacks = callbacks;

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private getDragYNormalized(clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const norm = ((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
    // +1 at top, -1 at bottom
    return Math.max(-1, Math.min(1, -norm));
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.pointerDown = true;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastMoveTime = performance.now();
    this.velocityX = 0;
    this.mode = 'undecided';
    this.dragTurnStarted = false;

    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture errors on synthetic pointer events
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointerDown || e.pointerId !== this.pointerId) return;

    const now = performance.now();
    const dt = Math.max(0.004, (now - this.lastMoveTime) / 1000);
    const stepDx = e.clientX - this.lastX;
    const stepDy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastMoveTime = now;

    const rect = this.canvas.getBoundingClientRect();
    const span = Math.max(240, rect.width * 0.52);
    this.velocityX = (stepDx / span) / dt;

    const totalDx = e.clientX - this.startX;
    const totalDy = e.clientY - this.startY;
    const dist = Math.hypot(totalDx, totalDy);

    if (this.mode === 'undecided') {
      if (dist < 8) return;
      if (this.stage.getZoom() > 1.04) {
        this.mode = 'pan';
      } else {
        this.mode = 'turn';
        // Swipe left -> next page; swipe right -> prev page
        this.turnDirection = totalDx < 0 ? 'next' : 'prev';
        const dragY = this.getDragYNormalized(e.clientY);
        this.dragTurnStarted = this.stage.beginDragTurn(this.turnDirection, dragY);
      }
    }

    if (this.mode === 'pan') {
      const worldScale = 4.2 / (Math.max(300, rect.width) * this.stage.getZoom());
      this.stage.panBy(-stepDx * worldScale, -stepDy * worldScale);
      return;
    }

    if (this.mode === 'turn' && this.dragTurnStarted) {
      const rawDelta = this.turnDirection === 'next' ? -totalDx : totalDx;
      const progress = Math.max(0.002, Math.min(0.998, rawDelta / span));
      this.stage.updateDragTurn(progress, this.getDragYNormalized(e.clientY));
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointerDown || e.pointerId !== this.pointerId) return;
    this.pointerDown = false;

    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    this.pointerId = null;

    const totalDx = e.clientX - this.startX;
    const totalDy = e.clientY - this.startY;

    if (this.mode === 'undecided' && Math.hypot(totalDx, totalDy) < 9) {
      if (this.callbacks.isTapBlocked?.(e)) return;
      // Clean click/tap on left or right side of the book turns the page
      const rect = this.canvas.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / Math.max(1, rect.width);
      if (relX > 0.58) {
        this.stage.nextPage();
      } else if (relX < 0.42) {
        this.stage.prevPage();
      }
      return;
    }

    if (this.mode === 'turn') {
      if (this.dragTurnStarted) {
        const velTowardTarget =
          this.turnDirection === 'next' ? -this.velocityX : this.velocityX;
        this.stage.endDragTurn(velTowardTarget);
      } else {
        // Single-page mode intra-spread swipe
        if (Math.abs(totalDx) > 36) {
          if (totalDx < 0) this.stage.nextPage();
          else this.stage.prevPage();
        }
      }
    }

    this.mode = 'undecided';
    this.dragTurnStarted = false;
  };

  private onWheel = (e: WheelEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.09 : 0.92;
      const next = this.stage.getZoom() * factor;
      this.stage.setZoom(next);
      this.callbacks.onZoomChanged?.(this.stage.getZoom());
    }
  };

  public isPointerDown(): boolean {
    return this.pointerDown;
  }

  public dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
