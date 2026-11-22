import { unzipSync } from 'fflate';
import type { BookMetadata, TocItem } from '../../types/book';

export interface ParsedSpineItem {
  id: string;
  href: string;
  fullPath: string;
  xhtml: string;
  chapterTitle: string;
  /** EPUB CFI base of this spine item (as epub.js builds it), e.g. `/6/14[chap01]`. */
  cfiBase: string;
}

export interface ParsedEpub {
  metadata: BookMetadata;
  spine: ParsedSpineItem[];
  files: Map<string, Uint8Array>;
  opfDir: string;
  loadedFontFamilies: string[];
  cleanupFonts: () => void;
}

const FONT_OBFUSCATION_ALGORITHMS = new Set([
  'http://www.idpf.org/2008/embedding',
  'http://ns.adobe.com/pdf/enc#RC'
]);

function normalizePath(path: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  })();
  const parts = decoded.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

export function resolveRelativePath(baseDir: string, href: string): string {
  const cleanHref = href.split('#')[0].split('?')[0];
  if (!cleanHref) return '';
  if (cleanHref.startsWith('/')) return normalizePath(cleanHref.slice(1));
  return normalizePath(baseDir ? `${baseDir}/${cleanHref}` : cleanHref);
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '';
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function parseXml(xmlText: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return parser.parseFromString(xmlText, 'text/html');
  }
  return doc;
}

