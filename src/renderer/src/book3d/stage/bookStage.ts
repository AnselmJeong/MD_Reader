import * as THREE from 'three';
import type { BookDocument, DisplaySettings, LayoutMode, ThemeMode } from '../types/book';
import { PageTextureCache } from '../core/textureCache';
import {
  buildPageStackGeometry,
  createHardcoverGroup,
  createRestingPageGeometry,
  PAGE_H,
  PAGE_W,
  updateRestingPageGeometry,
  type CurvePoint
} from './bookGeometry';
import { ensureProfileSegments } from './leafMesh';
import {
  createPaperMaterial,
  getClothBumpTexture,
  getPageEdgeTexture,
  type PaperMaterialBundle
} from './paperMaterial';
import { TurnAnimator, type TurnDirection } from './turnAnimator';

const STAGE_BG: Record<ThemeMode, number> = {
  light: 0xeae8e4,
  sepia: 0xe3dccb,
  dark: 0x16171a
};

const ENDPAPER_COLOR: Record<ThemeMode, number> = {
  light: 0xf4f1ea,
  sepia: 0xeee5d0,
  dark: 0x1e2024
};

const EDGE_TINT: Record<ThemeMode, number> = {
  light: 0xffffff,
  sepia: 0xf3e8d0,
  dark: 0x555860
};

export interface StageStats {
  fps: number;
  cachedTextures: number;
  maxTextures: number;
  activeLeaves: number;
  texWidth: number;
  texHeight: number;
}

export class BookStage {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private textureCache: PageTextureCache;
  private doc: BookDocument | null = null;

  private bookGroup = new THREE.Group();
  private hardcover: ReturnType<typeof createHardcoverGroup>;
  private clothMaterial: THREE.MeshStandardMaterial;
  private endpaperMaterial: THREE.MeshStandardMaterial;
  private pageEdgeMaterial: THREE.MeshStandardMaterial;

  private leftStackMesh: THREE.Mesh;
  private rightStackMesh: THREE.Mesh;
  private leftPageGeo: THREE.BufferGeometry;
  private rightPageGeo: THREE.BufferGeometry;
  private leftPageBundle: PaperMaterialBundle;
  private rightPageBundle: PaperMaterialBundle;
  private leftPageMesh: THREE.Mesh;
  private rightPageMesh: THREE.Mesh;

  private leftProfile: CurvePoint[] = [];
  private rightProfile: CurvePoint[] = [];

  private turnAnimator: TurnAnimator;
  private deskShadowMat: THREE.ShadowMaterial;
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;

  private displaySettings: DisplaySettings;
  private layoutMode: LayoutMode = 'spread';
  private currentPageIndex = 0; // Exact current page index (0-based)
  private displayedLeftPage = 0;
  private displayedRightPage = 1;

  // Camera framing & zoom/pan state
  private zoom = 1.0;
  private targetZoom = 1.0;
  private panX = 0;
  private panY = 0;
  private targetPanX = 0;
  private targetPanY = 0;
  private cameraTargetX = 0;
  private currentCamX = 0;
  private zoomResTimer: number | null = null;

  // Render loop & performance tracking
  private rafId: number | null = null;
  private needsRender = true;
  private lastFrameTime = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private currentFps = 60;
  private onPageChanged: (pageIndex: number, totalPages: number) => void;
  private onStatsUpdate?: (stats: StageStats) => void;

