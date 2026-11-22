import * as THREE from 'three';
import {
  computeRestingProfile,
  PAGE_H,
  PAGE_W,
  SPINE_Y,
  type CurvePoint
} from './bookGeometry';
import { createPaperMaterial, type PaperMaterialBundle } from './paperMaterial';

const SEG_X = 46;
const SEG_Z = 20;

/**
 * Reusable deformable 3D leaf mesh (46x20 subdivided grid) that smoothly
 * transitions between the right resting page (t = 0) and left resting page (t = 1)
 * with arc-length-preserving curvature and corner-curl deformation.
 */
export class DeformableLeaf {
  public readonly mesh: THREE.Mesh;
  public readonly bundle: PaperMaterialBundle;
  private readonly geometry: THREE.BufferGeometry;

  constructor(blankTex: THREE.Texture) {
    this.geometry = new THREE.BufferGeometry();
    const vertCount = (SEG_X + 1) * (SEG_Z + 1);
    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices: number[] = [];

    for (let iz = 0; iz <= SEG_Z; iz++) {
      const v = iz / SEG_Z;
      for (let ix = 0; ix <= SEG_X; ix++) {
        const u = ix / SEG_X;
        const idx = iz * (SEG_X + 1) + ix;
        uvs[idx * 2] = u;
        uvs[idx * 2 + 1] = v;
      }
    }

    for (let iz = 0; iz < SEG_Z; iz++) {
      for (let ix = 0; ix < SEG_X; ix++) {
        const a = iz * (SEG_X + 1) + ix;
        const b = a + 1;
        const c = a + (SEG_X + 1);
        const d = c + 1;
        indices.push(a, b, d);
        indices.push(a, d, c);
      }
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);

    this.bundle = createPaperMaterial(blankTex, blankTex, {
      isDoubleSidedLeaf: true
    });

    this.mesh = new THREE.Mesh(this.geometry, this.bundle.material);
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
  }

  public setTextures(frontTex: THREE.Texture, backTex: THREE.Texture): void {
    this.bundle.uniforms.uFrontMap.value = frontTex;
    this.bundle.uniforms.uBackMap.value = backTex;
  }

  /**
   * Deforms the leaf geometry for turn progress `t` in [0, 1]
   * (0 = resting on right stack, 1 = resting on left stack).
   * `directionSign`: +1 when flipping right->left (next), -1 when flipping left->right (prev).
   * `dragY`: vertical grab bias in [-1, 1] (-1 = bottom corner leads, +1 = top corner leads).
   */
  public updateDeformation(
    t: number,
    rightProfile: CurvePoint[],
    leftProfile: CurvePoint[],
    curvature: number,
    directionSign: 1 | -1,
    dragY: number,
    layerOffset: number
  ): number {
    const clampedT = Math.max(0, Math.min(1, t));
    const liftEnv = Math.sin(clampedT * Math.PI);
    this.bundle.uniforms.uTurnLift.value = liftEnv;

    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ds = PAGE_W / SEG_X;

    // Precompute resting endpoint tangent angles relative to +X for exact endpoint matching
    const rightEnd = rightProfile[SEG_X];
    const leftEnd = leftProfile[SEG_X];
    const hRight = rightEnd.y;
    const hLeft = leftEnd.y;

    let projectedMidX = 0;

    for (let iz = 0; iz <= SEG_Z; iz++) {
      const v = iz / SEG_Z; // 0 = bottom, 1 = top
      const zBase = (0.5 - v) * PAGE_H;

      // Diagonal corner-curl phase shift along vertical axis
      const cornerFactor = (v - 0.5) * (-dragY) * 0.24 * liftEnv;
      const localT = Math.max(0, Math.min(1, clampedT + cornerFactor));
      const localLift = Math.sin(localT * Math.PI);

      // Smoothly blend between exact resting curves at endpoints and full arc-length turn mid-flight
      const blendToTurn = Math.pow(localLift, 0.72);

      // Base spine angle: 0 (right) -> PI (left)
      const spineAngle = localT * Math.PI;
      // Aerodynamic paper stiffness lag: outer edge trails behind the direction of motion
      const lagStrength = (0.48 + 0.30 * curvature) * localLift * directionSign;
      // Slight gentle bow upward so page clears both stacks cleanly
      const archBias = (0.14 + 0.16 * curvature) * localLift;

      // Integrate arc-length-preserving turned curve from spine (ix=0) to fore-edge (ix=SEG_X)
      let tx = 0;
      let ty = SPINE_Y + 0.005 + layerOffset + localLift * 0.025;

      // Also track exact resting interpolation for zero-pop handoff at t -> 0 and t -> 1
      const restWeightRight = 1 - localT;
      const restProfile = localT < 0.5 ? rightProfile : leftProfile;
      const endBlend = localT < 0.5
        ? Math.min(1, localT / 0.12)
        : Math.min(1, (1 - localT) / 0.12);
      const smoothEnd = endBlend * endBlend * (3 - 2 * endBlend);

      for (let ix = 0; ix <= SEG_X; ix++) {
        const s = ix / SEG_X;

        if (ix > 0) {
          // Local tangent angle along the turning sheet
          const curlCurve = Math.pow(s, 1.35) * lagStrength;
          const dome = Math.sin(s * Math.PI) * archBias * (localT < 0.5 ? 1 : -1);
          const theta = spineAngle - curlCurve + dome;

          tx += Math.cos(theta) * ds;
          ty += Math.sin(theta) * ds;
        }

        // Prevent clipping below the underlying resting stack height
        const minClearanceY =
          (tx >= 0 ? hRight : hLeft) * Math.min(1, s * 2.0) * (1 - localLift * 0.7) +
          0.015 +
          layerOffset;
        const safeTy = Math.max(minClearanceY, ty);

        // Exact resting target near t=0 or t=1 for seamless transition
        const rp = restProfile[ix];
        const finalX = rp.x + (tx - rp.x) * smoothEnd;
        const finalY = rp.y + 0.0045 + layerOffset + (safeTy - (rp.y + 0.0045 + layerOffset)) * smoothEnd;

        // Subtle Z skew during corner curl for authentic paper twist
        const zTwist = -Math.sin(s * Math.PI) * localLift * dragY * 0.032 * s * blendToTurn;

        const idx = iz * (SEG_X + 1) + ix;
        pos.setXYZ(idx, finalX, finalY, zBase + zTwist);

        if (iz === Math.floor(SEG_Z * 0.5) && ix === Math.floor(SEG_X * 0.55)) {
          projectedMidX = finalX / PAGE_W;
        }
      }
      void restWeightRight;
    }

    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
    return projectedMidX;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.bundle.material.dispose();
  }
}

export function ensureProfileSegments(
  side: 'left' | 'right',
  stackHeight: number,
  curvature: number
): CurvePoint[] {
  return computeRestingProfile(side, stackHeight, curvature, SEG_X);
}
