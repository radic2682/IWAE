import { useLayoutEffect, type RefObject } from 'react'

/**
 * 스크롤 영역 오른쪽에 남겨 둔 막대 자리(10px)에는 내용이 그려지지 않는다(배경도 그 자리 앞에서 잘린다).
 * 그래서 목록 중간의 머리 줄(예: 노트 머리 줄)의 밑선이 막대 자리 앞에서 끊긴다.
 * 스크롤 영역 밖(부모)에 10px 짜리 선을 두고, 머리 줄 밑선 높이에 맞춰 옮겨 선이 끝까지 이어지게 한다.
 * 위쪽에 붙어 있는 머리 줄(sticky) 아래로 지나가면 숨긴다.
 */
export interface GutterLine { readonly top: number; readonly visible: boolean }

/** 머리 줄 밑선의 화면 위치(bottom-1)를 부모 기준 top 으로 바꾸고, 보이는 범위(minTop~maxTop) 밖이면 숨긴다 */
export function gutterLinePlacement(lineY: number, parentTop: number, minY: number, maxY: number): GutterLine {
  return { top: Math.round(lineY - parentTop), visible: lineY >= minY && lineY <= maxY }
}

const LINE_CLASS = 'side-gutter-head-line'

export function useGutterHeadLines(ref: RefObject<HTMLElement | null>, selector = '.side-notebook-head'): void {
  useLayoutEffect(() => {
    const scroller = ref.current
    const parent = scroller?.parentElement ?? null
    if (scroller === null || parent === null) return undefined
    const lines: HTMLElement[] = []
    let frame = 0
    const update = (): void => {
      frame = 0
      const parentBox = parent.getBoundingClientRect()
      const box = scroller.getBoundingClientRect()
      const heads = [...scroller.querySelectorAll<HTMLElement>(selector)].filter((head) => head.offsetParent !== null && getComputedStyle(head).position !== 'sticky')
      // 맨 위에 붙어 있는 머리 줄의 아래 끝(그 위로는 선을 그리지 않는다)
      const stickyBottom = [...scroller.querySelectorAll<HTMLElement>('.side-documents-head, .outline-section-head')]
        .filter((head) => getComputedStyle(head).position === 'sticky')
        .reduce((max, head) => Math.max(max, head.getBoundingClientRect().bottom), box.top)
      while (lines.length < heads.length) {
        const line = document.createElement('div')
        line.className = LINE_CLASS
        line.setAttribute('aria-hidden', 'true')
        parent.appendChild(line)
        lines.push(line)
      }
      lines.forEach((line, index) => {
        const head = heads[index]
        if (head === undefined) { line.hidden = true; return }
        const placement = gutterLinePlacement(head.getBoundingClientRect().bottom - 1, parentBox.top, stickyBottom, box.bottom - 1)
        line.hidden = !placement.visible
        line.style.top = `${placement.top}px`
        line.style.left = `${Math.round(box.right - parentBox.left - (scroller.offsetWidth - scroller.clientWidth))}px`
        line.style.width = `${scroller.offsetWidth - scroller.clientWidth}px`
      })
    }
    const schedule = (): void => { if (frame === 0) frame = requestAnimationFrame(update) }
    update()
    scroller.addEventListener('scroll', schedule, { passive: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(scroller)
    for (const child of [...scroller.children]) resize.observe(child)
    const mutation = new MutationObserver(() => {
      for (const child of [...scroller.children]) resize.observe(child)
      schedule()
    })
    mutation.observe(scroller, { childList: true, subtree: true })
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', schedule)
      resize.disconnect()
      mutation.disconnect()
      for (const line of lines) line.remove()
    }
  }, [ref, selector])
}
