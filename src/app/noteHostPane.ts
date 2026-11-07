import { useEffect, useState, type RefObject } from 'react'

const CHANGE_EVENT = 'iwae:note-host-panes'

/**
 * 노트 바는 창 맨 오른쪽에 하나만 둔다. 화면을 여러 칸(문서 창)으로 나눴을 때 이 문서 창이 그 자리인가:
 * 문서가 열려 보이는 창(.pane-frame) 가운데 오른쪽 끝이 가장 오른쪽이고, 그중 가장 위에 있는 창.
 * 창 크기·배치가 바뀌면 다시 잰다.
 */
export function useIsNoteHostPane(ref: RefObject<HTMLElement | null>): boolean {
  const [host, setHost] = useState(true)
  useEffect(() => {
    const element = ref.current
    const frame = element?.closest<HTMLElement>('.pane-frame') ?? null
    if (frame === null) return undefined
    const measure = () => {
      const frames = [...document.querySelectorAll<HTMLElement>('.pane-frame')]
        // 문서가 열린 창만(빈 창에는 노트를 둘 문서가 없다)
        .filter((item) => item.offsetWidth > 0 && item.closest('[aria-hidden="true"]') === null && item.querySelector('.pdf-pane, .markdown-pane-host') !== null)
      if (frames.length <= 1) { setHost(true); return }
      const rects = frames.map((item) => ({ item, rect: item.getBoundingClientRect() }))
      const right = Math.max(...rects.map(({ rect }) => rect.right))
      const rightmost = rects.filter(({ rect }) => rect.right >= right - 2)
      const top = Math.min(...rightmost.map(({ rect }) => rect.top))
      setHost(rightmost.some(({ item, rect }) => item === frame && rect.top <= top + 2))
    }
    measure()
    // 다른 창에 문서가 열리거나 닫히면 모두 다시 잰다(이 창 크기는 그대로일 수 있다)
    const announce = () => window.setTimeout(() => window.dispatchEvent(new Event(CHANGE_EVENT)), 0)
    announce()
    window.addEventListener(CHANGE_EVENT, measure)
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    const app = document.querySelector('.app') ?? document.body
    observer.observe(app)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener(CHANGE_EVENT, measure)
      announce()
    }
  }, [ref])
  return host
}
