import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { openSync, type Font, type FontCollection } from 'fontkit'

const FONT_EXTENSIONS = new Set(['.dfont', '.otc', '.otf', '.ttc', '.ttf'])
const HANGUL_SAMPLE_CODE_POINTS = [0xac00, 0xd55c]

let koreanFontFamiliesPromise: Promise<string[]> | null = null

function getSystemFontDirectories(): string[] {
  if (process.platform === 'darwin') {
    return [
      '/System/Library/Fonts',
      '/Library/Fonts',
      join(homedir(), 'Library', 'Fonts')
    ]
  }

  if (process.platform === 'win32') {
    const windowsDirectory = process.env.WINDIR || 'C:\\Windows'
    return [
      join(windowsDirectory, 'Fonts'),
      join(homedir(), 'AppData', 'Local', 'Microsoft', 'Windows', 'Fonts')
    ]
  }

  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    join(homedir(), '.fonts'),
    join(homedir(), '.local', 'share', 'fonts')
  ]
}

async function collectFontFiles(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) return collectFontFiles(entryPath)
    if (!entry.isFile() || !FONT_EXTENSIONS.has(extname(entry.name).toLowerCase())) return []
    return [entryPath]
  }))

  return files.flat()
}

function getFonts(fontFile: string): Font[] {
  try {
    const opened = openSync(fontFile)
    return 'fonts' in opened ? (opened as FontCollection).fonts : [opened as Font]
  } catch {
    return []
  }
}

function supportsKorean(font: Font): boolean {
  return HANGUL_SAMPLE_CODE_POINTS.every((codePoint) => font.hasGlyphForCodePoint(codePoint))
}

async function scanKoreanSystemFonts(): Promise<string[]> {
  const files = (await Promise.all(getSystemFontDirectories().map(collectFontFiles))).flat()
  const families = new Set<string>()

  for (const file of files) {
    for (const font of getFonts(file)) {
      const familyName = font.familyName?.trim()
      if (familyName && !familyName.startsWith('.') && supportsKorean(font)) {
        families.add(familyName)
      }
    }
  }

  return [...families].sort((a, b) => a.localeCompare(b, 'ko-KR', { sensitivity: 'base' }))
}

export function listKoreanSystemFonts(): Promise<string[]> {
  koreanFontFamiliesPromise ??= scanKoreanSystemFonts().catch((error) => {
    koreanFontFamiliesPromise = null
    console.error('Failed to scan Korean system fonts:', error)
    return []
  })
  return koreanFontFamiliesPromise
}
