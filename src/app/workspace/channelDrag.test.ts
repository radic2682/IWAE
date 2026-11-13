// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setChannelDragHost, startChannelDrag, type ChannelDragHost } from './channelDrag'

/** 색 점 끌기: 문턱 · 선과 점 · 놓을 칸 미리보기 · 놓기 · 취소 · 클릭 삼키기. 칸은 앱과 같은 모양이다(dockSession.test.ts 와 같은 틀) */

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

let rects = new Map<Element, DOMRect>()

function build(): void {
  document.body.innerHTML = `
    <div class="topbar" id="topbar"></div>
    <div class="panes panes-tree">
      <div class="pane pane-grid-cell" data-test="cell-a"><div class="pane-card" data-card-pane="a">
        <div class="pane-grid-tabs topbar-panetab-zone pane-head"><button class="pane-channel-dot" id="dot" data-channel="green"></button></div>
        <div class="pane-grid-body" id="body-a"></div>
      </div></div>
      <div class="pane pane-grid-cell" data-test="cell-b"><div class="pane-card" data-card-pane="b">
        <div class="pane-grid-tabs topbar-panetab-zone pane-head"></div>
        <div class="pane-grid-body" id="body-b"></div>
      </div></div>
    </div>
  `
  const q = (selector: string) => document.querySelector<HTMLElement>(selector)!
  rects = new Map<Element, DOMRect>([
    [q('[data-test="cell-a"]'), box(0, 40, 400, 400)],
    [q('[data-card-pane="a"]'), box(3, 43, 394, 394)],
    [q('[data-test="cell-b"]'), box(400, 40, 400, 400)],
    [q('[data-card-pane="b"]'), box(403, 43, 394, 394)],
    [q('#dot'), box(10, 50, 20, 20)],
  ])
  for (const head of Array.from(document.querySelectorAll('.pane-grid-tabs'))) {
    const card = head.closest('.pane-card')!
    rects.set(head, box(rects.get(card)!.left, rects.get(card)!.top, rects.get(card)!.width, 37))
  }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rects.get(this) ?? box(0, 0, 0, 0)
  })
  document.elementFromPoint = (x: number, y: number) => (y < 40 ? q('#topbar') : x < 400 ? q('#body-a') : q('#body-b'))
}

function move(x: number, y: number): void {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
}
function up(x: number, y: number): void {
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }))
}

let host: ChannelDragHost
let link: ReturnType<typeof vi.fn<(source: string, target: string) => void>>

beforeEach(() => {
  build()
  link = vi.fn<(source: string, target: string) => void>()
  host = {
    channelOf: (pane) => (pane === 'a' ? 'green' : null),
    previewChannel: (source, target) => (source === target ? null : 'green'),
    link,
  }
  setChannelDragHost(host)
})

afterEach(async () => {
  // 끝난 끌기가 클릭 삼킴을 푸는 한 틱을 기다린다(다음 시험으로 새지 않게)
  await new Promise((resolve) => setTimeout(resolve, 0))
  setChannelDragHost(null)
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  document.body.className = ''
})

const begin = () => startChannelDrag({ source: 'a', dot: document.querySelector<HTMLElement>('#dot')!, startX: 20, startY: 60 })

describe('색 점 끌기', () => {
  it('문턱(6px)을 넘기 전에는 끌기가 아니다: 표시 없음, 놓아도 아무 일 없다', () => {
    begin()
    move(24, 60)
    expect(document.querySelector('.channel-drag-ghost')).toBeNull()
    expect(document.body.classList.contains('dock-dragging')).toBe(false)
    up(24, 60)
    expect(link).not.toHaveBeenCalled()
  })

  it('문턱을 넘으면 끈 칸 색의 점과 선이 따라오고 칸 안 내용에 마우스가 걸리지 않는다', () => {
    begin()
    move(100, 100)
    const ghost = document.querySelector<HTMLElement>('.channel-drag-ghost')!
    expect(ghost.dataset.channel).toBe('green')
    expect(ghost.style.transform).toBe('translate3d(94px, 94px, 0)')
    const line = document.querySelector('.channel-drag-line line')!
    // 선은 점 단추의 가운데(20, 60)에서 포인터까지
    expect(line.getAttribute('x1')).toBe('20')
    expect(line.getAttribute('y1')).toBe('60')
    expect(line.getAttribute('x2')).toBe('100')
    expect(line.getAttribute('y2')).toBe('100')
    expect(document.querySelector('.channel-drag-line')!.getAttribute('data-channel')).toBe('green')
    expect(document.body.classList.contains('dock-dragging')).toBe(true)
    up(100, 100)
  })

  it('채널 없는 칸의 점은 「없음」 모양으로 뜬다', () => {
    host = { ...host, channelOf: () => null }
    setChannelDragHost(host)
    begin()
    move(100, 100)
    expect(document.querySelector<HTMLElement>('.channel-drag-ghost')!.dataset.channel).toBe('none')
    up(100, 100)
  })

  it('다른 칸 위에서는 그 카드가 놓으면 될 색을 미리 보인다(자기 자신 위에서는 아니다)', () => {
    begin()
    move(600, 200)
    expect(document.querySelector<HTMLElement>('[data-card-pane="b"]')!.dataset.linkPreview).toBe('green')
    move(200, 200)
    expect(document.querySelector<HTMLElement>('[data-card-pane="b"]')!.dataset.linkPreview).toBeUndefined()
    expect(document.querySelector<HTMLElement>('[data-card-pane="a"]')!.dataset.linkPreview).toBeUndefined()
    up(200, 200)
  })

  it('다른 칸에 놓으면 두 칸을 잇고 모든 표시를 치운다', () => {
    begin()
    move(600, 200)
    up(600, 200)
    expect(link).toHaveBeenCalledWith('a', 'b')
    expect(document.querySelector('.channel-drag-ghost')).toBeNull()
    expect(document.querySelector('.channel-drag-line')).toBeNull()
    expect(document.querySelector('[data-link-preview]')).toBeNull()
    expect(document.body.classList.contains('dock-dragging')).toBe(false)
  })

  it('자기 자신 · 상단바 · 빈 곳에 놓으면 취소다', () => {
    begin()
    move(200, 200)
    up(200, 200)
    begin()
    move(200, 20)
    up(200, 20)
    expect(link).not.toHaveBeenCalled()
  })

  it('Esc 는 끌기를 취소한다(놓아도 잇지 않는다)', () => {
    begin()
    move(600, 200)
    const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const stop = vi.spyOn(key, 'stopPropagation')
    window.dispatchEvent(key)
    expect(stop).toHaveBeenCalled()
    expect(document.querySelector('.channel-drag-ghost')).toBeNull()
    expect(document.querySelector('[data-link-preview]')).toBeNull()
    expect(document.body.classList.contains('dock-dragging')).toBe(false)
    up(600, 200)
    expect(link).not.toHaveBeenCalled()
  })

  it('끌기 뒤에 따라오는 클릭은 삼키고, 움직이지 않은 누름의 클릭은 그대로 지나간다', () => {
    const dot = document.querySelector<HTMLElement>('#dot')!
    const clicked = vi.fn()
    dot.addEventListener('click', clicked)
    // 움직이지 않은 누름: 클릭이 지나간다
    begin()
    up(20, 60)
    dot.click()
    expect(clicked).toHaveBeenCalledTimes(1)
    // 끌었다 놓은 뒤: 한 번 삼킨다
    begin()
    move(600, 200)
    up(600, 200)
    dot.click()
    expect(clicked).toHaveBeenCalledTimes(1)
  })
})
