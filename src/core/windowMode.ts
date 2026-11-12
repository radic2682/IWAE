import { emptySession, type SessionState } from './session'

/**
 * 창의 역할. 같은 앱 화면(App)을 그대로 쓰고, 창을 만들 때 주소의 매개변수로 역할만 알려 준다.
 * - main: 평소 창. 세션(탭·패널 배치)을 저장하고, 닫을 때 다른 창을 정리한다
 * - detached: PDF 하나를 떼어 낸 창. 왼쪽 바 없이 문서 패널 하나(「옆에 노트 열기」로 노트를 옆에 열 수 있다). 닫으면 탭이 메인으로 돌아간다
 * - extra: 같은 Vault 의 전체 화면 새 창. 탭은 빈 채로 시작한다
 */
export type WindowRole = 'main' | 'detached' | 'extra'

/** PDF 칸의 배율(DocumentView 의 ZoomState 와 같은 모양) */
export interface DocZoom {
  readonly fit: 'width' | 'page' | 'height' | null
  readonly actual: number
}

export interface WindowMode {
  readonly role: WindowRole
  /** detached: 떼어 낸 문서 id */
  readonly docId: string | null
  /** detached: 시작 쪽(1부터) */
  readonly page: number | null
  readonly zoom: DocZoom | null
  /** 열 Vault 폴더(없으면 최근 Vault) */
  readonly vaultRoot: string | null
}

export const MAIN_WINDOW: WindowMode = { role: 'main', docId: null, page: null, zoom: null, vaultRoot: null }

const FITS = ['width', 'page', 'height'] as const

export function parseWindowMode(search: string): WindowMode {
  const params = new URLSearchParams(search)
  const role = params.get('role')
  if (role !== 'detached' && role !== 'extra') return MAIN_WINDOW
  const docId = params.get('doc')
  if (role === 'detached' && (docId === null || docId === '')) return MAIN_WINDOW
  const pageValue = Number(params.get('page'))
  const zoomValue = Number(params.get('zoom'))
  const fit = FITS.find((candidate) => candidate === params.get('fit')) ?? null
  const hasZoom = params.has('fit') || (params.has('zoom') && Number.isFinite(zoomValue) && zoomValue > 0)
  return {
    role,
    docId: role === 'detached' ? docId : null,
    page: Number.isInteger(pageValue) && pageValue >= 1 ? pageValue : null,
    zoom: hasZoom ? { fit, actual: Number.isFinite(zoomValue) && zoomValue > 0 ? zoomValue : 100 } : null,
    vaultRoot: params.get('vault') === '' ? null : params.get('vault'),
  }
}

/** 새 창의 주소 매개변수 */
export function windowQuery(mode: Omit<WindowMode, 'zoom'> & { readonly zoom?: DocZoom | null }): string {
  const params = new URLSearchParams()
  params.set('role', mode.role)
  if (mode.docId !== null) params.set('doc', mode.docId)
  if (mode.page !== null) params.set('page', String(mode.page))
  if (mode.zoom !== undefined && mode.zoom !== null) {
    if (mode.zoom.fit !== null) params.set('fit', mode.zoom.fit)
    params.set('zoom', String(mode.zoom.actual))
  }
  if (mode.vaultRoot !== null) params.set('vault', mode.vaultRoot)
  return params.toString()
}

let current: WindowMode | null = null

/** 이 창의 역할(창이 사는 동안 바뀌지 않는다) */
export function currentWindowMode(): WindowMode {
  if (current === null) {
    current = typeof window === 'undefined' ? MAIN_WINDOW : parseWindowMode(window.location.search)
  }
  return current
}

/** 테스트에서 창 역할을 바꿔 끼운다 */
export function setWindowModeForTest(mode: WindowMode | null): void {
  current = mode
}

/**
 * session.json(탭·패널 배치)을 쓰는 창인가. 메인 창만 쓴다 — 떼어 낸 창과 새 창이 자기 배치를 쓰면
 * 메인이 다음에 켜질 때 복원할 탭이 그 창의 것으로 바뀌어 버린다.
 */
export function ownsSession(mode: WindowMode): boolean {
  return mode.role === 'main'
}

/** 이 창이 시작할 때의 탭·배치. 메인은 저장된 세션 그대로, 다른 창은 자기 몫만 */
export function sessionForWindow(mode: WindowMode, saved: SessionState): SessionState {
  if (mode.role === 'detached' && mode.docId !== null) {
    return {
      ...emptySession,
      pdfTabIds: [mode.docId],
      activePdfTabId: mode.docId,
      // 떼어 낸 창엔 왼쪽 바가 없다
      sidebarCollapsed: true,
    }
  }
  if (mode.role === 'extra') {
    // 새 창은 빈 탭에서 시작한다(탭으로 연 메모 노트도 이어받지 않는다)
    const { memoNoteTabIds: _memoNoteTabIds, ...rest } = saved
    return {
      ...rest,
      pdfTabIds: [],
      noteTabIds: [],
      activePdfTabId: null,
      activeNoteTabId: null,
      panes: undefined,
      layout: undefined,
      paneState: undefined,
      paneChannels: undefined,
    }
  }
  return saved
}
