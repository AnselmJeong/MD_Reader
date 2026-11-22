import * as THREE from 'three';

export const PAGE_W = 2.0;
export const PAGE_H = 2.84;
export const BOARD_OVERHANG = 0.075;
export const BOARD_THICKNESS = 0.044;
export const SPINE_HALF_GAP = 0.032;
export const SPINE_Y = 0.024;

export interface CurvePoint {
  x: number;
  y: number;
  s: number; // normalized arc length [0, 1]
}

/**
 * Computes an arc-length-preserving cross-section of a resting open page
 * from spine (u = 0) to fore-edge (u = 1), matching the graceful hardcover arch
 * seen in physical books (thicker stacks arch higher near the spine).
 */
export function computeRestingProfile(
  side: 'left' | 'right',
  stackHeight: number,
  curvature: number,
  segments: number
): CurvePoint[] {
  const sign = side === 'right' ? 1 : -1;
  const ds = PAGE_W / segments;
  const points: CurvePoint[] = [];

  // Gentle arch amplitude (~half of original bulge) to balance 3D depth with high legibility
  const archAmp = curvature * (0.036 + stackHeight * 0.40);
  const targetEndY = Math.max(0.016, stackHeight);

  // First pass: evaluate raw y(u) and integrate arc-length-exact x(u)
  let x = sign * 0.005;
  let prevY = SPINE_Y;

  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    // Smooth, restrained rise from spine gutter -> gentle crown -> settle to stack fore-edge
    const baseBlend = Math.pow(u, 0.78);
    const baseY = SPINE_Y + (targetEndY - SPINE_Y) * baseBlend;
    const hump = Math.sin(Math.pow(u, 0.78) * Math.PI) * archAmp;
    // Subtle dip right at the spine crease
    const creaseDip = Math.exp(-u * 18.0) * 0.012 * curvature;
    const y = Math.max(0.012, baseY + hump - creaseDip);

    if (i > 0) {
      const dy = y - prevY;
      const dx = Math.sqrt(Math.max(0.0001, ds * ds - dy * dy));
      x += sign * dx;
    }

    points.push({ x, y, s: u });
    prevY = y;
  }

  return points;
}

/**
 * Builds/updates a curved resting page BufferGeometry (subdivided grid)
 * whose top surface lies precisely on `profile`.
 */
export function createRestingPageGeometry(segX = 44, segZ = 18): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const vertCount = (segX + 1) * (segZ + 1);
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices: number[] = [];

  for (let iz = 0; iz <= segZ; iz++) {
    const v = iz / segZ; // 0 = bottom (+H/2), 1 = top (-H/2)
    for (let ix = 0; ix <= segX; ix++) {
      const u = ix / segX;
      const idx = iz * (segX + 1) + ix;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;
    }
  }

  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * (segX + 1) + ix;
      const b = a + 1;
      const c = a + (segX + 1);
      const d = c + 1;
      indices.push(a, b, d);
      indices.push(a, d, c);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export function updateRestingPageGeometry(
  geo: THREE.BufferGeometry,
  side: 'left' | 'right',
  profile: CurvePoint[],
  segZ = 18
): void {
  const segX = profile.length - 1;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uvs = geo.getAttribute('uv') as THREE.BufferAttribute;

  for (let iz = 0; iz <= segZ; iz++) {
    const v = iz / segZ;
    // v = 1 -> top (-PAGE_H / 2), v = 0 -> bottom (+PAGE_H / 2)
    const z = (0.5 - v) * PAGE_H;

    for (let ix = 0; ix <= segX; ix++) {
      // For left page: ix=0 is outer left (u=0 on canvas), ix=segX is spine (u=1 on canvas)
      // For right page: ix=0 is spine (u=0 on canvas), ix=segX is outer right (u=1 on canvas)
      const p = side === 'left' ? profile[segX - ix] : profile[ix];
      const idx = iz * (segX + 1) + ix;
      pos.setXYZ(idx, p.x, p.y + 0.0025, z);
      uvs.setXY(idx, ix / segX, v);
    }
  }

  pos.needsUpdate = true;
  uvs.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}

/**
 * Builds the 3 visible outer walls (top-edge, bottom-edge, and fore-edge) of a curved PageStack
 * extruded from `profile` down to the hardcover board (`y = 0`), with tapered fore-edge bevel.
 */
