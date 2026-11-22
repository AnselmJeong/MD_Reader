import * as THREE from 'three';
import { DeformableLeaf } from './leafMesh';
import type { CurvePoint } from './bookGeometry';

export type TurnDirection = 'next' | 'prev';

export interface ActiveTurn {
  id: number;
  leaf: DeformableLeaf;
  direction: TurnDirection;
  frontPage: number;
  backPage: number;
  fromSpread: number;
  toSpread: number;
  progress: number;       // 0 = resting on right, 1 = resting on left
  targetProgress: number; // 0 or 1 once released
  velocity: number;
  isDragging: boolean;
  dragY: number;          // -1 (bottom) .. +1 (top)
  committed: boolean;
}

export interface TurnAnimatorCallbacks {
  onSpreadCommitted: (newSpread: number) => void;
  onStaticPagesChanged: (leftPage: number, rightPage: number) => void;
  onRequestTexturesForLeaf: (leaf: DeformableLeaf, frontPage: number, backPage: number) => void;
  onTurnSettled: () => void;
}

const LEAF_POOL_SIZE = 5;

export class TurnAnimator {
  public readonly group = new THREE.Group();
  private pool: DeformableLeaf[] = [];
  private activeTurns: ActiveTurn[] = [];
  private nextId = 1;

  private totalSpreads = 1;
  private committedSpread = 0; // Spread index after all committed in-flight turns finish
  private landedSpread = 0;    // Spread index currently settled on both stacks

  private callbacks: TurnAnimatorCallbacks;

  constructor(blankTex: THREE.Texture, callbacks: TurnAnimatorCallbacks) {
    this.callbacks = callbacks;
    for (let i = 0; i < LEAF_POOL_SIZE; i++) {
      const leaf = new DeformableLeaf(blankTex);
      this.pool.push(leaf);
      this.group.add(leaf.mesh);
    }
  }

  public getLeaves(): DeformableLeaf[] {
    return this.pool;
  }

  public getActiveCount(): number {
    return this.activeTurns.length;
  }

  public hasActiveTurns(): boolean {
    return this.activeTurns.length > 0;
  }

  public isDragging(): boolean {
    return this.activeTurns.some((t) => t.isDragging);
  }

  public getLogicalSpread(): number {
    return this.committedSpread;
  }

  public reset(totalSpreads: number, spreadIndex: number): void {
    for (const turn of this.activeTurns) {
      turn.leaf.mesh.visible = false;
    }
    this.activeTurns = [];
    this.totalSpreads = Math.max(1, totalSpreads);
    const clamped = Math.max(0, Math.min(this.totalSpreads - 1, spreadIndex));
    this.committedSpread = clamped;
    this.landedSpread = clamped;
    this.notifyStaticPages();
  }

  public setTotalSpreads(totalSpreads: number): void {
    this.totalSpreads = Math.max(1, totalSpreads);
    this.committedSpread = Math.max(0, Math.min(this.totalSpreads - 1, this.committedSpread));
    this.landedSpread = Math.max(0, Math.min(this.totalSpreads - 1, this.landedSpread));
  }

  private acquireLeaf(): DeformableLeaf | null {
    const busy = new Set(this.activeTurns.map((t) => t.leaf));
    for (const leaf of this.pool) {
      if (!busy.has(leaf)) return leaf;
    }
    return null;
  }

  private notifyStaticPages(): void {
    // Determine which static left/right pages should be visible underneath active turns
    let leftSpread = this.landedSpread;
    let rightSpread = this.landedSpread;

    for (const turn of this.activeTurns) {
      if (turn.direction === 'next') {
        // Right stack has already revealed the destination right page
        rightSpread = Math.max(rightSpread, turn.toSpread);
      } else {
        // Left stack has already revealed the destination left page
        leftSpread = Math.min(leftSpread, turn.toSpread);
      }
    }

    this.callbacks.onStaticPagesChanged(leftSpread * 2, rightSpread * 2 + 1);
  }

