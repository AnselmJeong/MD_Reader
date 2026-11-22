export type ThemeMode = 'light' | 'sepia' | 'dark';
export type LayoutMode = 'spread' | 'single';
export type FontPreset = 'serif-classic' | 'serif-kr' | 'sans-clean';
export type MarginPreset = 'compact' | 'balanced' | 'wide';

export interface TypographySettings {
  fontPreset: FontPreset;
  fontSizePx: number;
  lineHeight: number;
  marginPreset: MarginPreset;
  textAlign: 'justify' | 'left';
  /** A font the reader picked in the host app; replaces the preset when set. */
  fontFamily?: string;
}

export interface DisplaySettings {
  theme: ThemeMode;
  curvature: number;        // 0.0 ~ 1.0 (default 0.65)
  shadowStrength: number;   // 0.0 ~ 1.0 (default 0.55)
  bleedThrough: boolean;    // default false (PRD core requirement)
  bleedStrength: number;    // 0.05 ~ 0.45 (default 0.18 when enabled)
  bindingColor: string;     // hex color e.g. #2b46a8
  showPerfHud: boolean;
}

export interface ReadingAnchor {
  spineIndex: number;
  blockIndex: number;
  tokenOffset: number;
  globalProgress: number; // 0..1
}

export interface TocItem {
  label: string;
  href: string;
  spineIndex: number;
  pageIndex?: number;
  depth: number;
}

export interface BookMetadata {
  title: string;
  author: string;
  language: string;
  coverDataUrl?: string | null;
  toc: TocItem[];
}

export interface PageRenderTheme {
  paperBg: string;
  inkColor: string;
  mutedColor: string;
  ruleColor: string;
  quoteBg: string;
}

export const THEME_PALETTES: Record<ThemeMode, PageRenderTheme> = {
  light: {
    paperBg: '#fcfaf5',
    inkColor: '#141311',
    mutedColor: '#5c5850',
    ruleColor: '#d4cec2',
    quoteBg: 'rgba(120, 108, 90, 0.06)'
  },
  sepia: {
    paperBg: '#f4ecd8',
    inkColor: '#2c2317',
    mutedColor: '#75644b',
    ruleColor: '#d5c6a8',
    quoteBg: 'rgba(130, 100, 55, 0.08)'
  },
  dark: {
    paperBg: '#232428',
    inkColor: '#dcd9d0',
    mutedColor: '#8d8a82',
    ruleColor: '#3a3c42',
    quoteBg: 'rgba(255, 255, 255, 0.04)'
  }
};

export interface BookDocument {
  readonly format: 'epub' | 'pdf';
  readonly isReflowable: boolean;
  readonly metadata: BookMetadata;

  getPageCount(): number;
  getPageAspectRatio(): number;
  getPageIndexForSpine(spineIndex: number): number;

  renderPage(
    pageIndex: number,
    targetCanvas: HTMLCanvasElement,
    pixelWidth: number,
    pixelHeight: number,
    theme: ThemeMode
  ): Promise<void>;

  getAnchorForPage(pageIndex: number): ReadingAnchor;
  relayout?(settings: TypographySettings, anchor: ReadingAnchor): Promise<number>;
  dispose(): void;
}