export function buildPageStackGeometry(
  side: 'left' | 'right',
  profile: CurvePoint[]
): THREE.BufferGeometry {
  const segX = profile.length - 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const halfH = PAGE_H * 0.5;
  const pushQuad = (
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    uv0: [number, number],
    uv1: [number, number],
    uv2: [number, number],
    uv3: [number, number]
  ) => {
    const base = positions.length / 3;
    positions.push(...p0, ...p1, ...p2, ...p3);
    uvs.push(...uv0, ...uv1, ...uv2, ...uv3);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // Top edge (z = -halfH, normal -Z) and Bottom edge (z = +halfH, normal +Z)
  for (let i = 0; i < segX; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const u0 = i / segX;
    const u1 = (i + 1) / segX;
    // Slight natural outward taper toward bottom of stack
    const sign = side === 'right' ? 1 : -1;
    const taperA = sign * (a.s * 0.018);
    const taperB = sign * (b.s * 0.018);

    if (side === 'right') {
      // Bottom edge (+Z)
      pushQuad(
        [a.x, a.y, halfH],
        [a.x + taperA, 0.002, halfH],
        [b.x + taperB, 0.002, halfH],
        [b.x, b.y, halfH],
        [u0, 0],
        [u0, 1],
        [u1, 1],
        [u1, 0]
      );
      // Top edge (-Z)
      pushQuad(
        [b.x, b.y, -halfH],
        [b.x + taperB, 0.002, -halfH],
        [a.x + taperA, 0.002, -halfH],
        [a.x, a.y, -halfH],
        [u1, 0],
        [u1, 1],
        [u0, 1],
        [u0, 0]
      );
    } else {
      // Bottom edge (+Z)
      pushQuad(
        [b.x, b.y, halfH],
        [b.x + taperB, 0.002, halfH],
        [a.x + taperA, 0.002, halfH],
        [a.x, a.y, halfH],
        [u1, 0],
        [u1, 1],
        [u0, 1],
        [u0, 0]
      );
      // Top edge (-Z)
      pushQuad(
        [a.x, a.y, -halfH],
        [a.x + taperA, 0.002, -halfH],
        [b.x + taperB, 0.002, -halfH],
        [b.x, b.y, -halfH],
        [u0, 0],
        [u0, 1],
        [u1, 1],
        [u1, 0]
      );
    }
  }

  // Fore-edge (outer side of page stack)
  const end = profile[segX];
  const sign = side === 'right' ? 1 : -1;
  const endBottomX = end.x + sign * 0.018;
  if (side === 'right') {
    pushQuad(
      [end.x, end.y, halfH],
      [endBottomX, 0.002, halfH],
      [endBottomX, 0.002, -halfH],
      [end.x, end.y, -halfH],
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0]
    );
  } else {
    pushQuad(
      [end.x, end.y, -halfH],
      [endBottomX, 0.002, -halfH],
      [endBottomX, 0.002, halfH],
      [end.x, end.y, halfH],
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0]
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Creates the hardcover boards, flexible spine gutter, and decorative headbands.
 */
export function createHardcoverGroup(
  clothMaterial: THREE.MeshStandardMaterial,
  endpaperMaterial: THREE.MeshStandardMaterial
): {
  group: THREE.Group;
  updateSpreadWidth: (leftEndX: number, rightEndX: number) => void;
} {
  const group = new THREE.Group();

  const boardW = PAGE_W + BOARD_OVERHANG;
  const boardH = PAGE_H + BOARD_OVERHANG * 2;

  const boardGeo = new THREE.BoxGeometry(boardW, BOARD_THICKNESS, boardH);

  const leftBoard = new THREE.Mesh(boardGeo, clothMaterial);
  leftBoard.castShadow = true;
  leftBoard.receiveShadow = true;
  group.add(leftBoard);

  const rightBoard = new THREE.Mesh(boardGeo, clothMaterial);
  rightBoard.castShadow = true;
  rightBoard.receiveShadow = true;
  group.add(rightBoard);

  // Inner paste-down endpapers (thin sheet sitting on inside of boards)
  const endpaperGeo = new THREE.PlaneGeometry(boardW - 0.045, boardH - 0.05);
  endpaperGeo.rotateX(-Math.PI / 2);

  const leftEndpaper = new THREE.Mesh(endpaperGeo, endpaperMaterial);
  leftEndpaper.position.y = 0.001;
  leftEndpaper.receiveShadow = true;
  group.add(leftEndpaper);

  const rightEndpaper = new THREE.Mesh(endpaperGeo, endpaperMaterial);
  rightEndpaper.position.y = 0.001;
  rightEndpaper.receiveShadow = true;
  group.add(rightEndpaper);

  // Flexible central spine strip
  const spineW = SPINE_HALF_GAP * 2 + 0.09;
  const spineGeo = new THREE.BoxGeometry(spineW, BOARD_THICKNESS * 0.85, boardH);
  const spineMesh = new THREE.Mesh(spineGeo, clothMaterial);
  spineMesh.position.set(0, -BOARD_THICKNESS * 0.58, 0);
  spineMesh.castShadow = true;
  spineMesh.receiveShadow = true;
  group.add(spineMesh);

  // Subtle decorative woven headbands at top and bottom of spine
  const headbandMat = new THREE.MeshStandardMaterial({
    color: 0xd9d2c5,
    roughness: 0.9,
    metalness: 0.0
  });
  const headbandGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.07, 10);
  headbandGeo.rotateZ(Math.PI / 2);

  const topHeadband = new THREE.Mesh(headbandGeo, headbandMat);
  topHeadband.position.set(0, 0.012, -PAGE_H * 0.5 - 0.004);
  group.add(topHeadband);

  const botHeadband = new THREE.Mesh(headbandGeo, headbandMat);
  botHeadband.position.set(0, 0.012, PAGE_H * 0.5 + 0.004);
  group.add(botHeadband);

  const updateSpreadWidth = (leftEndX: number, rightEndX: number) => {
    const leftOuter = Math.min(-PAGE_W + 0.06, leftEndX) - BOARD_OVERHANG;
    const rightOuter = Math.max(PAGE_W - 0.06, rightEndX) + BOARD_OVERHANG;
    const leftCenterX = leftOuter + boardW * 0.5;
    const rightCenterX = rightOuter - boardW * 0.5;

    leftBoard.position.set(leftCenterX, -BOARD_THICKNESS * 0.5, 0);
    rightBoard.position.set(rightCenterX, -BOARD_THICKNESS * 0.5, 0);
    leftEndpaper.position.set(leftCenterX + 0.01, 0.001, 0);
    rightEndpaper.position.set(rightCenterX - 0.01, 0.001, 0);
  };

  updateSpreadWidth(-PAGE_W, PAGE_W);

  return { group, updateSpreadWidth };
}