function getFileBytes(files: Map<string, Uint8Array>, path: string): Uint8Array | undefined {
  const norm = normalizePath(path);
  const direct = files.get(norm);
  if (direct) return direct;
  const lower = norm.toLowerCase();
  for (const [k, v] of files.entries()) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function guessMime(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.ttf')) return 'font/ttf';
  if (lower.endsWith('.otf')) return 'font/otf';
  return 'application/octet-stream';
}

export async function parseEpubBuffer(buffer: ArrayBuffer): Promise<ParsedEpub> {
  let rawEntries: Record<string, Uint8Array>;
  try {
    rawEntries = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error('유효한 ZIP/EPUB 아카이브가 아닙니다.');
  }

  const files = new Map<string, Uint8Array>();
  for (const [key, bytes] of Object.entries(rawEntries)) {
    files.set(normalizePath(key), bytes);
  }

  // 1. Check DRM (distinguish real DRM from standard font obfuscation)
  const encBytes = getFileBytes(files, 'META-INF/encryption.xml');
  const obfuscatedPaths = new Set<string>();
  if (encBytes) {
    const encDoc = parseXml(decodeUtf8(encBytes));
    const encNodes = Array.from(encDoc.getElementsByTagName('*')).filter(
      (el) => el.localName === 'EncryptedData'
    );
    for (const node of encNodes) {
      const methodEl = Array.from(node.getElementsByTagName('*')).find(
        (el) => el.localName === 'EncryptionMethod'
      );
      const alg = methodEl?.getAttribute('Algorithm') ?? '';
      const refEl = Array.from(node.getElementsByTagName('*')).find(
        (el) => el.localName === 'CipherReference'
      );
      const uri = normalizePath(refEl?.getAttribute('URI') ?? '');
      if (FONT_OBFUSCATION_ALGORITHMS.has(alg)) {
        if (uri) obfuscatedPaths.add(uri);
      } else if (alg) {
        throw new Error(
          'DRM(암호화)이 적용된 EPUB 파일은 지원하지 않습니다. DRM이 없는 일반 EPUB 파일을 사용해 주세요.'
        );
      }
    }
  }

  // 2. Locate OPF via META-INF/container.xml
  const containerBytes = getFileBytes(files, 'META-INF/container.xml');
  if (!containerBytes) {
    throw new Error('EPUB 메타데이터(META-INF/container.xml)를 찾을 수 없습니다.');
  }
  const containerDoc = parseXml(decodeUtf8(containerBytes));
  const rootfileEl = Array.from(containerDoc.getElementsByTagName('*')).find(
    (el) => el.localName === 'rootfile'
  );
  const opfPath = normalizePath(rootfileEl?.getAttribute('full-path') ?? '');
  if (!opfPath) {
    throw new Error('OPF 패키지 경로를 확인할 수 없습니다.');
  }
  const opfBytes = getFileBytes(files, opfPath);
  if (!opfBytes) {
    throw new Error(`OPF 파일(${opfPath})을 찾을 수 없습니다.`);
  }

  const opfDir = dirname(opfPath);
  const opfDoc = parseXml(decodeUtf8(opfBytes));

  // 3. Parse Metadata
  const getMetaText = (localName: string): string => {
    const el = Array.from(opfDoc.getElementsByTagName('*')).find(
      (n) => n.localName === localName && n.textContent?.trim()
    );
    return el?.textContent?.trim() ?? '';
  };

  const title = getMetaText('title') || 'Untitled EPUB';
  const author = getMetaText('creator') || '';
  const language = getMetaText('language') || 'en';

  // 4. Parse Manifest
  interface ManifestEntry {
    id: string;
    href: string;
    fullPath: string;
    mediaType: string;
    properties: string;
  }
  const manifestById = new Map<string, ManifestEntry>();
  const manifestByPath = new Map<string, ManifestEntry>();
  let navItem: ManifestEntry | undefined;
  let ncxItem: ManifestEntry | undefined;
  let coverItem: ManifestEntry | undefined;

  const metaCoverEl = Array.from(opfDoc.getElementsByTagName('*')).find(
    (n) => n.localName === 'meta' && n.getAttribute('name') === 'cover'
  );
  const coverIdHint = metaCoverEl?.getAttribute('content') ?? '';

  const itemEls = Array.from(opfDoc.getElementsByTagName('*')).filter(
    (n) => n.localName === 'item'
  );
  for (const el of itemEls) {
    const id = el.getAttribute('id') ?? '';
    const href = el.getAttribute('href') ?? '';
    const mediaType = el.getAttribute('media-type') ?? '';
    const properties = el.getAttribute('properties') ?? '';
    if (!id || !href) continue;
    const fullPath = resolveRelativePath(opfDir, href);
    const entry: ManifestEntry = { id, href, fullPath, mediaType, properties };
    manifestById.set(id, entry);
    manifestByPath.set(fullPath, entry);

    if (properties.split(/\s+/).includes('nav')) navItem = entry;
    if (mediaType === 'application/x-dtbncx+xml') ncxItem = entry;
    if (properties.split(/\s+/).includes('cover-image') || (coverIdHint && id === coverIdHint)) {
      coverItem = entry;
    }
  }

  // Cover data URL (if available)
  let coverDataUrl: string | null = null;
  if (coverItem) {
    const coverBytes = getFileBytes(files, coverItem.fullPath);
    if (coverBytes) {
      const blob = new Blob([coverBytes.slice()], { type: coverItem.mediaType || guessMime(coverItem.fullPath) });
      coverDataUrl = URL.createObjectURL(blob);
    }
  }

  // 5. Parse Spine
  const spineEl = Array.from(opfDoc.getElementsByTagName('*')).find(
    (n) => n.localName === 'spine'
  );
  if (!ncxItem && spineEl) {
    const tocId = spineEl.getAttribute('toc');
    if (tocId) ncxItem = manifestById.get(tocId);
  }

  const itemrefEls = Array.from(opfDoc.getElementsByTagName('*')).filter(
    (n) => n.localName === 'itemref'
  );
  const spine: ParsedSpineItem[] = [];
  const spinePathToIndex = new Map<string, number>();

  // epub.js numbers spine items among all itemrefs (linear="no" included) and the spine
  // element among the package's element children; CFIs made here must match its own.
  const spineNodeIndex = spineEl?.parentElement ? Array.from(spineEl.parentElement.children).indexOf(spineEl) : 2;
  for (const [refIndex, ref] of itemrefEls.entries()) {
    if (ref.getAttribute('linear') === 'no') continue;
    const idref = ref.getAttribute('idref') ?? '';
    const item = manifestById.get(idref);
    if (!item) continue;
    const bytes = getFileBytes(files, item.fullPath);
    if (!bytes) continue;
    const xhtml = decodeUtf8(bytes);
    const idx = spine.length;
    spinePathToIndex.set(item.fullPath, idx);
    spine.push({
      id: item.id,
      href: item.href,
      fullPath: item.fullPath,
      xhtml,
      chapterTitle: '',
      cfiBase: `/${(spineNodeIndex + 1) * 2}/${(refIndex + 1) * 2}${ref.getAttribute('id') ? `[${ref.getAttribute('id')}]` : ''}`
    });
  }

  if (spine.length === 0) {
    throw new Error('EPUB 내에서 읽을 수 있는 본문 챕터(Spine)를 찾지 못했습니다.');
  }

  // 6. Parse TOC (EPUB 3 nav.xhtml first, then EPUB 2 toc.ncx)
  const toc: TocItem[] = [];
  if (navItem) {
    const navBytes = getFileBytes(files, navItem.fullPath);
    if (navBytes) {
      const navDir = dirname(navItem.fullPath);
      const navDoc = parseXml(decodeUtf8(navBytes));
      const navEl =
        Array.from(navDoc.getElementsByTagName('*')).find(
          (n) =>
            n.localName === 'nav' &&
            (n.getAttribute('epub:type')?.includes('toc') || n.getAttribute('type')?.includes('toc'))
        ) ??
        Array.from(navDoc.getElementsByTagName('*')).find((n) => n.localName === 'nav');

      if (navEl) {
        const walkList = (container: Element, depth: number) => {
          for (const child of Array.from(container.children)) {
            if (child.localName === 'ol' || child.localName === 'ul') {
              walkList(child, depth);
            } else if (child.localName === 'li') {
              const link = Array.from(child.children).find((c) => c.localName === 'a');
              if (link) {
                const label = link.textContent?.replace(/\s+/g, ' ').trim() ?? '';
                const href = link.getAttribute('href') ?? '';
                const resolved = resolveRelativePath(navDir, href);
                const spineIndex = spinePathToIndex.get(resolved) ?? 0;
                if (label) {
                  toc.push({ label, href: resolved, spineIndex, depth });
                }
              }
              for (const nested of Array.from(child.children)) {
                if (nested.localName === 'ol' || nested.localName === 'ul') {
                  walkList(nested, depth + 1);
                }
              }
            }
          }
        };
        walkList(navEl, 0);
      }
    }
  }

  if (toc.length === 0 && ncxItem) {
    const ncxBytes = getFileBytes(files, ncxItem.fullPath);
    if (ncxBytes) {
      const ncxDir = dirname(ncxItem.fullPath);
      const ncxDoc = parseXml(decodeUtf8(ncxBytes));
      const navMap = Array.from(ncxDoc.getElementsByTagName('*')).find(
        (n) => n.localName === 'navMap'
      );
      if (navMap) {
        const walkNavPoints = (el: Element, depth: number) => {
          for (const child of Array.from(el.children)) {
            if (child.localName === 'navPoint') {
              const textEl = Array.from(child.getElementsByTagName('*')).find(
                (n) => n.localName === 'text'
              );
              const contentEl = Array.from(child.children).find(
                (c) => c.localName === 'content'
              );
              const label = textEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
              const src = contentEl?.getAttribute('src') ?? '';
              const resolved = resolveRelativePath(ncxDir, src);
              const spineIndex = spinePathToIndex.get(resolved) ?? 0;
              if (label) {
                toc.push({ label, href: resolved, spineIndex, depth });
              }
              walkNavPoints(child, depth + 1);
            }
          }
        };
        walkNavPoints(navMap, 0);
      }
    }
  }

  // Assign chapter titles to spine items from TOC (or <title>/<h1> fallback later)
  for (const item of toc) {
    if (spine[item.spineIndex] && !spine[item.spineIndex].chapterTitle) {
      spine[item.spineIndex].chapterTitle = item.label;
    }
  }

  // 7. Register non-obfuscated embedded fonts via FontFace API
  const loadedFaces: FontFace[] = [];
  const loadedFontFamilies: string[] = [];
  for (const entry of manifestById.values()) {
    const isFont =
      entry.mediaType.startsWith('font/') ||
      entry.mediaType.includes('font') ||
      /\.(woff2?|ttf|otf)$/i.test(entry.fullPath);
    if (!isFont || obfuscatedPaths.has(entry.fullPath)) continue;
    const bytes = getFileBytes(files, entry.fullPath);
    if (!bytes) continue;
    try {
      const familyName = `EpubFont_${loadedFaces.length}`;
      const face = new FontFace(familyName, bytes.slice().buffer);
      await face.load();
      document.fonts.add(face);
      loadedFaces.push(face);
      loadedFontFamilies.push(familyName);
    } catch {
      // Ignore malformed font files and fall back gracefully
    }
  }

  return {
    metadata: {
      title,
      author,
      language,
      coverDataUrl,
      toc
    },
    spine,
    files,
    opfDir,
    loadedFontFamilies,
    cleanupFonts: () => {
      for (const face of loadedFaces) {
        document.fonts.delete(face);
      }
      if (coverDataUrl) {
        URL.revokeObjectURL(coverDataUrl);
      }
    }
  };
}
