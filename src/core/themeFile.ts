import { t } from '../i18n'
import { normalizeHex } from './colorMath'
import {
  MAX_HIGHLIGHT_COLORS,
  MAX_HIGHLIGHT_NAME_LENGTH,
  newHighlightColorId,
  type HighlightColorDef,
} from './highlightColors'
import {
  SEED_KEYS,
  newThemeId,
  parseUserTheme,
  type SeedKey,
  type UserTheme,
} from './userTheme'

/**
 * 테마 파일(.iwtheme, 안은 JSON). 모양은 docs/themes/README.md 에 설명이 있다.
 *
 * {
 *   "format": "iwae-theme",   // 꼭 이 값
 *   "version": 1,             // 파일 모양 버전. 이 앱은 1 만 읽는다
 *   "description": "…",       // 사람이 읽는 설명(앱은 읽지 않는다)
 *   "theme": { "name", "base", "light": {시드 8개}, "dark": {시드 8개} },
 *   "highlightColors": [ { "name", "fill" } ]   // 고르기: 있으면 가져올 때 같이 적용할지 묻는다
 * }
 */
export const THEME_FILE_EXTENSION = '.iwtheme'
export const THEME_FILE_FORMAT = 'iwae-theme'
export const THEME_FILE_VERSION = 1
/** 이보다 큰 파일은 테마 파일이 아니라고 본다 */
export const THEME_FILE_MAX_BYTES = 256 * 1024

/** .iwtheme 만(끌어 놓기·폴더·탐색기에서 열기). allowJson 이면 .json 도(파일 고르기·설정 화면에 놓기) */
export function isThemeFileName(name: string, allowJson = false): boolean {
  const lower = name.trim().toLowerCase()
  return lower.endsWith(THEME_FILE_EXTENSION) || (allowJson && lower.endsWith('.json'))
}

export function fileBaseName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path
}

export interface ThemeFileContent {
  readonly theme: UserTheme
  /** 파일에 형광펜 색이 들어 있었다면(최대 8개, 문서에 이미 쓴 id 와 겹치지 않도록 id 는 새로 만든다) */
  readonly highlightColors?: readonly HighlightColorDef[]
  /** 읽다가 무시한 부분 안내(테마 자체는 쓸 수 있다) */
  readonly warnings: readonly string[]
}

export type ThemeFileResult = { readonly ok: true; readonly content: ThemeFileContent } | { readonly ok: false; readonly error: string }

const HIGHLIGHT_ID = /^[A-Za-z0-9_-]{1,32}$/

function parseHighlightBlock(value: unknown, warnings: string[]): HighlightColorDef[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    warnings.push(t('형광펜 색(highlightColors)이 목록이 아니어서 건너뛰었습니다.'))
    return undefined
  }
  const used: string[] = []
  const out: HighlightColorDef[] = []
  value.forEach((item, index) => {
    const n = index + 1
    if (out.length >= MAX_HIGHLIGHT_COLORS) {
      if (out.length === MAX_HIGHLIGHT_COLORS && index === MAX_HIGHLIGHT_COLORS) warnings.push(t('형광펜 색은 {max}개까지만 씁니다.', { max: MAX_HIGHLIGHT_COLORS }))
      return
    }
    if (typeof item !== 'object' || item === null) { warnings.push(t('형광펜 색 {n}번째 항목이 올바른 모양이 아니어서 건너뛰었습니다.', { n })); return }
    const raw = item as Record<string, unknown>
    const fill = typeof raw.fill === 'string' ? normalizeHex(raw.fill) : null
    if (fill === null) { warnings.push(t('형광펜 색 {n}번째 항목의 fill 값이 #rrggbb 색이 아니어서 건너뛰었습니다.', { n })); return }
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_HIGHLIGHT_NAME_LENGTH) : ''
    // 노랑·초록·파랑·분홍(yellow·green·blue·pink)의 id 를 그대로 적어 두면 이미 칠한 형광펜의 색이 이어진다
    const wanted = typeof raw.id === 'string' && HIGHLIGHT_ID.test(raw.id) && !used.includes(raw.id) ? raw.id : null
    const id = wanted ?? newHighlightColorId(used)
    used.push(id)
    out.push({ id, name: name === '' ? t('색 {n}', { n }) : name, fill })
  })
  if (out.length === 0) {
    warnings.push(t('형광펜 색이 하나도 올바르지 않아 건너뛰었습니다.'))
    return undefined
  }
  return out
}