  public triggerTurn(direction: TurnDirection, dragY = -0.25): boolean {
    // Cancel if any active turn is going the opposite direction and still dragging
    if (this.isDragging()) return false;

    const targetSpread =
      direction === 'next' ? this.committedSpread + 1 : this.committedSpread - 1;
    if (targetSpread < 0 || targetSpread >= this.totalSpreads) {
      return false;
    }

    // If opposing turns are flying, fast-complete them so rapid reversal stays crisp
    const hasOpposite = this.activeTurns.some((t) => t.direction !== direction);
    if (hasOpposite) {
      this.finishAllImmediately();
    }

    const leaf = this.acquireLeaf();
    if (!leaf) return false;

    const fromSpread = this.committedSpread;
    const toSpread = targetSpread;

    const frontPage = direction === 'next' ? fromSpread * 2 + 1 : toSpread * 2 + 1;
    const backPage = direction === 'next' ? toSpread * 2 : fromSpread * 2;

    const turn: ActiveTurn = {
      id: this.nextId++,
      leaf,
      direction,
      frontPage,
      backPage,
      fromSpread,
      toSpread,
      progress: direction === 'next' ? 0.001 : 0.999,
      targetProgress: direction === 'next' ? 1.0 : 0.0,
      velocity: direction === 'next' ? 2.15 : -2.15,
      isDragging: false,
      dragY,
      committed: true
    };

    this.committedSpread = toSpread;
    this.activeTurns.push(turn);
    leaf.mesh.visible = true;

    this.callbacks.onRequestTexturesForLeaf(leaf, frontPage, backPage);
    this.notifyStaticPages();
    this.callbacks.onSpreadCommitted(this.committedSpread);
    return true;
  }

  public beginDrag(direction: TurnDirection, dragY: number): boolean {
    if (this.activeTurns.length > 0) {
      this.finishAllImmediately();
    }

    const targetSpread =
      direction === 'next' ? this.committedSpread + 1 : this.committedSpread - 1;
    if (targetSpread < 0 || targetSpread >= this.totalSpreads) {
      return false;
    }

    const leaf = this.acquireLeaf();
    if (!leaf) return false;

    const fromSpread = this.committedSpread;
    const toSpread = targetSpread;
    const frontPage = direction === 'next' ? fromSpread * 2 + 1 : toSpread * 2 + 1;
    const backPage = direction === 'next' ? toSpread * 2 : fromSpread * 2;

    const turn: ActiveTurn = {
      id: this.nextId++,
      leaf,
      direction,
      frontPage,
      backPage,
      fromSpread,
      toSpread,
      progress: direction === 'next' ? 0.002 : 0.998,
      targetProgress: direction === 'next' ? 0.0 : 1.0,
      velocity: 0,
      isDragging: true,
      dragY: Math.max(-1, Math.min(1, dragY)),
      committed: false
    };

    this.activeTurns.push(turn);
    leaf.mesh.visible = true;

    this.callbacks.onRequestTexturesForLeaf(leaf, frontPage, backPage);
    this.notifyStaticPages();
    return true;
  }

  public updateDrag(normalizedDelta: number, dragY: number): void {
    const turn = this.activeTurns.find((t) => t.isDragging);
    if (!turn) return;

    // normalizedDelta > 0 means dragging toward the target side
    const clamped = Math.max(0.002, Math.min(0.998, normalizedDelta));
    turn.progress = turn.direction === 'next' ? clamped : 1.0 - clamped;
    turn.dragY = Math.max(-1, Math.min(1, dragY));
  }

