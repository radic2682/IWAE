import { isDesktop } from './window'
import { partitionDroppedDocumentPaths } from '../core/documentDrop'
import { isThemeFileName } from '../core/themeFile'

const noop = () => undefined

/** 놓은(끄는 중인) 자리. 화면(CSS px) 좌표 */
export interface DropPoint {
  readonly x: number
  readonly y: number
}

/**
 * 탐색기에서 파일을 끌어 놓기. 어디에 놓았는지(point)도 같이 알려 준다 —
 * 왼쪽 바에 놓으면 Vault 로 가져오고, PDF 자리에 놓으면 열기만 한다(App 이 고른다).
 */
export async function listenForDocumentDrop(
  listener: (paths: readonly string[], point?: DropPoint) => void,
  onActiveChange?: (active: boolean, point?: DropPoint) => void,
  /** 테마 파일(.iwtheme)을 끌고 들어오면 true, 나가거나 놓으면 false */
  onThemeHover?: (active: boolean) => void,
): Promise<() => void> {
  if (!isDesktop()) return noop

  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  // Tauri 는 물리 픽셀로 준다. 화면 배율(앱 확대 포함)로 나눠 CSS 좌표로 바꾼다
  const toCss = (position: { x: number; y: number } | undefined): DropPoint | undefined => {
    if (position === undefined) return undefined
    const ratio = window.devicePixelRatio || 1
    return { x: position.x / ratio, y: position.y / ratio }
  }
  let accepted = false
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'enter') {
      accepted = partitionDroppedDocumentPaths(event.payload.paths).accepted.length > 0
      onThemeHover?.(event.payload.paths.some((path) => isThemeFileName(path)))
      onActiveChange?.(accepted, toCss(event.payload.position))
    }
    if (event.payload.type === 'over' && accepted) onActiveChange?.(true, toCss(event.payload.position))
    if (event.payload.type === 'leave') {
      accepted = false
      onActiveChange?.(false)
      onThemeHover?.(false)
    }
    if (event.payload.type === 'drop') {
      accepted = false
      onThemeHover?.(false)
      onActiveChange?.(false)
      listener(event.payload.paths, toCss(event.payload.position))
    }
  })
}
