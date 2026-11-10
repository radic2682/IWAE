/**
 * 창 조작. `@tauri-apps/api` 를 import 하는 곳은 bridge/ 뿐이다 —
 * app/ 과 core/ 가 Tauri 를 직접 알면 `npm run dev`(브라우저)와
 * `npm test`(jsdom) 에서 앱 전체가 뜨지 않는다.
 *
 * import 를 함수 안에서 동적으로 하는 이유: 정적 import 면 모듈이 로드되는
 * 순간 Tauri 런타임을 찾아서, Tauri 가 없는 브라우저·테스트에서 화면을
 * 그리기도 전에 터진다. 여기서는 "누를 때" 찾는다.
 */

/** Tauri 창 안에서 돌고 있는가. 웹뷰에 주입되는 내부 객체로 판별한다. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * 이 창의 label. 웹뷰에 주입되는 메타데이터에서 동기로 읽는다(메인 창은 'main', 떼어 낸 창은 'detached-…', 새 창은 'window-…').
 * 브라우저·테스트에서는 'main'.
 */
export function currentWindowLabel(): string {
  if (typeof window === 'undefined') return 'main'
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__
  return internals?.metadata?.currentWindow?.label ?? 'main'
}

async function withWindow(run: (w: { minimize(): Promise<void>; toggleMaximize(): Promise<void>; close(): Promise<void> }) => Promise<void>) {
  // 브라우저에서는 조용히 아무 일도 하지 않는다. 개발 중 미리보기로만
  // 쓰는 경로라 여기서 오류를 띄우면 소음만 된다.
  if (!isDesktop()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await run(getCurrentWindow())
}

export function minimizeWindow(): void {
  void withWindow((w) => w.minimize())
}

export function toggleMaximizeWindow(): void {
  void withWindow((w) => w.toggleMaximize())
}

export function closeWindow(): void {
  void withWindow((w) => w.close())
}

export async function interceptWindowClose(
  beforeClose: () => Promise<void>,
  onError: (cause: unknown) => void,
): Promise<() => void> {
  if (!isDesktop()) return () => undefined
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()
  let closing = false
  return appWindow.onCloseRequested(async (event) => {
    if (closing) return
    event.preventDefault()
    try {
      await beforeClose()
      closing = true
      // destroy 로 닫으면 창 위치 플러그인이 위치를 남기지 않는다. 다음에 켤 때 같은 자리·크기로 열리게 먼저 남긴다
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('save_window_state')
      } catch {
        // 위치를 못 남겨도 닫기는 한다
      }
      await appWindow.destroy()
    } catch (cause) {
      onError(cause)
    }
  })
}

/** 창이 최대화돼 있는지 지켜본다. 최대화 단추 모양(□ / 겹친 □)을 바꾸는 데 쓴다. */
export async function watchMaximized(onChange: (maximized: boolean) => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()
  const refresh = () => {
    void appWindow.isMaximized().then(onChange, () => undefined)
  }
  refresh()
  return appWindow.onResized(refresh)
}
