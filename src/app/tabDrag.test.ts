// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startTabDrag, type TabDragHost } from './tabDrag'
import type { Tab } from './tabs'

/**
 * 탭 끌기 컨트롤러의 DOM 쪽. jsdom 은 자리(getBoundingClientRect)·elementFromPoint 를 모르므로
 * 필요한 것만 흉내 낸다 — 어느 구역에 놓았을 때 어느 호출이 일어나는지를 못박는다.
 */

const tab: Tab = { id: 'a', title: 'A', kind: 'pdf' }

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

function fire(type: string, x: number, y: number): void {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, screenX: x, screenY: y, button: 0, bubbles: true }))
}

interface Fixture {
  readonly tabEl: HTMLElement
  readonly host: TabDragHost & { calls: string[] }
}

let rects = new Map<Element, DOMRect>()

function build(overrides: Partial<TabDragHost> = {}): Fixture {
  document.body.innerHTML = `
    <div class="topbar-panetab-zone" data-pane-id="left"><div class="pane-tabs-menu"><div class="pane-tabs-strip">
      <div class="pane-top-tab" data-tab-id="a"><button class="pane-top-tab-title">A</button></div>
    </div></div></div>
    <div class="topbar-panetab-zone" data-pane-id="right"><div class="pane-tabs-menu"><div class="pane-tabs-strip">
      <div class="pane-top-tab" data-tab-id="b"></div>
    </div></div></div>
    <div class="pane" data-test="left-pane"><div class="pane-focus-scope" data-pane-id="left"><div id="left-body"></div></div></div>
    <div class="pane" data-test="right-pane"><div class="pane-focus-scope" data-pane-id="right"><div id="right-body"></div></div></div>
  `
  const q = (selector: string) => document.querySelector<HTMLElement>(selector)!
  rects = new Map<Element, DOMRect>([
    [q('[data-tab-id="a"]'), box(10, 5, 100, 30)],
    [q('[data-tab-id="b"]'), box(210, 5, 100, 30)],
    [q('[data-test="left-pane"]'), box(0, 40, 200, 400)],
    [q('[data-test="right-pane"]'), box(200, 40, 200, 400)],
  ])
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rects.get(this) ?? box(0, 0, 0, 0)
  })
  document.elementFromPoint = (x: number, y: number) => {
    if (y < 40) return x < 200 ? q('.topbar-panetab-zone[data-pane-id="left"] .pane-tabs-strip') : q('.topbar-panetab-zone[data-pane-id="right"] .pane-tabs-strip')
    return x < 200 ? q('#left-body') : q('#right-body')
  }
  const calls: string[] = []
  const host: TabDragHost & { calls: string[] } = {
    tab,
    sourcePane: 'left',
    reorder: (id, to) => calls.push(`reorder:${id}:${to}`),
    moveAt: (id, pane, index) => calls.push(`move:${id}:${pane}:${index}`),
    dock: (id, pane, edge) => calls.push(`dock:${id}:${pane}:${edge}`),
    dockEdges: () => ['left', 'right', 'top', 'bottom'],
    tearOff: (id) => { calls.push(`tear:${id}`); return true },
    calls,
    ...overrides,
  }
  return { tabEl: q('[data-tab-id="a"]'), host }
}

beforeEach(() => {
  // 애니메이션 줄이기: 내려앉기가 바로 끝나 시험이 시간을 기다리지 않는다
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    Object.defineProperty(globalThis, 'CSS', { value: { escape: (value: string) => value }, configurable: true })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  document.body.className = ''
})

const start = (fixture: Fixture, x = 60, y = 20) => startTabDrag({ clientX: x, clientY: y, button: 0 }, fixture.tabEl, () => fixture.host)