/** 가져온 파일 글자 → 새 테마(새 id) + 고를 수 있는 형광펜 색. 틀리면 사용자에게 보일 한 줄 이유 */
export function parseThemeFileContent(text: string): ThemeFileResult {
  if (text.length > THEME_FILE_MAX_BYTES) return { ok: false, error: t('파일이 너무 큽니다. 테마 파일은 256KB 이하여야 합니다.') }
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/u, ''))
  } catch {
    return { ok: false, error: t('JSON 형식이 아닙니다. 따옴표, 쉼표, 괄호를 확인하세요.') }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, error: t('IWAE 테마 파일이 아닙니다. 가장 바깥이 { } 모양이어야 합니다.') }
  const file = data as Record<string, unknown>
  if (file.format !== THEME_FILE_FORMAT) return { ok: false, error: t('IWAE 테마 파일이 아닙니다. "format": "{format}"이 있어야 합니다.', { format: THEME_FILE_FORMAT }) }
  if (file.version === undefined) return { ok: false, error: t('파일 버전("version")이 없습니다. 이 앱은 버전 {supported} 파일을 읽습니다.', { supported: THEME_FILE_VERSION }) }
  if (file.version !== THEME_FILE_VERSION) return { ok: false, error: t('지원하지 않는 테마 파일 버전입니다(버전 {found}). 이 앱은 버전 {supported} 파일을 읽습니다.', { found: String(file.version), supported: THEME_FILE_VERSION }) }
  if (file.theme === undefined) return { ok: false, error: t('"theme" 항목이 없습니다.') }
  const parsed = parseUserTheme(file.theme, newThemeId())
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const warnings: string[] = []
  const highlightColors = parseHighlightBlock(file.highlightColors, warnings)
  return { ok: true, content: { theme: parsed.theme, ...(highlightColors === undefined ? {} : { highlightColors }), warnings } }
}

/** 예전 모양 그대로: 테마만 필요할 때 */
export function parseThemeFile(text: string): { readonly ok: true; readonly theme: UserTheme } | { readonly ok: false; readonly error: string } {
  const result = parseThemeFileContent(text)
  return result.ok ? { ok: true, theme: result.content.theme } : result
}

const FILE_DESCRIPTION = 'IWAE 테마 파일 · IWAE theme file. 자세한 설명 · Guide: docs/themes/README.md'

