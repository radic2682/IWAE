// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildGhostShell, createDockVisuals, paintDockTarget, paneHitAt, resolveDockTarget, setDockDragging, setDockDropOk, startTabDrag, stripGapPx, type TabDragHost } from './tabDrag'
import type { Tab } from './tabs'

/**
 * 탭 끌기 컨트롤러의 DOM 쪽. jsdom 은 자리(getBoundingClientRect)·elementFromPoint 를 모르므로
 * 필요한 것만 흉내 낸다 — 어느 구역에 놓았을 때 어느 호출이 일어나는지를 못박는다.
 * 칸은 앱과 같은 모양이다: .pane-grid-cell(칸 사이 틈까지 든다) 안에 .pane-card(머리 + 본문).
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
    <div class="panes panes-tree">
      <div class="pane pane-grid-cell" data-test="left-cell"><div class="pane-card" data-card-pane="left">
        <div class="pane-grid-tabs topbar-panetab-zone pane-head" data-pane-head="left"><div class="pane-tabs-menu"><div class="pane-tabs-strip">
          <div class="pane-top-tab" data-tab-id="a"><button class="pane-top-tab-title">A</button></div>
        </div></div></div>
        <div class="pane-grid-body" id="left-body"></div>
      </div></div>
      <div class="pane pane-grid-cell" data-test="right-cell"><div class="pane-card" data-card-pane="right">
        <div class="pane-grid-tabs topbar-panetab-zone pane-head" data-pane-head="right"><div class="pane-tabs-menu"><div class="pane-tabs-strip">
          <div class="pane-top-tab" data-tab-id="b"></div>
        </div></div></div>
        <div class="pane-grid-body" id="right-body"></div>
      </div></div>
    </div>
    <div class="sidebar" id="sidebar"></div>
  `
  const q = (selector: string) => document.querySelector<HTMLElement>(selector)!
  rects = new Map<Element, DOMRect>([
    [q('[data-tab-id="a"]'), box(10, 5, 100, 30)],
    [q('[data-tab-id="b"]'), box(210, 5, 100, 30)],
    // 칸 상자는 틈까지 든다(3px). 카드는 그 안쪽, 머리는 카드 위 38px
    [q('[data-test="left-cell"]'), box(0, 0, 200, 440)],
    [q('[data-test="right-cell"]'), box(200, 0, 200, 440)],
    [q('[data-card-pane="left"]'), box(3, 3, 194, 434)],
    [q('[data-card-pane="right"]'), box(203, 3, 194, 434)],
    [q('[data-pane-head="left"]'), box(3, 3, 194, 37)],
    [q('[data-pane-head="right"]'), box(203, 3, 194, 37)],
  ])
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return rects.get(this) ?? box(0, 0, 0, 0)
  })
  // 칸 영역 밖(왼쪽 바 자리 x < 0)은 칸이 아니다. 안쪽 어디든 앱 안의 한 요소를 돌려주면 된다(자리는 칸 상자로 정한다)
  document.elementFromPoint = (x: number) => (x < 0 ? q('#sidebar') : q('#left-body'))
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

  it('왼쪽 바가 보일 때 창 왼쪽 가장자리에 머무는 것으로는 떼어 내지 않는다(왼쪽 바 위에 놓으려는 것이다)', () => {
    vi.useFakeTimers()
    try {
      const fixture = build()
      start(fixture)
      fire('pointermove', 100, 100)
      fire('pointermove', 0, 100)
      vi.advanceTimersByTime(1000)
      expect(fixture.host.calls).toEqual([])
      // 왼쪽 바가 접혀 있으면(inert) 가장자리 머무름은 예전처럼 떼어 낸다
      document.querySelector('.sidebar')!.setAttribute('inert', '')
      fire('pointermove', 5, 100)
      fire('pointermove', 0, 100)
      vi.advanceTimersByTime(1000)
      expect(fixture.host.calls).toEqual(['tear:a'])
    } finally {
      vi.useRealTimers()
    }
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

describe('탭 끌기: 자리 판정 · 표시', () => {
  it('들린 탭 껍질은 머리 바탕(pane-grid-tabs)을 달지 않는다: 탭 하나만 들린다', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 100, 100)
    const ghost = document.querySelector('.tab-drag-ghost')!
    expect(ghost.classList.contains('pane-grid-tabs')).toBe(false)
    expect(ghost.classList.contains('topbar-panetab-zone')).toBe(true)
    fire('pointerup', 100, 240)
  })

  it('칸 사이 틈과 경계선 위에서도 가장 가까운 칸이다(미리보기가 깜빡이지 않는다)', () => {
    build()
    // 왼쪽 카드 바깥(칸 상자 안 틈)
    expect(paneHitAt(1, 100)).toMatchObject({ kind: 'body', pane: 'left' })
    // 두 칸 경계 양쪽
    expect(paneHitAt(199.5, 100)).toMatchObject({ kind: 'body', pane: 'left' })
    expect(paneHitAt(200.5, 100)).toMatchObject({ kind: 'body', pane: 'right' })
    // 머리 위 틈도 탭 줄이다
    expect(paneHitAt(250, 1)).toMatchObject({ kind: 'strip', pane: 'right' })
  })

  it('칸 영역 밖(왼쪽 바 · 상단바)은 아무 칸도 아니다: 미리보기도 놓을 자리도 없다', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', -10, 100)
    expect(paneHitAt(-10, 100)).toEqual({ kind: 'none' })
    expect(document.querySelector('.tab-dock-preview-on')).toBeNull()
    fire('pointerup', -10, 100)
    expect(fixture.host.calls).toEqual([])
    expect(fixture.tabEl.dataset.dragging).toBeUndefined()
    expect(document.body.classList.contains('pane-tab-dragging')).toBe(false)
  })

  it('떠 있는 칸은 칸들 위에 있어 먼저 잡힌다', () => {
    build()
    const float = document.createElement('div')
    float.className = 'pane pane-grid-cell pane-float'
    float.innerHTML = '<div class="pane-card" data-card-pane="float"><div class="pane-grid-tabs" data-pane-head="float"></div><div class="pane-grid-body"></div></div>'
    document.querySelector('.panes')!.append(float)
    rects.set(float, box(150, 100, 100, 100))
    rects.set(float.querySelector('.pane-card')!, box(150, 100, 100, 100))
    rects.set(float.querySelector('.pane-grid-tabs')!, box(150, 100, 100, 30))
    expect(paneHitAt(180, 150)).toMatchObject({ kind: 'body', pane: 'float' })
    expect(paneHitAt(180, 110)).toMatchObject({ kind: 'strip', pane: 'float' })
    expect(paneHitAt(140, 150)).toMatchObject({ kind: 'body', pane: 'left' })
  })

  it('미리보기는 머리까지 든 카드 전체를 기준으로 한다(진짜 나뉘는 모양과 같다)', () => {
    const fixture = build()
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', 390, 200)
    const preview = document.querySelector<HTMLElement>('.tab-dock-preview-on')!
    // 오른쪽 카드(203, 3, 194, 434)의 오른쪽 절반(300, 3, 97)을 1px 안쪽으로
    expect(preview.style.top).toBe('4px')
    expect(preview.style.height).toBe('432px')
    expect(preview.style.left).toBe('301px')
    fire('pointerup', 390, 200)
  })

  it('나눌 수 없는 가장자리(허락 목록에 없는 쪽)는 미리보기 없이 가운데로 본다', () => {
    const fixture = build({ dockEdges: () => ['top', 'bottom'] })
    start(fixture)
    fire('pointermove', 100, 100)
    fire('pointermove', 390, 200) // 오른쪽 띠 — 오른쪽은 못 나눈다
    const preview = document.querySelector<HTMLElement>('.tab-dock-preview-on')!
    expect(preview.style.left).toBe('204px') // 카드 전체(가운데 구역)
    fire('pointerup', 390, 200)
    expect(fixture.host.calls).toEqual([`move:a:right:${Number.MAX_SAFE_INTEGER}`])
  })
})

describe('공용 놓을 자리 판정 · 표시 (탭 끌기와 왼쪽 바 끌기가 같이 쓴다)', () => {
  it('resolveDockTarget: 머리 위는 strip, 본문은 구역 · 기준 상자(칸 카드 전체), 칸 밖은 none. 가장자리 목록은 함수로도 준다', () => {
    build()
    const edgesAsked: string[] = []
    const edges = (pane: string) => { edgesAsked.push(pane); return ['left', 'right'] as const }
    expect(resolveDockTarget(paneHitAt(50, 10), 50, 10, edges)).toMatchObject({ kind: 'strip', pane: 'left' })
    const body = resolveDockTarget(paneHitAt(300, 200), 300, 200, edges)
    expect(body).toMatchObject({ kind: 'body', pane: 'right', zone: 'center' })
    expect(body.kind === 'body' ? body.box : null).toMatchObject({ left: 203, top: 3, width: 194, height: 434 })
    // 허락된 가장자리(left)에서는 나눔 구역, 허락 안 된 가장자리(top)는 가운데로 본다
    expect(resolveDockTarget(paneHitAt(210, 200), 210, 200, edges)).toMatchObject({ kind: 'body', pane: 'right', zone: 'left' })
    expect(resolveDockTarget(paneHitAt(300, 45), 300, 45, edges)).toMatchObject({ kind: 'body', zone: 'center' })
    expect(edgesAsked).toEqual(['right', 'right', 'right'])
    expect(resolveDockTarget(paneHitAt(-5, 200), -5, 200, ['left'])).toEqual({ kind: 'none' })
  })

  it('paintDockTarget: 본문은 구역 미리보기와 머리 표시 해제, 탭 줄은 구역 표시 + 틈(gap 이 있을 때만), 없음은 모두 치운다', () => {
    build()
    const visuals = createDockVisuals()
    paintDockTarget(visuals, resolveDockTarget(paneHitAt(300, 200), 300, 200, []), null)
    const preview = document.querySelector<HTMLElement>('.tab-dock-preview')!
    expect(preview.classList.contains('tab-dock-preview-on')).toBe(true)
    paintDockTarget(visuals, resolveDockTarget(paneHitAt(50, 10), 50, 10, []), { index: 1, tabWidth: 100 })
    expect(preview.classList.contains('tab-dock-preview-on')).toBe(false)
    expect(document.querySelector('[data-pane-head="left"]')!.classList.contains('pane-drop-target')).toBe(true)
    expect(document.querySelector<HTMLElement>('.pane-tabs-strip')!.style.paddingRight).not.toBe('')
    // gap 이 없으면 틈을 열지 않고 열려 있던 것도 닫는다(같은 줄 순서 바꾸기)
    paintDockTarget(visuals, resolveDockTarget(paneHitAt(50, 10), 50, 10, []), null)
    expect(document.querySelector('[data-pane-head="left"]')!.classList.contains('pane-drop-target')).toBe(true)
    paintDockTarget(visuals, { kind: 'none' }, null)
    expect(document.querySelector('.pane-drop-target')).toBeNull()
    visuals.clear(true)
  })

  it('stripGapPx: CSS column-gap 을 재고, 못 재면 디자인 값 4px 를 쓴다(예전 3px 상수가 아니다)', () => {
    build()
    const strip = document.querySelector<HTMLElement>('.pane-tabs-strip')!
    expect(stripGapPx(strip)).toBe(4)
    strip.style.columnGap = '6px'
    expect(stripGapPx(strip)).toBe(6)
  })

  it('buildGhostShell: 탭 둘레에 좌우 20 · 위아래 4 여백을 두른 껍질이고, 머리 바탕 class 는 뺀다', () => {
    const tab = document.createElement('div')
    const shell = buildGhostShell('topbar-panetab-zone pane-head pane-grid-tabs pane-drop-target', tab, 120, 28)
    expect(shell.className).toBe('tab-drag-ghost topbar-panetab-zone pane-head')
    expect(shell.style.width).toBe('160px')
    expect(shell.style.height).toBe('36px')
    expect(tab.style.width).toBe('120px')
    expect(shell.querySelector('.pane-tabs-menu > .pane-tabs-strip > div')).toBe(tab)
  })

  it('setDockDragging / setDockDropOk: 끄는 동안 body 표시를 켜고, 끄면 복사 커서 표시도 같이 거둔다', () => {
    setDockDragging(true)
    setDockDropOk(true)
    expect(document.body.classList.contains('dock-dragging')).toBe(true)
    expect(document.body.classList.contains('dock-drop-ok')).toBe(true)
    setDockDropOk(false)
    expect(document.body.classList.contains('dock-drop-ok')).toBe(false)
    setDockDropOk(true)
    setDockDragging(false)
    expect(document.body.className).toBe('')
  })
})
