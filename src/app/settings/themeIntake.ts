import { useEffect } from 'react'
import { isDesktop } from '../../bridge/window'
import {
  THEME_FILE_MAX_BYTES,
  fileBaseName,
  findSameTheme,
  isThemeFileName,
  parseThemeFileContent,
  type ThemeFileContent,
} from '../../core/themeFile'
import { uniqueThemeName } from '../../core/userTheme'
import { setAppPref } from '../appPrefs'
import { MAX_USER_THEMES, getUserThemeState, saveUserTheme, setActiveUserTheme } from './userThemeStore'

/** 테마 파일 하나(끌어 놓기·탐색기에서 열기·파일 고르기로 들어온 것). 읽기에 실패했으면 readError */
export interface IncomingThemeFile {
  readonly name: string
  readonly text?: string
  readonly readError?: string
}

export type IncomingThemeCheck =
  | { readonly kind: 'ok'; readonly file: string; readonly content: ThemeFileContent }
  | { readonly kind: 'error'; readonly file: string; readonly error: string }

export function checkIncomingThemeFile(file: IncomingThemeFile): IncomingThemeCheck {
  if (file.readError !== undefined) return { kind: 'error', file: file.name, error: file.readError }
  const parsed = parseThemeFileContent(file.text ?? '')
  return parsed.ok ? { kind: 'ok', file: file.name, content: parsed.content } : { kind: 'error', file: file.name, error: parsed.error }
}

/**
 * 끌어 놓은 경로를 가른다. .iwtheme 는 어디에 놓아도 테마 파일이고,
 * .json 은 설정의 테마 구역 위에 놓았을 때만 테마 파일로 본다(다른 JSON 을 문서로 가져오려는 것일 수 있다).
 */
export function partitionThemeDrop(paths: readonly string[], overThemeSection: boolean): { readonly themePaths: string[]; readonly rest: string[] } {
  const themePaths: string[] = []
  const rest: string[] = []
  for (const path of paths) (isThemeFileName(path, overThemeSection) ? themePaths : rest).push(path)
  return { themePaths, rest }
}

/** 놓은 자리가 설정의 테마 구역(data-theme-drop) 안인가 */
export function isOverThemeSection(point: { readonly x: number; readonly y: number } | undefined, root: Document = document): boolean {
  if (point === undefined) return false
  return root.elementFromPoint(point.x, point.y)?.closest('[data-theme-drop]') != null
}

export function hasThemeFile(paths: readonly string[]): boolean {
  return paths.some((path) => isThemeFileName(path))
}

/** 경로의 파일을 읽는다(데스크톱). 못 읽으면 readError 로 */
export async function readThemePaths(paths: readonly string[]): Promise<IncomingThemeFile[]> {
  const out: IncomingThemeFile[] = []
  for (const path of paths) {
    const name = fileBaseName(path)
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      out.push({ name, text: await readTextFile(path) })
    } catch {
      out.push({ name, readError: '파일을 읽지 못했습니다.' })
    }
  }
  return out
}

/** 브라우저(미리보기)에서 끌어 놓거나 고른 File 들 */
export async function readThemeBlobs(files: readonly File[]): Promise<IncomingThemeFile[]> {
  const out: IncomingThemeFile[] = []
  for (const file of files) {
    if (file.size > THEME_FILE_MAX_BYTES) { out.push({ name: file.name, readError: '파일이 너무 큽니다. 테마 파일은 256KB 이하여야 합니다.' }); continue }
    try {
      out.push({ name: file.name, text: await file.text() })
    } catch {
      out.push({ name: file.name, readError: '파일을 읽지 못했습니다.' })
    }
  }
  return out
}

/* ── 들어온 파일을 확인 창으로 보내는 통로(App 의 끌어 놓기 처리 → ThemeIntakeHost) ── */
type Offer = (files: readonly IncomingThemeFile[]) => void
const offerListeners = new Set<Offer>()

export function offerThemeFiles(files: readonly IncomingThemeFile[]): void {
  if (files.length === 0) return
  for (const listener of offerListeners) listener(files)
}

export function useThemeFileOffers(listener: Offer): void {
  useEffect(() => {
    offerListeners.add(listener)
    return () => { offerListeners.delete(listener) }
  }, [listener])
}

/** 경로로 들어온 파일(데스크톱) 읽어서 확인 창으로 */
export async function offerThemePaths(paths: readonly string[]): Promise<void> {
  if (!isDesktop()) return
  offerThemeFiles(await readThemePaths(paths))
}

export type ThemeImportOutcome =
  | { readonly ok: true; readonly name: string; readonly added: boolean; readonly applied: boolean; readonly highlightColors: boolean }
  | { readonly ok: false; readonly error: string }

/**
 * 확인 창에서 [추가] / [추가하고 적용]을 눌렀을 때. 이름이 겹치면 「숲 (2)」, 색까지 똑같은 테마가 이미 있으면 새로 만들지 않고 그것을 쓴다.
 * withHighlights 면 파일의 형광펜 색으로 형광펜 색 목록을 바꾼다.
 */
export function importThemeFile(content: ThemeFileContent, options: { readonly apply: boolean; readonly withHighlights: boolean }): ThemeImportOutcome {
  const state = getUserThemeState()
  const same = findSameTheme(content.theme, state.themes)
  let name = content.theme.name
  let id = content.theme.id
  let added = false
  if (same !== undefined) {
    name = same.name
    id = same.id
  } else {
    if (state.themes.length >= MAX_USER_THEMES) return { ok: false, error: `내 테마는 ${MAX_USER_THEMES}개까지 둘 수 있습니다. 안 쓰는 테마를 지운 뒤 다시 해 주세요.` }
    name = uniqueThemeName(content.theme.name, [...state.themes, ...state.folderThemes].map((theme) => theme.name))
    saveUserTheme({ ...content.theme, name })
    added = true
  }
  if (options.apply) setActiveUserTheme(id)
  const withHighlights = options.withHighlights && content.highlightColors !== undefined
  if (withHighlights) setAppPref('highlightColors', content.highlightColors ?? [])
  return { ok: true, name, added, applied: options.apply, highlightColors: withHighlights }
}

/* ── 테마 파일을 끌고 있는 동안 창 아래에 띄울 안내(App 의 끌어 놓기 감시가 켜고 끈다) ── */
let hovering = false
const hoverListeners = new Set<() => void>()

export function setThemeDropHover(active: boolean): void {
  if (hovering === active) return
  hovering = active
  for (const listener of hoverListeners) listener()
}

export function subscribeThemeDropHover(listener: () => void): () => void {
  hoverListeners.add(listener)
  return () => { hoverListeners.delete(listener) }
}

export function getThemeDropHover(): boolean {
  return hovering
}
