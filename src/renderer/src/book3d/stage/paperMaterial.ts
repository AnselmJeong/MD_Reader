import * as THREE from 'three';

export interface PaperUniforms {
  uFrontMap: { value: THREE.Texture };
  uBackMap: { value: THREE.Texture };
  uIsDoubleSidedLeaf: { value: number };
  uIsLeftResting: { value: number };
  uShadowStrength: { value: number };
  uBleedThrough: { value: number };
  uTurnLift: { value: number };
  uTurnShadowX: { value: number };
  uTurnShadowIntensity: { value: number };
  uGrainMap: { value: THREE.Texture };
  uIsDark: { value: number };
}

export interface PaperMaterialBundle {
  material: THREE.MeshStandardMaterial;
  uniforms: PaperUniforms;
}

let sharedGrainTexture: THREE.CanvasTexture | null = null;
let sharedClothBumpTexture: THREE.CanvasTexture | null = null;
let sharedPageEdgeTexture: THREE.CanvasTexture | null = null;

export function getPaperGrainTexture(): THREE.CanvasTexture {
  if (sharedGrainTexture) return sharedGrainTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;

  // Deterministic PRNG for clean, repeatable organic pulp fibers
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < data.length; i += 4) {
    const v = Math.floor(118 + (rand() - 0.5) * 44);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // Subtle horizontal/vertical cellulose flecks
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 420; i++) {
    ctx.strokeStyle = rand() > 0.5 ? '#ffffff' : '#404040';
    ctx.lineWidth = 0.7;
    const x = rand() * size;
    const y = rand() * size;
    const len = 4 + rand() * 14;
    const ang = rand() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  sharedGrainTexture = tex;
  return tex;
}

export function getClothBumpTexture(): THREE.CanvasTexture {
  if (sharedClothBumpTexture) return sharedClothBumpTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);

  // Woven linen bookcloth pattern
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const weave = ((x + y) % 4 === 0) ? 148 : 108;
      ctx.fillStyle = `rgb(${weave},${weave},${weave})`;
      ctx.fillRect(x, y, 2, 1);
      const weave2 = ((x + y) % 4 === 0) ? 112 : 144;
      ctx.fillStyle = `rgb(${weave2},${weave2},${weave2})`;
      ctx.fillRect(x, y + 1, 1, 1);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 22);
  tex.needsUpdate = true;
  sharedClothBumpTexture = tex;
  return tex;
}

export function getPageEdgeTexture(): THREE.CanvasTexture {
  if (sharedPageEdgeTexture) return sharedPageEdgeTexture;
  const w = 64;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#edeae2';
  ctx.fillRect(0, 0, w, h);

  // Fine stacked page striations
  let seed = 4201;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let y = 0; y < h; y += 2) {
    const shade = Math.floor(210 + rand() * 34);
    ctx.fillStyle = `rgb(${shade}, ${shade - 3}, ${shade - 9})`;
    ctx.fillRect(0, y, w, 1);
  }

  // Slight darker bottom shadow near board
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0.03)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.14)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  sharedPageEdgeTexture = tex;
  return tex;
}

