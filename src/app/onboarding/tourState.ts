import { planTours, type TourPlan } from '../../core/tours'

/**
 * 둘러보기의 저장 상태와 앱 안 신호.
 * 본 것(또는 미룬 것)은 이 PC 의 localStorage 에 둔다. Vault 마다가 아니라 설치마다다.
 */
export const TOURS_SEEN_KEY = 'iwae:tours-seen:v1'

const LAST_SEEN_VERSION_KEY = 'iwae:last-seen-version:v1'

/**
 * 이 앱을 전에 쓴 흔적.
 * - last-seen-version: 시작할 때마다 적는다(0.1.17 이후).
 * - onboarded: 처음 Vault 를 고를 때 적는 설치 안내 표시(VaultPicker).
 * - app-prefs · launch-seen: 설정을 바꾸거나 시작 그림을 한 번 본 뒤에 생긴다.
 * 하나라도 있으면 쓰던 사람이다. 지금 쓰고 있는 사람에게 처음 사용 안내를 저절로 띄우지 않으려는 것이다.
 */
const INSTALL_SIGNS = [LAST_SEEN_VERSION_KEY, 'iwae:onboarded:v1', 'iwae:app-prefs:v1', 'iwae:launch-seen:v1'] as const

export interface InstallSnapshot {
  readonly lastSeenVersion: string | null
  readonly hasExistingInstall: boolean
}

function read(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

/**
 * 앱이 이 실행에서 아무것도 적기 전의 모습. 「새 버전」 창이 마지막 버전을, Vault 고르기가 안내 표시를 적기 때문에
 * 판단은 시작 순간의 값으로 해야 처음 설치와 업데이트가 갈린다. 불러올 때 한 번 잡는다.
 */
export function captureInstallSnapshot(): InstallSnapshot {
  snapshot = {
    lastSeenVersion: read(LAST_SEEN_VERSION_KEY),
    hasExistingInstall: INSTALL_SIGNS.some((key) => read(key) !== null),
  }
  return snapshot
}

let snapshot: InstallSnapshot = { lastSeenVersion: null, hasExistingInstall: false }
captureInstallSnapshot()

export function installSnapshot(): InstallSnapshot {
  return snapshot
}

export function readToursSeen(): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(read(TOURS_SEEN_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function markToursSeen(ids: readonly string[]): void {
  if (ids.length === 0) return
  const next = [...new Set([...readToursSeen(), ...ids])]
  try { window.localStorage.setItem(TOURS_SEEN_KEY, JSON.stringify(next)) } catch { /* 저장 못 하면 다음 실행에 한 번 더 보인다 */ }
}

/** 지금 버전에서 저절로 보일 둘러보기(시작 순간의 모습 기준) */
export function planStartupTours(currentVersion: string): TourPlan {
  return planTours({ ...installSnapshot(), currentVersion, seen: readToursSeen() })
}

/* ---- 새 버전 창과 둘러보기 사이의 대화: 「새 기능 둘러보기」를 눌렀는가 ---- */

export type TourIntent = 'undecided' | 'accepted' | 'declined'

let intent: TourIntent = 'undecided'
const intentListeners = new Set<() => void>()

export function tourIntent(): TourIntent {
  return intent
}

export function setTourIntent(next: TourIntent): void {
  if (next === intent) return
  intent = next
  for (const listener of [...intentListeners]) listener()
}

export function subscribeTourIntent(listener: () => void): () => void {
  intentListeners.add(listener)
  return () => { intentListeners.delete(listener) }
}

/** 시험용 */
export function resetTourState(): void {
  intent = 'undecided'
  for (const listener of [...intentListeners]) listener()
}

/* ---- 직접 열기(팔레트 · 메뉴) ---- */

const REQUEST_EVENT = 'iwae:tour-request'

/** 이 둘러보기를 지금 연다(본 적이 있어도) */
export function requestTour(id: string): void {
  window.dispatchEvent(new CustomEvent<string>(REQUEST_EVENT, { detail: id }))
}

export function onTourRequest(handler: (id: string) => void): () => void {
  const listener = (event: Event) => {
    const id = (event as CustomEvent<unknown>).detail
    if (typeof id === 'string') handler(id)
  }
  window.addEventListener(REQUEST_EVENT, listener)
  return () => window.removeEventListener(REQUEST_EVENT, listener)
}
