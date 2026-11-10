/**
 * 여러 창(Rust windows.rs)과 창 사이 알림. `@tauri-apps/api` 는 쓸 때 불러온다(브라우저·테스트에서 화면이 뜨게).
 */
import { currentWindowLabel, isDesktop } from './window'
import type { DocZoom } from '../core/windowMode'

export interface OpenedWindow {
  readonly label: string
  /** 이미 열려 있던 창을 앞으로 가져왔다 */
  readonly existing: boolean
}

/** 창을 연다. kind: 'detached'(PDF 하나를 떼어 낸 창) · 'extra'(새 창) */
export async function openAppWindow(kind: 'detached' | 'extra', query: string, docId?: string): Promise<OpenedWindow | null> {
  if (!isDesktop()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<OpenedWindow>('open_app_window', { kind, docId: docId ?? null, query })
}

/**
 * 메인 창이 닫히기 전에 다른 창을 모두 닫는다(각 창이 저장하고 스스로 닫힐 때까지 기다린다). 닫으라고 한 창의 수를 돌려준다.
 * 떼어 낸 창은 닫히면서 탭을 메인으로 돌려보내므로, 돌려받은 탭이 메인의 세션에 실리게 메인이 잠시 뒤 세션을 다시 저장한다
 */
export async function closeSecondaryWindows(): Promise<number> {
  if (!isDesktop()) return 0
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<number>('close_secondary_windows')
}

/** 메인 창이 「닫으라」고 알렸다 */
export async function onCloseNow(handler: () => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen('iwae:close-now', () => handler())
}

/** 떼어 낸 창이 닫히면서 메인 창에 돌려주는 탭 */
export interface ReattachRequest {
  readonly docId: string
  readonly page: number
  readonly zoom: DocZoom | null
  /** 보낸 창 label */
  readonly source: string
}

export async function sendReattach(request: Omit<ReattachRequest, 'source'>): Promise<void> {
  if (!isDesktop()) return
  const { emitTo } = await import('@tauri-apps/api/event')
  await emitTo('main', 'iwae:reattach', { ...request, source: currentWindowLabel() })
}

/** 메인 창에서: 떼어 낸 창이 탭을 돌려보냈다 */
export async function onReattach(handler: (request: ReattachRequest) => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<ReattachRequest>('iwae:reattach', (event) => handler(event.payload))
}

/** 이 창을 앞으로 가져온다 */
export async function focusThisWindow(): Promise<void> {
  if (!isDesktop()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const window = getCurrentWindow()
    await window.unminimize()
    await window.setFocus()
  } catch {
    // 앞으로 못 가져와도 탭은 돌아왔다
  }
}
