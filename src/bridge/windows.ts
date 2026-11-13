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
  /** 끌어서 붙일 때: 놓은 자리의 패널과 창 안 x 좌표(CSS 픽셀). 없으면 평소처럼 지금 패널 끝에 연다 */
  readonly pane?: string
  readonly x?: number
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

// ── 탭을 끌어 창을 떼어 내고 붙이기(Rust windows.rs 의 begin_tab_drag …) ──────────────────

/** 창 안 탭 줄 한 칸. 창 안쪽 왼쪽 위에서 잰 물리 픽셀 */
export interface TabZoneRect {
  readonly pane: string
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  /** 이 창의 CSS 픽셀 하나가 물리 픽셀 몇 개인가(devicePixelRatio) — 놓은 자리를 CSS 좌표로 바꾸는 데 쓴다 */
  readonly ratio?: number
}

export async function reportTabZones(zones: readonly TabZoneRect[]): Promise<void> {
  if (!isDesktop()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('report_tab_zones', { zones })
}

/** 다른 창이 탭을 끌기 시작했다: 이 창의 탭 줄 자리를 알려 달라 */
export async function onTabZonesRequest(handler: () => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen('iwae:tab-zones-request', () => handler())
}

export interface BeginTabDragArgs {
  /** new: docId 의 PDF 를 떼어 낸 새 창이 마우스를 따라간다 · self: 이 창이 통째로 따라간다 */
  readonly mode: 'new' | 'self'
  /** new: 새 창의 종류. 기본은 PDF 를 떼어 낸 창('detached'), 'extra' 는 세션에 붙는 새 앱 창(노트 · Markdown 탭을 새 화면에 담아 떼어 낼 때) */
  readonly kind?: 'detached' | 'extra'
  readonly docId?: string
  readonly query?: string
  /** new: 새 창 안에서 마우스가 놓일 자리(왼쪽 위에서, 물리 픽셀) */
  readonly grabX?: number
  readonly grabY?: number
  /** 'js': 마우스 자리·놓음을 웹뷰가 알려 준다(시험·버튼을 못 읽는 환경). 기본은 운영체제에서 읽는다 */
  readonly source?: 'os' | 'js'
  /** 마우스 버튼이 이미 떼어졌다(창 밖에서 놓아 떼어 내는 길): 창을 만들어 놓은 자리에 놓고, 다른 창의 탭 줄 자리가 올 때까지 잠깐 기다린 뒤 바로 놓음 알림을 보낸다 */
  readonly alreadyReleased?: boolean
  readonly x?: number
  readonly y?: number
}

export interface BeganTabDrag {
  readonly label: string
  /** 같은 문서의 창이 이미 있어 앞으로 가져왔다(끌기는 시작하지 않았다) */
  readonly existing: boolean
}

export async function beginTabDrag(args: BeginTabDragArgs): Promise<BeganTabDrag | null> {
  if (!isDesktop()) return null
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<BeganTabDrag>('begin_tab_drag', { args })
}

export async function tabDragMove(x: number, y: number): Promise<void> {
  if (!isDesktop()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('tab_drag_move', { x, y })
}

export async function tabDragEnd(cancel = false): Promise<void> {
  if (!isDesktop()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('tab_drag_end', { cancel })
}

/** 끄는 창을 닫는다(탭을 다른 창에 붙인 뒤). 떼어 낸 창·새 창만 닫힌다 */
export async function destroyAppWindow(label: string): Promise<void> {
  if (!isDesktop()) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('destroy_app_window', { label })
}

/** 끌던 창이 마우스를 놓았다(끌기를 시작한 창이 받는다). target 은 놓은 자리의 IWAE 창(탭 줄 위일 때만) */
export interface TabDragReleased {
  readonly dragged: string
  readonly target: string | null
  readonly pane: string | null
  /** 대상 창 안쪽 왼쪽 위에서 잰 CSS 픽셀 */
  readonly x: number
  readonly y: number
}

export async function onTabDragReleased(handler: (event: TabDragReleased) => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<TabDragReleased>('iwae:tab-drag-released', (event) => handler(event.payload))
}

/** 다른 창의 탭이 이 창의 탭 줄 위로 왔다 / 벗어났다 */
export interface TabHover {
  readonly source: string
  readonly pane: string
  readonly x: number
  readonly y: number
}

export async function onTabHover(handler: (event: TabHover) => void, onEnd: () => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  const stops = await Promise.all([
    listen<TabHover>('iwae:tab-hover', (event) => handler(event.payload)),
    listen('iwae:tab-hover-end', () => onEnd()),
  ])
  return () => { for (const stop of stops) stop() }
}

/** 탭을 target 창의 탭 줄(pane)에 붙여 달라고 보낸다 */
export async function sendTabDrop(target: string, request: Omit<ReattachRequest, 'source'>): Promise<void> {
  if (!isDesktop()) return
  const { emitTo } = await import('@tauri-apps/api/event')
  await emitTo(target, 'iwae:reattach', { ...request, source: currentWindowLabel() })
}

// ── 노트 · Markdown 탭을 새 화면에 담아 떼어 낸 앱 창 ──────────────────────────────

/** 떼어 낸 앱 창을 다른 앱 창의 탭 줄에 놓았다: 그 창에 탭을 붙여 달라는 부탁 */
export interface TabAttachRequest {
  /** 붙일 탭의 id(노트 경로 · Markdown 경로) */
  readonly tabId: string
  /** 떼어 낸 탭이 담긴 새 화면의 id(같은 탭이 다른 화면에도 있어도 이 화면에서만 찾는다) */
  readonly screenId: string
  /** 놓은 자리의 칸과 대상 창 안 x 좌표(CSS 픽셀) */
  readonly pane: string
  readonly x: number
  /** 보낸 창 label */
  readonly source: string
}

export async function sendTabAttach(target: string, request: Omit<TabAttachRequest, 'source'>): Promise<void> {
  if (!isDesktop()) return
  const { emitTo } = await import('@tauri-apps/api/event')
  await emitTo(target, 'iwae:tab-attach', { ...request, source: currentWindowLabel() })
}

export async function onTabAttach(handler: (request: TabAttachRequest) => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<TabAttachRequest>('iwae:tab-attach', (event) => handler(event.payload))
}

/** 받은 창이 붙였는지(ok) 보낸 창에 알린다 */
export interface TabAttachAck {
  readonly tabId: string
  readonly screenId: string
  readonly ok: boolean
}

export async function sendTabAttachAck(target: string, ack: TabAttachAck): Promise<void> {
  if (!isDesktop()) return
  const { emitTo } = await import('@tauri-apps/api/event')
  await emitTo(target, 'iwae:tab-attach-ack', ack)
}

/** 붙여 달라고 보내고 받은 창이 붙였다고 답할 때까지 기다린다. 답이 없거나(시간 초과) 못 붙였으면 false — 보낸 창은 그러면 떼어 낸 창을 닫지 않는다 */
export async function requestTabAttach(target: string, request: Omit<TabAttachRequest, 'source'>, timeoutMs = 1500): Promise<boolean> {
  if (!isDesktop()) return false
  const { listen } = await import('@tauri-apps/api/event')
  let settle: (ok: boolean) => void = () => undefined
  const answered = new Promise<boolean>((resolve) => { settle = resolve })
  const unlisten = await listen<TabAttachAck>('iwae:tab-attach-ack', (event) => {
    if (event.payload.tabId === request.tabId && event.payload.screenId === request.screenId) settle(event.payload.ok)
  })
  const timer = setTimeout(() => settle(false), timeoutMs)
  try {
    await sendTabAttach(target, request)
    return await answered
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    unlisten()
  }

}
