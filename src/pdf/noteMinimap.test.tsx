// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { NoteMinimap, readMinimapBlocks } from './NoteMinimap'
import {
  MINIMAP_MAX_SCALE,
  MINIMAP_MIN_BAR,
  MINIMAP_MIN_BOX,
  minimapBars,
  minimapScale,
  scrollTopForClick,
  scrollTopForDrag,
  viewportBox,
} from './noteMinimapGeometry'
import { readNoteMinimap, setNoteMinimap, toggleNoteMinimap } from './noteMinimapPref'

describe('미니맵 셈', () => {
  it('줄임 비율: 노트 전체가 띠 높이에 들어가고, 짧은 노트는 늘어나지 않는다', () => {
    expect(minimapScale(4000, 400)).toBeCloseTo(0.1)
    expect(minimapScale(500, 400)).toBe(MINIMAP_MAX_SCALE)
    expect(minimapScale(0, 400)).toBe(MINIMAP_MAX_SCALE)
  })

  it('블록 사각형 → 막대: 위치·높이가 비례하고 작은 블록도 최소 높이를 지킨다', () => {
    const bars = minimapBars([
      { key: 's', top: 0, height: 40, kind: 'section', dim: false },
      { key: 'm', top: 50, height: 200, kind: 'memo', color: 'green', dim: false },
      { key: 't', top: 260, height: 4, kind: 'text', dim: true },
    ], 0.1)
    expect(bars.map((bar) => bar.top)).toEqual([0, 5, 26])
    expect(bars[1]!.height).toBeCloseTo(19) // 20px - 틈 1px
    expect(bars[1]!.color).toBe('green')
    expect(bars[0]!.height).toBe(3)
    expect(bars[2]!.height).toBe(MINIMAP_MIN_BAR)
    expect(bars[2]!.dim).toBe(true)
  })

  it('뷰포트 상자: scrollTop·화면 높이에 비례하고 맨 끝에서는 띠 끝에 닿는다', () => {
    expect(viewportBox(0, 500, 2000, 0.2)).toEqual({ top: 0, height: 100 })
    expect(viewportBox(1500, 500, 2000, 0.2)).toEqual({ top: 300, height: 100 })
    expect(viewportBox(9999, 500, 2000, 0.2).top).toBe(300)
    expect(viewportBox(0, 20, 2000, 0.1).height).toBe(MINIMAP_MIN_BOX)
  })

  it('누르면 그 자리가 화면 가운데로, 끝에서는 범위 안으로 잘린다', () => {
    // 띠 y=100 → 노트 y=1000, 화면 500 높이의 가운데
    expect(scrollTopForClick(100, 0.1, 500, 4000)).toBe(750)
    expect(scrollTopForClick(0, 0.1, 500, 4000)).toBe(0)
    expect(scrollTopForClick(399, 0.1, 500, 4000)).toBe(3500)
  })

  it('끌기: 상자 위의 잡은 자리가 포인터를 따라간다', () => {
    // 상자 위에서 10px 아래를 잡고 포인터가 띠 y=60 → 상자 top 50 → scrollTop 500
    expect(scrollTopForDrag(60, 10, 0.1, 500, 4000)).toBe(500)
    expect(scrollTopForDrag(-30, 10, 0.1, 500, 4000)).toBe(0)
    expect(scrollTopForDrag(900, 10, 0.1, 500, 4000)).toBe(3500)
  })
})

describe('미니맵 켜기·끄기 기억', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())
  it('기본은 꺼짐, 켜면 기억하고 토글한다(앱 전체 하나)', () => {
    expect(readNoteMinimap()).toBe(false)
    expect(toggleNoteMinimap()).toBe(true)
    expect(window.localStorage.getItem('iwae:note-minimap:v1')).toBe('1')
    expect(readNoteMinimap()).toBe(true)
    setNoteMinimap(false)
    expect(readNoteMinimap()).toBe(false)
  })
  it('저장소가 막혀도 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => setNoteMinimap(true)).not.toThrow()
    expect(readNoteMinimap()).toBe(true)
  })
})