export function createPaperMaterial(
  initialFront: THREE.Texture,
  initialBack: THREE.Texture,
  options: { isDoubleSidedLeaf: boolean; isLeftResting?: boolean }
): PaperMaterialBundle {
  const uniforms: PaperUniforms = {
    uFrontMap: { value: initialFront },
    uBackMap: { value: initialBack },
    uIsDoubleSidedLeaf: { value: options.isDoubleSidedLeaf ? 1.0 : 0.0 },
    uIsLeftResting: { value: options.isLeftResting ? 1.0 : 0.0 },
    uShadowStrength: { value: 0.55 },
    uBleedThrough: { value: 0.0 }, // PRD: disabled by default!
    uTurnLift: { value: 0.0 },
    uTurnShadowX: { value: 2.0 },
    uTurnShadowIntensity: { value: 0.0 },
    uGrainMap: { value: getPaperGrainTexture() },
    uIsDark: { value: 0.0 }
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.0,
    side: options.isDoubleSidedLeaf ? THREE.DoubleSide : THREE.FrontSide
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vPageUv;`
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vPageUv = uv;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vPageUv;
        uniform sampler2D uFrontMap;
        uniform sampler2D uBackMap;
        uniform float uIsDoubleSidedLeaf;
        uniform float uIsLeftResting;
        uniform float uShadowStrength;
        uniform float uBleedThrough;
        uniform float uTurnLift;
        uniform float uTurnShadowX;
        uniform float uTurnShadowIntensity;
        uniform sampler2D uGrainMap;
        uniform float uIsDark;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 mirroredUv = vec2(1.0 - vPageUv.x, vPageUv.y);
        vec3 pageTex;
        vec3 oppTex;
        float spineDist;

        if (uIsDoubleSidedLeaf > 0.5) {
          if (gl_FrontFacing) {
            pageTex = texture2D(uFrontMap, vPageUv).rgb;
            oppTex = (uBleedThrough > 0.001) ? texture2D(uBackMap, mirroredUv).rgb : vec3(1.0);
          } else {
            pageTex = texture2D(uBackMap, mirroredUv).rgb;
            oppTex = (uBleedThrough > 0.001) ? texture2D(uFrontMap, vPageUv).rgb : vec3(1.0);
          }
          spineDist = vPageUv.x;
        } else {
          pageTex = texture2D(uFrontMap, vPageUv).rgb;
          oppTex = (uBleedThrough > 0.001) ? texture2D(uBackMap, mirroredUv).rgb : vec3(1.0);
          spineDist = (uIsLeftResting > 0.5) ? (1.0 - vPageUv.x) : vPageUv.x;
        }

        // Optional reverse-side bleed-through (OFF by default per PRD)
        if (uBleedThrough > 0.001) {
          float oppLuma = dot(oppTex, vec3(0.299, 0.587, 0.114));
          if (uIsDark < 0.5) {
            float inkDensity = clamp((0.88 - oppLuma) * 1.15, 0.0, 1.0);
            float liftBoost = 1.0 + uTurnLift * 0.45;
            pageTex *= (1.0 - inkDensity * uBleedThrough * liftBoost);
          } else {
            float inkDensity = clamp((oppLuma - 0.12) * 1.1, 0.0, 1.0);
            pageTex += vec3(inkDensity * uBleedThrough * 0.14);
          }
        }

        // Subtle procedural paper fiber grain (attenuated over dark ink strokes for legibility)
        float grainSample = texture2D(uGrainMap, vPageUv * vec2(3.6, 5.1)).r - 0.5;
        float pageLuma = dot(pageTex, vec3(0.299, 0.587, 0.114));
        float inkProtection = mix(0.25, 1.0, smoothstep(0.08, 0.55, pageLuma));
        pageTex += vec3(grainSample * 0.022 * inkProtection);

        // Spine gutter ambient occlusion & subtle binding crease
        float liftFade = 1.0 - uTurnLift * 0.65;
        float gutterWide = exp(-spineDist * 11.0) * 0.22;
        float gutterCrease = exp(-spineDist * 62.0) * 0.20;
        float outerEdgeShade = smoothstep(0.96, 1.0, spineDist) * 0.04;
        float totalGutterAo = (gutterWide + gutterCrease + outerEdgeShade) * uShadowStrength * liftFade;
        pageTex *= (1.0 - totalGutterAo);

        // Analytic dynamic cast shadow from turning leaves onto underlying resting pages
        if (uIsDoubleSidedLeaf < 0.5 && uTurnShadowIntensity > 0.001) {
          float signedX = (uIsLeftResting > 0.5) ? -(1.0 - vPageUv.x) : vPageUv.x;
          float d = signedX - uTurnShadowX;
          float castZone = exp(-d * d * 7.5) * 0.24 + smoothstep(-0.35, 0.05, -abs(d)) * 0.08;
          pageTex *= (1.0 - castZone * uTurnShadowIntensity * uShadowStrength);
        }

        diffuseColor.rgb *= pageTex;`
      );
  };

  material.customProgramCacheKey = () =>
    `vellum-paper-v1-${options.isDoubleSidedLeaf ? 'leaf' : 'rest'}`;

  return { material, uniforms };
}