export function serializeThemeFile(theme: UserTheme, options: { readonly highlightColors?: readonly HighlightColorDef[] } = {}): string {
  const file = {
    format: THEME_FILE_FORMAT,
    version: THEME_FILE_VERSION,
    description: FILE_DESCRIPTION,
    theme: { name: theme.name, base: theme.base, light: theme.light, dark: theme.dark },
    ...(options.highlightColors === undefined ? {} : { highlightColors: options.highlightColors.map(({ id, name, fill }) => ({ id, name, fill })) }),
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** 시드가 칠하는 곳(한국어 / English). 템플릿 파일의 seedGuide 와 docs/themes/README.md 가 같은 말을 쓴다 */
export const SEED_GUIDE: Readonly<Record<SeedKey, string>> = {
  workspace: '작업 공간 바탕: 문서 뒤, 칸 사이 / Workspace: behind the documents, between panes',
  panel: '패널: 왼쪽 바, 노트 바, 대화상자 / Panels: left bar, note bar, dialogs',
  tabstrip: '탭 줄: 맨 위 줄 / Tab strip: the top row',
  field: '입력칸: 검색칸, 선택칸 / Fields: search box, selects',
  text: '글자: 기본 글자색(패널·작업 공간 위에서 읽혀야 함) / Text: main text colour (must read on panels and workspace)',
  divider: '구분선: 칸·목록 사이 선 / Divider: lines between panes and rows',
  accent: '강조색: 선택·버튼·링크 / Accent: selection, buttons, links',
  memoCard: '메모 카드: 노트 바 카드 바탕(늘 밝은 종이 느낌 권장) / Memo card: note-bar card background (a light paper tone is recommended)',
}

/**
 * 「템플릿 저장」: 지금 색으로 채운 테마 파일. JSON 에는 주석이 없어서 description·seedGuide 에 설명을 적어 둔다
 * (앱은 이 두 항목을 읽지 않으니 지우거나 고쳐도 된다).
 */
export function buildTemplateFile(theme: UserTheme, highlightColors: readonly HighlightColorDef[]): string {
  const file = {
    format: THEME_FILE_FORMAT,
    version: THEME_FILE_VERSION,
    description: [
      '이 파일을 고쳐 .iwtheme로 저장한 뒤 IWAE 창에 끌어 놓거나, Vault의 .iwae/themes 폴더에 넣으세요.',
      'Edit this file, save it as .iwtheme, then drop it onto the IWAE window or put it in the vault .iwae/themes folder.',
      '색은 모두 #rrggbb입니다. theme.light, theme.dark에 시드 색 8개씩을 넣으면 나머지는 앱이 계산합니다. All colours are #rrggbb; the app derives the rest.',
      'highlightColors는 선택 항목이며 지워도 됩니다. highlightColors is optional; delete it to leave highlight colours alone.',
    ].join('\n'),
    seedGuide: Object.fromEntries(SEED_KEYS.map((key) => [key, SEED_GUIDE[key]])),
    theme: { name: theme.name, base: theme.base, light: theme.light, dark: theme.dark },
    highlightColors: highlightColors.map(({ name, fill }) => ({ name, fill })),
  }
  return `${JSON.stringify(file, null, 2)}\n`
}

/** 폴더의 테마 id: 파일 이름이 같으면 늘 같은 id(활성 테마를 다시 켤 때 이어진다) */
export function folderThemeId(fileName: string): string {
  let hash = 5381
  for (const char of fileName.toLowerCase()) hash = ((hash << 5) + hash + (char.codePointAt(0) ?? 0)) >>> 0
  const stem = fileName.replace(/\.[^.]*$/u, '').replace(/[^A-Za-z0-9_-]+/gu, '_').slice(0, 24)
  return `${FOLDER_THEME_PREFIX}${stem}-${hash.toString(36)}`
}

export const FOLDER_THEME_PREFIX = 'vf-'

export function isFolderThemeId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(FOLDER_THEME_PREFIX)
}

export interface FolderThemeFile {
  readonly name: string
  readonly text: string
}

export interface FolderThemeError {
  readonly file: string
  readonly error: string
}

export interface FolderThemeLoad {
  readonly themes: readonly UserTheme[]
  readonly errors: readonly FolderThemeError[]
}

/**
 * 폴더에서 읽은 파일들 → 테마 목록. 파일 이름 순으로 늘 같은 결과.
 * 이름이 이미 있으면(저장한 내 테마·앞선 파일) 「숲 (2)」 로 바꾼다. 틀린 파일은 errors 로 모은다(나머지는 계속 읽는다).
 */
export function buildFolderThemes(files: readonly FolderThemeFile[], takenNames: readonly string[]): FolderThemeLoad {
  const taken = [...takenNames]
  const themes: UserTheme[] = []
  const errors: FolderThemeError[] = []
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  for (const file of sorted) {
    const parsed = parseThemeFileContent(file.text)
    if (!parsed.ok) {
      errors.push({ file: file.name, error: parsed.error })
      continue
    }
    const name = uniqueName(parsed.content.theme.name, taken)
    taken.push(name)
    themes.push({ ...parsed.content.theme, id: folderThemeId(file.name), name, file: file.name })
  }
  return { themes, errors }
}

function uniqueName(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) return name
  for (let n = 2; n < 1000; n++) if (!taken.includes(`${name} (${n})`)) return `${name} (${n})`
  return name
}

/** 같은 이름·같은 색의 테마가 이미 있나(끌어 놓은 파일을 또 놓았을 때 두 번 추가하지 않으려고) */
export function findSameTheme(theme: UserTheme, existing: readonly UserTheme[]): UserTheme | undefined {
  const same = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) => SEED_KEYS.every((key) => a[key] === b[key])
  return existing.find((item) => item.name === theme.name && item.base === theme.base && same(item.light, theme.light) && same(item.dark, theme.dark))
}