  constructor(
    container: HTMLElement,
    initialDisplay: DisplaySettings,
    callbacks: {
      onPageChanged: (pageIndex: number, totalPages: number) => void;
      onStatsUpdate?: (stats: StageStats) => void;
    }
  ) {
    this.container = container;
    this.displaySettings = { ...initialDisplay };
    this.onPageChanged = callbacks.onPageChanged;
    this.onStatsUpdate = callbacks.onStatsUpdate;

    // 1. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'stage-canvas';
    this.container.appendChild(this.renderer.domElement);

    // Handle WebGL context recovery gracefully
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.textureCache.invalidateAll();
      this.refreshStaticPageTextures();
      this.requestRender();
    });

    // 2. Scene & Narrow-FOV Camera (20° matching studio reference photo)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(STAGE_BG[initialDisplay.theme]);

    this.camera = new THREE.PerspectiveCamera(20, 1, 0.5, 45);
    this.camera.position.set(0, 10.6, 2.55);
    this.camera.lookAt(0, 0.08, 0.02);

    // 3. Studio Lighting (bright, uniform legibility + clear 3D curvature shading + soft desk shadow)
    this.hemiLight = new THREE.HemisphereLight(0xfffefb, 0xd4cfc4, 1.24);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfffcf5, 1.52);
    this.keyLight.position.set(-3.4, 7.6, 3.2);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 16;
    const d = 3.4;
    this.keyLight.shadow.camera.left = -d;
    this.keyLight.shadow.camera.right = d;
    this.keyLight.shadow.camera.top = d;
    this.keyLight.shadow.camera.bottom = -d;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.radius = 4.5;
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0xf6f8ff, 0.48);
    this.fillLight.position.set(3.8, 5.0, -1.6);
    this.scene.add(this.fillLight);

    // Soft cast shadow plane beneath the hardcover
    this.deskShadowMat = new THREE.ShadowMaterial({ opacity: 0.21 });
    const deskPlane = new THREE.Mesh(new THREE.PlaneGeometry(18, 14), this.deskShadowMat);
    deskPlane.rotation.x = -Math.PI / 2;
    deskPlane.position.y = -0.048;
    deskPlane.receiveShadow = true;
    this.scene.add(deskPlane);

    // 4. Texture Cache
    this.textureCache = new PageTextureCache(this.renderer.capabilities.getMaxAnisotropy(), 14);

    // 5. Hardcover & Page Stacks
    this.clothMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(initialDisplay.bindingColor),
      roughness: 0.78,
      metalness: 0.04,
      bumpMap: getClothBumpTexture(),
      bumpScale: 0.006
    });
    this.endpaperMaterial = new THREE.MeshStandardMaterial({
      color: ENDPAPER_COLOR[initialDisplay.theme],
      roughness: 0.94,
      metalness: 0.0
    });
    this.pageEdgeMaterial = new THREE.MeshStandardMaterial({
      color: EDGE_TINT[initialDisplay.theme],
      map: getPageEdgeTexture(),
      roughness: 0.92,
      metalness: 0.0
    });

    this.hardcover = createHardcoverGroup(this.clothMaterial, this.endpaperMaterial);
    this.bookGroup.add(this.hardcover.group);

    this.leftStackMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.pageEdgeMaterial);
    this.leftStackMesh.castShadow = true;
    this.leftStackMesh.receiveShadow = true;
    this.bookGroup.add(this.leftStackMesh);

    this.rightStackMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.pageEdgeMaterial);
    this.rightStackMesh.castShadow = true;
    this.rightStackMesh.receiveShadow = true;
    this.bookGroup.add(this.rightStackMesh);

    // 6. Resting Left & Right Curved Page Meshes
    const blank = this.textureCache.getBlankTexture();
    this.leftPageGeo = createRestingPageGeometry(46, 20);
    this.rightPageGeo = createRestingPageGeometry(46, 20);
    this.leftPageBundle = createPaperMaterial(blank, blank, {
      isDoubleSidedLeaf: false,
      isLeftResting: true
    });
    this.rightPageBundle = createPaperMaterial(blank, blank, {
      isDoubleSidedLeaf: false,
      isLeftResting: false
    });

    this.leftPageMesh = new THREE.Mesh(this.leftPageGeo, this.leftPageBundle.material);
    this.rightPageMesh = new THREE.Mesh(this.rightPageGeo, this.rightPageBundle.material);
    this.bookGroup.add(this.leftPageMesh);
    this.bookGroup.add(this.rightPageMesh);

    // 7. Turn Animator (5-leaf reusable pool)
    this.turnAnimator = new TurnAnimator(blank, {
      onSpreadCommitted: (newSpread) => {
        if (this.layoutMode === 'spread') {
          this.currentPageIndex = Math.min(this.getTotalPages() - 1, newSpread * 2);
        }
        this.rebuildBookThickness(newSpread);
        this.textureCache.prefetchRange(newSpread * 2, 4);
        this.onPageChanged(this.currentPageIndex, this.getTotalPages());
        this.requestRender();
      },
      onStaticPagesChanged: (leftPage, rightPage) => {
        this.displayedLeftPage = leftPage;
        this.displayedRightPage = rightPage;
        this.refreshStaticPageTextures();
        this.requestRender();
      },
      onRequestTexturesForLeaf: (leaf, frontPage, backPage) => {
        const blankTex = this.textureCache.getBlankTexture();
        const fPeek = this.textureCache.peekTexture(frontPage) ?? blankTex;
        const bPeek = this.textureCache.peekTexture(backPage) ?? blankTex;
        leaf.setTextures(fPeek, bPeek);
        void Promise.all([
          this.textureCache.getTexture(frontPage),
          this.textureCache.getTexture(backPage)
        ]).then(([fTex, bTex]) => {
          leaf.setTextures(fTex, bTex);
          this.requestRender();
        });
      },
      onTurnSettled: () => {
        this.refreshStaticPageTextures();
        this.requestRender();
      }
    });
    this.bookGroup.add(this.turnAnimator.group);

    this.scene.add(this.bookGroup);

    this.applyDisplaySettings(this.displaySettings);
    this.handleResize();
    this.rebuildBookThickness(0);
    this.requestRender();
  }

  public getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  public getTotalPages(): number {
    return this.doc ? this.doc.getPageCount() : 0;
  }

  public getTotalSpreads(): number {
    return Math.max(1, Math.ceil(this.getTotalPages() / 2));
  }

  public getCurrentPageIndex(): number {
    return this.currentPageIndex;
  }

  public getLayoutMode(): LayoutMode {
    return this.layoutMode;
  }

  public setDocument(doc: BookDocument, initialPage = 0): void {
    this.doc = doc;
    this.textureCache.setDocument(doc);
    this.updateTextureResolution();

    const totalPages = doc.getPageCount();
    this.currentPageIndex = Math.max(0, Math.min(totalPages - 1, initialPage));
    const spreadIdx = Math.floor(this.currentPageIndex / 2);

    this.turnAnimator.reset(this.getTotalSpreads(), spreadIdx);
    this.rebuildBookThickness(spreadIdx);
    this.updateCameraFocusForLayout();
    this.refreshStaticPageTextures();
    this.textureCache.prefetchRange(this.currentPageIndex, 4);
    this.onPageChanged(this.currentPageIndex, totalPages);
    this.requestRender();
  }

  public onDocumentRelayout(newPageIndex: number): void {
    if (!this.doc) return;
    this.textureCache.invalidateAll();
    const totalPages = this.doc.getPageCount();
    this.currentPageIndex = Math.max(0, Math.min(totalPages - 1, newPageIndex));
    const spreadIdx = Math.floor(this.currentPageIndex / 2);

    this.turnAnimator.reset(this.getTotalSpreads(), spreadIdx);
    this.rebuildBookThickness(spreadIdx);
    this.updateCameraFocusForLayout();
    this.refreshStaticPageTextures();
    this.textureCache.prefetchRange(this.currentPageIndex, 4);
    this.onPageChanged(this.currentPageIndex, totalPages);
    this.requestRender();
  }

  public goToPage(pageIndex: number, animate = false): void {
    if (!this.doc) return;
    const total = this.doc.getPageCount();
    const clamped = Math.max(0, Math.min(total - 1, pageIndex));
    const currentSpread = this.turnAnimator.getLogicalSpread();
    const targetSpread = Math.floor(clamped / 2);

    if (animate && Math.abs(targetSpread - currentSpread) === 1) {
      this.currentPageIndex = clamped;
      this.turnAnimator.triggerTurn(targetSpread > currentSpread ? 'next' : 'prev');
      this.updateCameraFocusForLayout();
      this.onPageChanged(this.currentPageIndex, total);
      return;
    }

    this.currentPageIndex = clamped;
    this.turnAnimator.reset(this.getTotalSpreads(), targetSpread);
    this.rebuildBookThickness(targetSpread);
    this.updateCameraFocusForLayout();
    this.refreshStaticPageTextures();
    this.textureCache.prefetchRange(clamped, 4);
    this.onPageChanged(this.currentPageIndex, total);
    this.requestRender();
  }

  public nextPage(): boolean {
    if (!this.doc) return false;
    const total = this.doc.getPageCount();
    if (this.layoutMode === 'single') {
      if (this.currentPageIndex >= total - 1) return false;
      const nextIdx = this.currentPageIndex + 1;
      const curSpread = Math.floor(this.currentPageIndex / 2);
      const nextSpread = Math.floor(nextIdx / 2);
      this.currentPageIndex = nextIdx;
      if (nextSpread !== curSpread) {
        this.turnAnimator.triggerTurn('next');
      }
      this.updateCameraFocusForLayout();
      this.textureCache.prefetchRange(nextIdx, 4);
      this.onPageChanged(this.currentPageIndex, total);
      this.requestRender();
      return true;
    }
    return this.turnAnimator.triggerTurn('next');
  }

  public prevPage(): boolean {
    if (!this.doc) return false;
    const total = this.doc.getPageCount();
    if (this.layoutMode === 'single') {
      if (this.currentPageIndex <= 0) return false;
      const prevIdx = this.currentPageIndex - 1;
      const curSpread = Math.floor(this.currentPageIndex / 2);
      const prevSpread = Math.floor(prevIdx / 2);
      this.currentPageIndex = prevIdx;
      if (prevSpread !== curSpread) {
        this.turnAnimator.triggerTurn('prev');
      }
      this.updateCameraFocusForLayout();
      this.textureCache.prefetchRange(prevIdx, 4);
      this.onPageChanged(this.currentPageIndex, total);
      this.requestRender();
      return true;
    }
    return this.turnAnimator.triggerTurn('prev');
  }

  public beginDragTurn(direction: TurnDirection, dragY: number): boolean {
    if (this.layoutMode === 'single') {
      const curSpread = Math.floor(this.currentPageIndex / 2);
      if (direction === 'next' && this.currentPageIndex % 2 === 0 && this.currentPageIndex + 1 < this.getTotalPages()) {
        // Facing right page is already on the same spread; let drag end glide to it
        return false;
      }
      if (direction === 'prev' && this.currentPageIndex % 2 === 1) {
        return false;
      }
      void curSpread;
    }
    const started = this.turnAnimator.beginDrag(direction, dragY);
    if (started) this.requestRender();
    return started;
  }

  public updateDragTurn(normalizedDelta: number, dragY: number): void {
    this.turnAnimator.updateDrag(normalizedDelta, dragY);
    this.requestRender();
  }

  public endDragTurn(velocityTowardTarget: number): void {
    const prevSpread = this.turnAnimator.getLogicalSpread();
    this.turnAnimator.endDrag(velocityTowardTarget);
    const newSpread = this.turnAnimator.getLogicalSpread();
    if (this.layoutMode === 'single' && newSpread !== prevSpread) {
      this.currentPageIndex =
        newSpread > prevSpread
          ? Math.min(this.getTotalPages() - 1, newSpread * 2)
          : Math.min(this.getTotalPages() - 1, newSpread * 2 + 1);
      this.updateCameraFocusForLayout();
      this.onPageChanged(this.currentPageIndex, this.getTotalPages());
    }
    this.requestRender();
  }

  // ─── Host-app hooks: picking and projecting points on the resting pages ───

  private raycaster = new THREE.Raycaster();

  public isTurning(): boolean {
    return this.turnAnimator.hasActiveTurns() || this.turnAnimator.isDragging();
  }

  public getDisplayedPages(): [number, number] {
    return [this.displayedLeftPage, this.displayedRightPage];
  }

  /** Redraw some pages' textures in place (their content changed, e.g. underlines). */
  public repaintPages(pageIndices: number[]): void {
    void this.textureCache.repaintPages(pageIndices).then(() => this.requestRender());
  }

  /** Which resting page is under a screen point, and where on it (u: 0 left → 1 right, v: 0 bottom → 1 top). */
  public pickPage(clientX: number, clientY: number): { pageIndex: number; u: number; v: number } | null {
    if (!this.doc || this.isTurning()) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([this.leftPageMesh, this.rightPageMesh], false);
    const hit = hits[0];
    if (!hit?.uv) return null;
    const pageIndex = hit.object === this.leftPageMesh ? this.displayedLeftPage : this.displayedRightPage;
    if (pageIndex < 0 || pageIndex >= this.doc.getPageCount()) return null;
    return { pageIndex, u: hit.uv.x, v: hit.uv.y };
  }

  /** Screen point (client coordinates) of a spot on a resting page. */
  public pagePointToClient(pageIndex: number, u: number, v: number): { x: number; y: number } | null {
    const mesh = pageIndex === this.displayedLeftPage ? this.leftPageMesh : pageIndex === this.displayedRightPage ? this.rightPageMesh : null;
    if (!mesh) return null;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const segZ = 20;
    const rowLength = pos.count / (segZ + 1);
    const segX = rowLength - 1;
    if (!Number.isInteger(rowLength) || segX < 1) return null;
    const fx = Math.max(0, Math.min(segX, u * segX));
    const fz = Math.max(0, Math.min(segZ, v * segZ));
    const ix = Math.min(segX - 1, Math.floor(fx));
    const iz = Math.min(segZ - 1, Math.floor(fz));
    const tx = fx - ix;
    const tz = fz - iz;
    const at = (x: number, z: number) => new THREE.Vector3().fromBufferAttribute(pos, z * rowLength + x);
    const top = at(ix, iz).lerp(at(ix + 1, iz), tx);
    const bottom = at(ix, iz + 1).lerp(at(ix + 1, iz + 1), tx);
    const point = top.lerp(bottom, tz);
    mesh.localToWorld(point);
    point.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - point.y) / 2) * rect.height
    };
  }

  public setLayoutMode(mode: LayoutMode): void {
    if (this.layoutMode === mode) return;
    this.layoutMode = mode;
    this.targetPanX = 0;
    this.targetPanY = 0;
    this.updateCameraFocusForLayout();
    this.handleResize();
    this.requestRender();
  }

  public setZoom(newZoom: number): void {
    this.targetZoom = Math.max(0.85, Math.min(2.4, newZoom));
    if (this.targetZoom <= 1.02) {
      this.targetPanX = 0;
      this.targetPanY = 0;
    }
    this.scheduleZoomResolutionRefresh();
    this.requestRender();
  }

  public getZoom(): number {
    return this.targetZoom;
  }

  public panBy(dxWorld: number, dyWorld: number): void {
    if (this.targetZoom <= 1.02) return;
    const maxPanX = 1.6 * (this.targetZoom - 1);
    const maxPanY = 1.2 * (this.targetZoom - 1);
    this.targetPanX = Math.max(-maxPanX, Math.min(maxPanX, this.targetPanX + dxWorld));
    this.targetPanY = Math.max(-maxPanY, Math.min(maxPanY, this.targetPanY + dyWorld));
    this.requestRender();
  }

  public applyDisplaySettings(settings: DisplaySettings): void {
    const prevTheme = this.displaySettings.theme;
    const prevCurvature = this.displaySettings.curvature;
    const prevBleed = this.displaySettings.bleedThrough;
    this.displaySettings = { ...settings };

    // Theme updates
    this.scene.background = new THREE.Color(STAGE_BG[settings.theme]);
    this.endpaperMaterial.color.setHex(ENDPAPER_COLOR[settings.theme]);
    this.pageEdgeMaterial.color.setHex(EDGE_TINT[settings.theme]);
    this.clothMaterial.color.set(settings.bindingColor);

    const isDark = settings.theme === 'dark';
    this.hemiLight.intensity = isDark ? 1.12 : 1.24;
    this.keyLight.intensity = isDark ? 1.08 : 1.52;
    this.deskShadowMat.opacity = isDark ? 0.36 : 0.21;

    // Paper shader uniforms across resting pages & all pool leaves
    const bleedVal = settings.bleedThrough ? settings.bleedStrength : 0.0;
    const allBundles: PaperMaterialBundle[] = [
      this.leftPageBundle,
      this.rightPageBundle,
      ...this.turnAnimator.getLeaves().map((l) => l.bundle)
    ];
    for (const bundle of allBundles) {
      bundle.uniforms.uShadowStrength.value = settings.shadowStrength;
      bundle.uniforms.uBleedThrough.value = bleedVal;
      bundle.uniforms.uIsDark.value = isDark ? 1.0 : 0.0;
    }

    if (prevTheme !== settings.theme) {
      this.textureCache.setTheme(settings.theme);
      this.refreshStaticPageTextures();
    } else if (!prevBleed && settings.bleedThrough) {
      // Load opposite-side textures for bleed-through when user explicitly toggles ON
      this.refreshStaticPageTextures();
    }

    if (Math.abs(prevCurvature - settings.curvature) > 0.001) {
      this.rebuildBookThickness(this.turnAnimator.getLogicalSpread());
    }

    this.requestRender();
  }

  private rebuildBookThickness(spreadIndex: number): void {
    const totalPages = Math.max(2, this.getTotalPages());
    const totalSpreads = Math.max(1, Math.ceil(totalPages / 2));
    // Balanced hardcover page block thickness (preserves 3D stack cues without lifting text too steeply)
    const totalThickness = Math.min(0.38, Math.max(0.24, 0.23 + totalPages * 0.0009));
    const progress = totalSpreads <= 1 ? 0.5 : spreadIndex / (totalSpreads - 1);

    // Match reference image: early pages -> thin left stack, thick right stack
    const minStack = 0.024;
    const hLeft = minStack + (totalThickness - minStack) * progress;
    const hRight = minStack + (totalThickness - minStack) * (1 - progress);

    this.leftProfile = ensureProfileSegments('left', hLeft, this.displaySettings.curvature);
    this.rightProfile = ensureProfileSegments('right', hRight, this.displaySettings.curvature);

    updateRestingPageGeometry(this.leftPageGeo, 'left', this.leftProfile, 20);
    updateRestingPageGeometry(this.rightPageGeo, 'right', this.rightProfile, 20);

    const newLeftStack = buildPageStackGeometry('left', this.leftProfile);
    this.leftStackMesh.geometry.dispose();
    this.leftStackMesh.geometry = newLeftStack;

    const newRightStack = buildPageStackGeometry('right', this.rightProfile);
    this.rightStackMesh.geometry.dispose();
    this.rightStackMesh.geometry = newRightStack;

    const leftEndX = this.leftProfile[this.leftProfile.length - 1].x;
    const rightEndX = this.rightProfile[this.rightProfile.length - 1].x;
    this.hardcover.updateSpreadWidth(leftEndX, rightEndX);
  }

  private refreshStaticPageTextures(): void {
    const blank = this.textureCache.getBlankTexture();

    const applyPage = (bundle: PaperMaterialBundle, pageIdx: number, oppPageIdx: number) => {
      const frontPeek = this.textureCache.peekTexture(pageIdx) ?? blank;
      bundle.uniforms.uFrontMap.value = frontPeek;
      void this.textureCache.getTexture(pageIdx).then((tex) => {
        // Guard against stale async arrival
        if (
          (bundle === this.leftPageBundle && this.displayedLeftPage === pageIdx) ||
          (bundle === this.rightPageBundle && this.displayedRightPage === pageIdx)
        ) {
          bundle.uniforms.uFrontMap.value = tex;
          this.requestRender();
        }
      });

      if (this.displaySettings.bleedThrough) {
        const backPeek = this.textureCache.peekTexture(oppPageIdx) ?? blank;
        bundle.uniforms.uBackMap.value = backPeek;
        void this.textureCache.getTexture(oppPageIdx).then((tex) => {
          bundle.uniforms.uBackMap.value = tex;
          this.requestRender();
        });
      } else {
        bundle.uniforms.uBackMap.value = blank;
      }
    };

    applyPage(this.leftPageBundle, this.displayedLeftPage, this.displayedLeftPage - 1);
    applyPage(this.rightPageBundle, this.displayedRightPage, this.displayedRightPage + 1);
  }

  private updateCameraFocusForLayout(): void {
    if (this.layoutMode === 'single') {
      const isLeft = this.currentPageIndex % 2 === 0;
      this.cameraTargetX = isLeft ? -PAGE_W * 0.49 : PAGE_W * 0.49;
    } else {
      this.cameraTargetX = 0;
    }
  }

  private updateTextureResolution(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.25);
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    // High-DPI floor (1024px wide min) guarantees crisp serif/Korean strokes even on 1x displays
    const pageScreenPx =
      this.layoutMode === 'spread' ? Math.min(w * 0.44, h * 0.62) : Math.min(w * 0.85, h * 0.72);
    const targetW = Math.round(pageScreenPx * Math.max(1.5, dpr) * Math.min(1.6, Math.max(1.0, this.targetZoom)));
    const clampedW = Math.max(1024, Math.min(1600, targetW));
    const aspect = this.doc ? this.doc.getPageAspectRatio() : PAGE_W / PAGE_H;
    const clampedH = Math.round(clampedW / aspect);
    this.textureCache.setResolution(clampedW, clampedH);
  }

  private scheduleZoomResolutionRefresh(): void {
    if (this.zoomResTimer !== null) window.clearTimeout(this.zoomResTimer);
    this.zoomResTimer = window.setTimeout(() => {
      this.zoomResTimer = null;
      this.updateTextureResolution();
      this.refreshStaticPageTextures();
      this.requestRender();
    }, 180);
  }

  public handleResize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.updateTextureResolution();
    this.refreshStaticPageTextures();
    this.requestRender();
  }

  private computeBaseCameraDistance(): number {
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const tanHalfV = Math.tan(fovRad * 0.5);
    const tanHalfH = tanHalfV * this.camera.aspect;

    // Fit full open book (or single page) cleanly within safe margins between top/bottom bars
    const targetW = this.layoutMode === 'spread' ? PAGE_W * 2.26 : PAGE_W * 1.18;
    const targetH = PAGE_H * 1.30;

    const distForH = targetH / (2 * tanHalfV);
    const distForW = targetW / (2 * tanHalfH);
    return Math.max(distForH, distForW);
  }

  public requestRender(): void {
    this.needsRender = true;
    if (this.rafId === null) {
      this.lastFrameTime = performance.now();
      this.rafId = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number): void => {
    this.rafId = null;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    // FPS tracking
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.35) {
      this.currentFps = Math.round(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    // 1. Step deformable leaves
    const turnState = this.turnAnimator.step(
      dt,
      this.rightProfile,
      this.leftProfile,
      this.displaySettings.curvature
    );

    this.leftPageBundle.uniforms.uTurnShadowX.value = turnState.shadowX;
    this.leftPageBundle.uniforms.uTurnShadowIntensity.value = turnState.shadowIntensity;
    this.rightPageBundle.uniforms.uTurnShadowX.value = turnState.shadowX;
    this.rightPageBundle.uniforms.uTurnShadowIntensity.value = turnState.shadowIntensity;

    // 2. Smooth camera framing / zoom / pan damping
    const damp = 1 - Math.exp(-12 * dt);
    const prevZoom = this.zoom;
    const prevPanX = this.panX;
    const prevPanY = this.panY;
    const prevCamX = this.currentCamX;

    this.zoom += (this.targetZoom - this.zoom) * damp;
    this.panX += (this.targetPanX - this.panX) * damp;
    this.panY += (this.targetPanY - this.panY) * damp;
    this.currentCamX += (this.cameraTargetX - this.currentCamX) * damp;

    const cameraMoving =
      Math.abs(this.targetZoom - this.zoom) > 0.001 ||
      Math.abs(this.targetPanX - this.panX) > 0.001 ||
      Math.abs(this.targetPanY - this.panY) > 0.001 ||
      Math.abs(this.cameraTargetX - this.currentCamX) > 0.001 ||
      Math.abs(prevZoom - this.zoom) > 0.0005 ||
      Math.abs(prevPanX - this.panX) > 0.0005 ||
      Math.abs(prevPanY - this.panY) > 0.0005 ||
      Math.abs(prevCamX - this.currentCamX) > 0.0005;

    // Position camera along an elevated reading angle (~19 deg off vertical) so 3D arch & page stacks pop
    const dist = this.computeBaseCameraDistance() / this.zoom;
    const tiltRad = THREE.MathUtils.degToRad(19.0);
    const lookX = this.currentCamX + this.panX;
    const lookZ = 0.04 + this.panY;

    this.camera.position.set(
      lookX,
      Math.cos(tiltRad) * dist,
      lookZ + Math.sin(tiltRad) * dist
    );
    this.camera.lookAt(lookX, 0.12, lookZ);

    // 3. Render
    this.renderer.render(this.scene, this.camera);
    this.needsRender = false;

    if (this.displaySettings.showPerfHud && this.onStatsUpdate) {
      const res = this.textureCache.getResolution();
      this.onStatsUpdate({
        fps: this.currentFps,
        cachedTextures: this.textureCache.getCachedCount(),
        maxTextures: this.textureCache.getMaxEntries(),
        activeLeaves: this.turnAnimator.getActiveCount(),
        texWidth: res.width,
        texHeight: res.height
      });
    }

    // On-Demand Render Loop: sleep completely when settled to save GPU/battery
    if (turnState.stillActive || cameraMoving || this.needsRender) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  public dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.zoomResTimer !== null) window.clearTimeout(this.zoomResTimer);
    this.turnAnimator.dispose();
    this.textureCache.dispose();
    this.leftPageGeo.dispose();
    this.rightPageGeo.dispose();
    this.leftStackMesh.geometry.dispose();
    this.rightStackMesh.geometry.dispose();
    this.leftPageBundle.material.dispose();
    this.rightPageBundle.material.dispose();
    this.clothMaterial.dispose();
    this.endpaperMaterial.dispose();
    this.pageEdgeMaterial.dispose();
    this.renderer.dispose();
    // Give the GL context back now: tabs and 2D/3D switches would otherwise pile them up.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