describe('NoteMinimap', () => {
  const metrics = { scrollHeight: 2000, clientHeight: 500, trackHeight: 400 }
  let scroller: HTMLElement

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    // jsdom 에는 레이아웃이 없다: 칸·띠 높이는 시험이 정한다
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => metrics.scrollHeight)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function height(this: HTMLElement) { return this.classList.contains('note-minimap') ? metrics.trackHeight : metrics.clientHeight })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function height(this: HTMLElement) { return Number(this.dataset.h ?? 0) })
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function top(this: HTMLElement) { return Number(this.dataset.t ?? 0) })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 100, top: 100, left: 0, right: 72, bottom: 500, width: 72, height: 400, toJSON: () => ({}) }) as DOMRect)
    scroller = document.createElement('div')
    scroller.innerHTML = [
      '<div data-note-block="s1" class="note-section" data-h="40" data-t="0"></div>',
      '<div data-note-block="m1" data-memo-id="h1" data-hl="green" data-h="200" data-t="50"></div>',
      '<div data-note-block="m2" data-memo-id="h2" data-hl="blue" class="pdf-memo-card-dim" data-h="300" data-t="260"></div>',
      '<div data-note-block="x" data-h="0" data-t="600"></div>',
    ].join('')
    document.body.append(scroller)
  })
  afterEach(() => {
    cleanup()
    scroller.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const mount = (query = '') => render(<NoteMinimap scrollerRef={{ current: scroller }} query={query} />)

  it('카드 DOM 에서 블록을 읽는다: 종류·색·흐림, 높이 0 인 것은 뺀다', () => {
    const blocks = readMinimapBlocks(scroller)
    expect(blocks.map((block) => [block.key, block.kind, block.color, block.dim, block.top, block.height])).toEqual([
      ['s1', 'section', undefined, false, 0, 40],
      ['m1', 'memo', 'green', false, 50, 200],
      ['m2', 'memo', 'blue', true, 260, 300],
    ])
  })

  it('블록마다 막대(소제목·메모 색)와 뷰포트 상자를 그린다', () => {
    const { container } = mount()
    const bars = container.querySelectorAll<HTMLElement>('.note-minimap-bar')
    expect(bars.length).toBe(3)
    expect(bars[0]!.dataset.kind).toBe('section')
    expect(bars[1]!.dataset.hl).toBe('green')
    expect(bars[1]!.querySelector('.note-minimap-dot')).not.toBeNull()
    // scale = 400/2000 = 0.2 → 메모 막대 top 10px
    expect(bars[1]!.style.top).toBe('10px')
    const box = container.querySelector<HTMLElement>('[data-minimap-box]')!
    expect(box.style.height).toBe('100px')
    expect(box.style.transform).toBe('translateY(0px)')
    scroller.scrollTop = 1000
    act(() => { scroller.dispatchEvent(new Event('scroll')) })
    expect(box.style.transform).toBe('translateY(200px)')
  })

  it('노트 검색 중이면 맞는 블록을 강조하고 안 맞는 블록은 흐리게 한다', () => {
    const { container } = mount('차단기')
    const bars = container.querySelectorAll<HTMLElement>('.note-minimap-bar')
    expect(bars[1]!.hasAttribute('data-hit')).toBe(true)
    expect(bars[2]!.hasAttribute('data-dim')).toBe(true)
    expect(bars[0]!.hasAttribute('data-hit')).toBe(false)
  })

  it('띠를 누르면 그 자리가 가운데로 스크롤한다(움직임 줄이기면 즉시)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { container } = mount()
    const track = container.querySelector<HTMLElement>('.note-minimap')!
    // 띠 top=100, 누른 y=300 → 띠 y=200 → 노트 y=1000 → scrollTop = 1000 - 250
    fireEvent.pointerDown(track, { clientY: 300, button: 0, pointerId: 1 })
    expect(scroller.scrollTop).toBe(750)
  })

  it('움직임 줄이기가 아니면 부드럽게 스크롤한다', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    scroller.scrollTo = vi.fn() as never
    const { container } = mount()
    fireEvent.pointerDown(container.querySelector('.note-minimap')!, { clientY: 300, button: 0, pointerId: 1 })
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 750, behavior: 'smooth' })
  })

  it('상자를 잡고 끌면 잡은 자리를 유지한 채 따라간다', () => {
    const { container } = mount()
    const track = container.querySelector<HTMLElement>('.note-minimap')!
    scroller.scrollTop = 500 // 상자 top = 100, 높이 100 (띠 좌표)
    // 상자 안쪽 y=130(= 클라이언트 230)을 잡는다 → grab 30
    fireEvent.pointerDown(track, { clientY: 230, button: 0, pointerId: 1 })
    expect(scroller.scrollTop).toBe(500)
    fireEvent.pointerMove(track, { clientY: 280, pointerId: 1 }) // 띠 y=180 → 상자 top 150 → scrollTop 750
    expect(scroller.scrollTop).toBe(750)
    fireEvent.pointerMove(track, { clientY: 9999, pointerId: 1 })
    expect(scroller.scrollTop).toBe(1500)
    fireEvent.pointerUp(track, { pointerId: 1 })
    fireEvent.pointerMove(track, { clientY: 150, pointerId: 1 })
    expect(scroller.scrollTop).toBe(1500)
  })

  it('띠 위의 휠은 노트를 스크롤한다', () => {
    const { container } = mount()
    fireEvent.wheel(container.querySelector('.note-minimap')!, { deltaY: 120 })
    expect(scroller.scrollTop).toBe(120)
  })
})
