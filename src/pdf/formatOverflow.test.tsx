// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoFormatBar } from './MemoEditor'

/** 크기 관찰자 스텁: 쓰는 쪽이 어떤 요소를 지켜보는지 모은다 */
const watched = new Set<Element>()
let resizeCallbacks: (() => void)[] = []

beforeEach(() => {
  watched.clear()
  resizeCallbacks = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.push(callback) }
    observe(element: Element) { watched.add(element) }
    unobserve(element: Element) { watched.delete(element) }
    disconnect() { watched.clear() }
  })
  // 레이아웃 흉내: 도구줄 600, 서식 묶음 하나 80, 곁의 묶음은 data-w
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
    const width = this.classList.contains('note-format-dock') ? 600 : this.dataset.cluster !== undefined ? 80 : Number(this.dataset.w ?? 0)
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const moreButton = () => screen.queryByRole('button', { name: '서식 더 보기' })

describe('서식 줄 용량: 나중에 생긴 곁의 묶음도 다시 잰다', () => {
  it('도구줄에 묶음이 새로 생기면(검색이 펼쳐질 때) 그 폭만큼 줄어든 용량으로 다시 맞춘다 — 처음 한 번만 보지 않는다', async () => {
    const { container } = render(<div className="note-format-dock"><MemoFormatBar onCommand={vi.fn()} /></div>)
    // 곁에 아무것도 없을 때는 묶음이 모두 줄에 있다
    expect(moreButton()).toBeNull()
    const dock = container.querySelector<HTMLElement>('.note-format-dock')!
    const side = document.createElement('div')
    side.dataset.w = '420'
    await act(async () => { dock.append(side) })
    // 새 묶음은 관찰 대상이 되고, 줄은 모자란 자리를 「⋯」 로 접는다
    await waitFor(() => expect(moreButton()).not.toBeNull())
    expect(watched.has(side)).toBe(true)
    // 곁의 묶음이 사라지면 다시 모두 줄에 선다
    await act(async () => { side.remove() })
    await waitFor(() => expect(moreButton()).toBeNull())
  })

  it('크기 관찰자가 알려 오지 않아도 렌더마다 재지 않는다: 같은 값으로 다시 그려도 재는 일이 늘지 않는다', () => {
    const view = render(<div className="note-format-dock"><MemoFormatBar onCommand={vi.fn()} /></div>)
    const rect = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
    const before = rect.mock.calls.length
    view.rerender(<div className="note-format-dock"><MemoFormatBar onCommand={vi.fn()} /></div>)
    view.rerender(<div className="note-format-dock"><MemoFormatBar onCommand={vi.fn()} /></div>)
    // 부모가 다시 그려도(onCommand 만 새 함수) 서식 줄은 다시 재지 않는다
    expect(rect.mock.calls.length - before).toBeLessThan(5)
    expect(resizeCallbacks.length).toBeGreaterThan(0)
  })
})