describe('탭 끌기', () => {
  it('끌지 않고 뗐으면 아무 일도 없다', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 62, 21)
    fire('pointerup', 62, 21)
    expect(fixture.host.calls).toEqual([])
    expect(document.querySelector('.tab-drag-ghost')).toBeNull()
  })

  it('끄는 동안 들린 탭이 손을 따라오고, 원래 탭은 구멍이 된다', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 90, 60)
    const ghost = document.querySelector<HTMLElement>('.tab-drag-ghost')
    expect(ghost).not.toBeNull()
    expect(ghost!.getAttribute('aria-hidden')).toBe('true')
    expect(fixture.tabEl.dataset.dragging).toBeDefined()
    expect(document.body.classList.contains('pane-tab-dragging')).toBe(true)
    fire('pointerup', 90, 60)
  })

  it('다른 패널의 탭 줄에 놓으면 그 줄의 자리로 옮긴다', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', 230, 20) // 오른쪽 탭 줄, 탭 b(210–310)의 왼쪽 절반 → 앞
    fire('pointerup', 230, 20)
    expect(fixture.host.calls).toEqual(['move:a:right:0'])
    expect(document.querySelector('.tab-drag-ghost')).toBeNull()
    expect(document.body.classList.contains('pane-tab-dragging')).toBe(false)
  })

  it('다른 패널의 탭 줄 뒤쪽에 놓으면 맨 뒤', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', 360, 20)
    fire('pointerup', 360, 20)
    expect(fixture.host.calls).toEqual(['move:a:right:1'])
  })

  it('다른 패널 본문 가장자리에 놓으면 그쪽을 갈라 새 패널로', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', 390, 200) // 오른쪽 패널(200–400) 오른쪽 띠
    expect(document.querySelector('.tab-dock-preview-on')).not.toBeNull()
    fire('pointerup', 390, 200)
    expect(fixture.host.calls).toEqual(['dock:a:right:right'])
  })

  it('다른 패널 본문 한가운데는 그 패널로 옮기기(맨 뒤)', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', 300, 240)
    fire('pointerup', 300, 240)
    expect(fixture.host.calls).toEqual([`move:a:right:${Number.MAX_SAFE_INTEGER}`])
  })

  it('나눌 수 없는 가장자리는 가운데로 본다', () => {
    const fixture = build({ dockEdges: () => [] })
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', 390, 200)
    fire('pointerup', 390, 200)
    expect(fixture.host.calls).toEqual([`move:a:right:${Number.MAX_SAFE_INTEGER}`])
  })

  it('자기 패널 한가운데에 놓으면 아무 일도 없다', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', 100, 240)
    fire('pointerup', 100, 240)
    expect(fixture.host.calls).toEqual([])
    expect(fixture.tabEl.dataset.dragging).toBeUndefined()
  })

  it('Escape 는 취소: 아무것도 옮기지 않고 모두 치운다', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', 390, 200)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    fire('pointerup', 390, 200)
    expect(fixture.host.calls).toEqual([])
    expect(document.querySelector('.tab-drag-ghost')).toBeNull()
    expect(fixture.tabEl.dataset.dragging).toBeUndefined()
    expect(document.body.classList.contains('pane-tab-dragging')).toBe(false)
  })

  it('창 밖으로 충분히 나가면 떼어 낸다', async () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', -10, 100) // 여백(28px) 안쪽: 아직
    expect(fixture.host.calls).toEqual([])
    fire('pointermove', -60, 100)
    await Promise.resolve()
    expect(fixture.host.calls).toEqual(['tear:a'])
    expect(document.querySelector('.tab-drag-ghost')).toBeNull()
  })

  it('창 밖으로 나가도 떼어 낼 수 없는 탭(tearOff 없음)은 그냥 따라다닌다', () => {
    const fixture = build({ tearOff: undefined })
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', -200, 100)
    fire('pointerup', -200, 100)
    expect(fixture.host.calls).toEqual([])
  })

  it('창 전체를 끄는 탭(dragWindow)은 조금만 움직여도 바로 떼어 낸다', async () => {
    const fixture = build({ dragWindow: true })
    start(fixture)
    fire('pointermove', 80, 25)
    await Promise.resolve()
    expect(fixture.host.calls).toEqual(['tear:a'])
  })
})
