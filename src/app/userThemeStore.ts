import { useSyncExternalStore } from 'react'
import { normalizeHex } from '../core/colorMath'
import { parseUserTheme, type UserTheme } from '../core/userTheme'

/**
 * 사용자 지정 테마·직접 고른 강조색의 저장소(이 PC 에만, localStorage). appPrefs 처럼 모듈 하나가 값을 들고
 * 구독자에게 알리고, 다른 창에서 바뀐 값은 storage 이벤트로 받아 같은 모양으로 반영한다.
 * draft 는 편집기에서 고치는 중인 테마로, 저장하지 않고 앱 화면에만 바로 비춘다(취소하면 사라진다).
 */
export interface UserThemeState {
  readonly themes: readonly UserTheme[]
  /** 지금 쓰는 사용자 테마 id. null 이면 내장 색 구성 */
  readonly activeId: string | null
  /** "직접 고르기" 강조색(#rrggbb) */
  readonly customAccent: string
  readonly draft: UserTheme | null
}

export const THEMES_KEY = 'iwae.theme.user-themes'
export const ACTIVE_KEY = 'iwae.theme.user-active'
export const CUSTOM_ACCENT_KEY = 'iwae.theme.custom-accent'
export const DEFAULT_CUSTOM_ACCENT = '#ff8a5c'
export const MAX_USER_THEMES = 24

export function parseStoredThemes(text: string | null): UserTheme[] {
  try {
    const list = JSON.parse(text ?? '[]') as unknown
    if (!Array.isArray(list)) return []
    const seen = new Set<string>()
    const out: UserTheme[] = []
    for (const item of list) {
      const parsed = parseUserTheme(item)
      if (parsed.ok && !seen.has(parsed.theme.id)) {
        seen.add(parsed.theme.id)
        out.push(parsed.theme)
      }
    }
    return out.slice(0, MAX_USER_THEMES)
  } catch {
    return []
  }
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeRaw(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch { /* 이번 실행만 */ }
}

function load(draft: UserTheme | null): UserThemeState {
  const themes = parseStoredThemes(readRaw(THEMES_KEY))
  const active = readRaw(ACTIVE_KEY)
  return {
    themes,
    activeId: active !== null && themes.some((theme) => theme.id === active) ? active : null,
    customAccent: normalizeHex(readRaw(CUSTOM_ACCENT_KEY) ?? '') ?? DEFAULT_CUSTOM_ACCENT,
    draft,
  }
}

let state: UserThemeState = typeof window === 'undefined' ? { themes: [], activeId: null, customAccent: DEFAULT_CUSTOM_ACCENT, draft: null } : load(null)
const listeners = new Set<() => void>()

function commit(next: UserThemeState): void {
  state = next
  for (const listener of listeners) listener()
}

export function getUserThemeState(): UserThemeState {
  return state
}

export function subscribeUserThemes(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUserThemes(): UserThemeState {
  return useSyncExternalStore(subscribeUserThemes, getUserThemeState, getUserThemeState)
}

/** 새로 만들거나(같은 id 가 없으면 끝에 붙인다) 고친다. 저장 뒤에는 그 테마를 쓴다 */
export function saveUserTheme(theme: UserTheme, options: { readonly activate?: boolean } = {}): void {
  const exists = state.themes.some((item) => item.id === theme.id)
  const themes = exists ? state.themes.map((item) => (item.id === theme.id ? theme : item)) : [...state.themes, theme].slice(-MAX_USER_THEMES)
  writeRaw(THEMES_KEY, JSON.stringify(themes))
  const activeId = options.activate === true ? theme.id : state.activeId
  writeRaw(ACTIVE_KEY, activeId)
  commit({ ...state, themes, activeId })
}

/** 지운 테마가 쓰던 중이면 돌려준 값이 true — 호출한 쪽이 내장 색 구성(웨일)으로 되돌린다 */
export function deleteUserTheme(id: string): boolean {
  const themes = state.themes.filter((item) => item.id !== id)
  const wasActive = state.activeId === id
  writeRaw(THEMES_KEY, JSON.stringify(themes))
  if (wasActive) writeRaw(ACTIVE_KEY, null)
  commit({ ...state, themes, activeId: wasActive ? null : state.activeId })
  return wasActive
}

export function setActiveUserTheme(id: string | null): void {
  const activeId = id !== null && state.themes.some((item) => item.id === id) ? id : null
  if (activeId === state.activeId) return
  writeRaw(ACTIVE_KEY, activeId)
  commit({ ...state, activeId })
}

export function setCustomAccent(hex: string): void {
  const next = normalizeHex(hex)
  if (next === null || next === state.customAccent) return
  writeRaw(CUSTOM_ACCENT_KEY, next)
  commit({ ...state, customAccent: next })
}

export function setThemeDraft(draft: UserTheme | null): void {
  commit({ ...state, draft })
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== THEMES_KEY && event.key !== ACTIVE_KEY && event.key !== CUSTOM_ACCENT_KEY) return
    commit(load(state.draft))
  })
}

/** 테스트용: 저장소를 비우고 다시 읽는다 */
export function reloadUserThemesForTest(): void {
  commit(load(null))
}