  public endDrag(velocityTowardTarget: number): void {
    const turn = this.activeTurns.find((t) => t.isDragging);
    if (!turn) return;

    turn.isDragging = false;
    const travelRatio = turn.direction === 'next' ? turn.progress : 1.0 - turn.progress;
    const shouldCommit = travelRatio > 0.34 || velocityTowardTarget > 0.55;

    if (shouldCommit) {
      turn.committed = true;
      turn.targetProgress = turn.direction === 'next' ? 1.0 : 0.0;
      const baseSpeed = Math.max(1.85, Math.min(4.2, Math.abs(velocityTowardTarget) + 1.85));
      turn.velocity = turn.direction === 'next' ? baseSpeed : -baseSpeed;
      this.committedSpread = turn.toSpread;
      this.callbacks.onSpreadCommitted(this.committedSpread);
    } else {
      turn.committed = false;
      turn.targetProgress = turn.direction === 'next' ? 0.0 : 1.0;
      turn.velocity = turn.direction === 'next' ? -2.2 : 2.2;
    }
  }

  public finishAllImmediately(): void {
    for (const turn of this.activeTurns) {
      turn.leaf.mesh.visible = false;
      if (turn.committed) {
        this.landedSpread = turn.toSpread;
      }
    }
    this.activeTurns = [];
    this.landedSpread = this.committedSpread;
    this.notifyStaticPages();
  }

  /**
   * Advances physics for all active leaves (frame-rate independent dt)
   * and returns analytic turn shadow state for the underlying resting pages.
   */
  public step(
    dt: number,
    rightProfile: CurvePoint[],
    leftProfile: CurvePoint[],
    curvature: number
  ): { shadowX: number; shadowIntensity: number; stillActive: boolean } {
    if (this.activeTurns.length === 0) {
      return { shadowX: 2.0, shadowIntensity: 0.0, stillActive: false };
    }

    const safeDt = Math.min(0.05, Math.max(0.001, dt));
    const finished: ActiveTurn[] = [];

    let strongestLift = 0;
    let shadowX = 0;

    for (let i = 0; i < this.activeTurns.length; i++) {
      const turn = this.activeTurns[i];

      if (!turn.isDragging) {
        const diff = turn.targetProgress - turn.progress;
        // Critically damped spring + minimum speed floor so landing feels crisp and weighty
        const springAcc = diff * 34.0 - turn.velocity * 9.2;
        turn.velocity += springAcc * safeDt;
        const minSpeed = 0.55;
        if (Math.abs(turn.velocity) < minSpeed && Math.abs(diff) > 0.005) {
          turn.velocity = Math.sign(diff) * minSpeed;
        }
        turn.progress += turn.velocity * safeDt;

        const reached =
          (turn.targetProgress >= 0.5 && turn.progress >= 0.997) ||
          (turn.targetProgress < 0.5 && turn.progress <= 0.003);
        if (reached) {
          turn.progress = turn.targetProgress;
          finished.push(turn);
          continue;
        }
      }

      const dirSign: 1 | -1 = turn.direction === 'next' ? 1 : -1;
      // Stack leaves cleanly in depth so multiple rapid turns never z-fight
      const layerOffset = (this.activeTurns.length - i) * 0.0045;

      const projX = turn.leaf.updateDeformation(
        turn.progress,
        rightProfile,
        leftProfile,
        curvature,
        dirSign,
        turn.dragY,
        layerOffset
      );

      const lift = Math.sin(turn.progress * Math.PI);
      if (lift > strongestLift) {
        strongestLift = lift;
        shadowX = projX;
      }
    }

    if (finished.length > 0) {
      for (const done of finished) {
        done.leaf.mesh.visible = false;
        if (done.committed) {
          this.landedSpread = done.toSpread;
        }
      }
      this.activeTurns = this.activeTurns.filter((t) => !finished.includes(t));
      this.notifyStaticPages();
      if (this.activeTurns.length === 0) {
        this.callbacks.onTurnSettled();
      }
    }

    return {
      shadowX,
      shadowIntensity: strongestLift,
      stillActive: this.activeTurns.length > 0
    };
  }

  public dispose(): void {
    for (const leaf of this.pool) {
      leaf.dispose();
    }
    this.pool = [];
    this.activeTurns = [];
  }
}
