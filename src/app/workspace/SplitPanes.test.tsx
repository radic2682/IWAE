// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { SplitPanes, type FocusedPane } from './SplitPanes'
import { SIDEBAR_DEFAULT } from './splitLayout'
import { layoutForLegacyId, paneNode, type LayoutNode } from '../../core/layoutTree'

/**
 * 드래그 수명주기 회귀. f885b7f 가 고친 리스너 크로스토크와, 그 뒤에
 * 더한 pointercancel/lostpointercapture 종료를 못박는다.
 *
 * 증상이 전부 "버튼을 안 눌렀는데 폭이 바뀐다"로 나타나므로 단언도
 * 전부 사이드바의 인라인 width 하나로 한다 — 내부 상태나 리스너 개수를
 * 들여다보면 구현을 바꿀 때마다 테스트가 같이 깨지고, 정작 사용자가
 * 보는 증상은 못 잡는다.
 */
const cols2 = (ratio = 0.5): LayoutNode => {
  const tree = layoutForLegacyId('cols2', ['L', 'R'])
  return tree.kind === 'split' ? { ...tree, ratio } : tree
}

const body = (pane: string) => <div data-testid={`body-${pane}`}>{pane === 'L' ? '왼쪽' : pane === 'R' ? '오른쪽' : pane}</div>

function renderPanes(
  sidebarCollapsed = false,
  layout?: { sidebarPx: number; leftFrac: number },
  focusedPane: FocusedPane = 'split',
  libraryExpanded = false,
  root: LayoutNode = cols2(),
  zoomedPane: string | null = null,
) {
  const view = render(
    <SplitPanes
      sidebar={<div>사이드바</div>}
      topBar={() => <div>상단바</div>}
      sidebarCollapsed={sidebarCollapsed}
      layout={layout}
      focusedPane={focusedPane}
      zoomedPane={zoomedPane}
      libraryExpanded={libraryExpanded}
      root={root}
      renderPane={body}
    />,
  )
  return view
}

function sidebarWidth(container: HTMLElement): string {
  const shell = container.querySelector('.shell')
  if (!(shell instanceof HTMLElement)) throw new Error('셸을 찾지 못했다')
  return shell.style.getPropertyValue('--sidebar-width')
}

const sidebarDivider = () => screen.getByRole('separator', { name: '사이드바 너비 조절' })
const paneDivider = () => screen.getByRole('separator', { name: '패널 너비 조절' })
const cell = (container: HTMLElement, index: number) => {
  const found = container.querySelector(`.pane-grid-cell[data-pane-index="${index}"]`)
  if (!(found instanceof HTMLElement)) throw new Error(`${index}번 칸을 찾지 못했다`)
  return found
}

describe('SplitPanes — 드래그 수명주기', () => {
  it('사이드바 구분선을 끌면 폭이 따라온다', () => {
    // 아래 테스트들이 "폭이 안 바뀐다"를 단언하므로, 원래는 바뀐다는
    // 것을 여기서 먼저 확인한다. 이게 없으면 드래그가 통째로 망가져도
    // 나머지가 전부 통과한다.
    const { container } = renderPanes()
    expect(sidebarWidth(container)).toBe(`${SIDEBAR_DEFAULT}px`)

    fireEvent.pointerDown(sidebarDivider(), { pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 320 })
    expect(sidebarWidth(container)).toBe('320px')
  })

  it('다른 구분선을 누르면 앞의 드래그가 끊긴다 — 커서 하나가 둘을 움직이지 않는다', () => {
    const { container } = renderPanes()
    fireEvent.pointerDown(sidebarDivider(), { pointerId: 1 })
    // pointerup 없이 곧바로 두 번째 구분선을 잡는 경우(캡처가 깨졌는데
    // 합성 pointerup 이 안 오는 상황)가 f885b7f 가 고친 그 사고다.
    fireEvent.pointerDown(paneDivider(), { pointerId: 2 })
    fireEvent.pointerMove(window, { clientX: 320 })

    expect(sidebarWidth(container)).toBe(`${SIDEBAR_DEFAULT}px`)
  })

  it('pointerup 뒤의 움직임은 폭을 바꾸지 않는다', () => {
    const { container } = renderPanes()
    fireEvent.pointerDown(sidebarDivider(), { pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 400 })

    expect(sidebarWidth(container)).toBe(`${SIDEBAR_DEFAULT}px`)
  })

  it('pointercancel 뒤의 움직임은 폭을 바꾸지 않는다', () => {
    // 터치가 스크롤로 승격되거나 펜이 화면을 떠나면 pointerup 대신
    // 이것이 온다. 놓치면 손을 뗀 뒤에도 구분선이 따라다닌다.
    const { container } = renderPanes()
    fireEvent.pointerDown(sidebarDivider(), { pointerId: 1 })
    fireEvent.pointerCancel(window, { pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 400 })

    expect(sidebarWidth(container)).toBe(`${SIDEBAR_DEFAULT}px`)
  })

  it('lostpointercapture 뒤의 움직임은 폭을 바꾸지 않는다', () => {
    // 캡처가 풀린 순간 이후의 pointermove 는 우리 드래그가 아니다.
    // 구분선에서 쏘아 window 까지 올라가는 경로까지 함께 확인한다.
    const { container } = renderPanes()
    fireEvent.pointerDown(sidebarDivider(), { pointerId: 1 })
    fireEvent.lostPointerCapture(sidebarDivider(), { pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 400 })

    expect(sidebarWidth(container)).toBe(`${SIDEBAR_DEFAULT}px`)
  })

  it('끝난 드래그 뒤에도 새 드래그는 정상으로 시작된다', () => {
    // 종료 처리가 리스너를 너무 많이 걷어내서 다음 드래그가 죽는
    // 반대쪽 실패도 막는다.
    const { container } = renderPanes()
    fireEvent.pointerDown(sidebarDivider(), { pointerId: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    fireEvent.pointerDown(sidebarDivider(), { pointerId: 2 })
    fireEvent.pointerMove(window, { clientX: 300 })
    expect(sidebarWidth(container)).toBe('300px')
  })

  it('끌기가 끝나면 body 의 pane-resizing 표시와 iwae:pane-resize-end 가 정리된다', () => {
    const ended = vi.fn()
    window.addEventListener('iwae:pane-resize-end', ended)
    renderPanes()
    fireEvent.pointerDown(paneDivider(), { pointerId: 1 })
    expect(document.body.classList.contains('pane-resizing')).toBe(true)
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(document.body.classList.contains('pane-resizing')).toBe(false)
    expect(ended).toHaveBeenCalled()
    window.removeEventListener('iwae:pane-resize-end', ended)
  })
})

describe('SplitPanes — 사이드바 접기', () => {
  it('접으면 사이드바와 구분선의 폭이 0이 되고 조작할 수 없다', () => {
    const { container } = renderPanes(true)
    expect(sidebarWidth(container)).toBe('0px')
    expect((container.querySelector('.shell') as HTMLElement).style.getPropertyValue('--sidebar-divider-width')).toBe('0px')
    expect(container.querySelector('.sidebar')?.hasAttribute('inert')).toBe(true)
    expect(screen.queryByRole('separator', { name: '사이드바 너비 조절' })).toBeNull()
    expect(container.querySelector('.shell')?.classList.contains('shell-sidebar-collapsed')).toBe(true)
  })

  it('접혀도 패널 구분선은 그대로 동작한다', () => {
    renderPanes(true)
    expect(screen.getByRole('separator', { name: '패널 너비 조절' })).toBeDefined()
  })
})

describe('SplitPanes — 세션 레이아웃', () => {
  it('복원한 사이드바 폭과 칸 비율(트리)로 시작한다', () => {
    const { container } = renderPanes(false, { sidebarPx: 310, leftFrac: 0.5 }, 'split', false, cols2(0.4))
    expect(sidebarWidth(container)).toBe('310px')
    expect(cell(container, 0).style.width).toBe('40%')
    expect(cell(container, 0).style.left).toBe('0%')
    expect(cell(container, 1).style.width).toBe('60%')
    expect(cell(container, 1).style.left).toBe('40%')
    expect(cell(container, 0).style.height).toBe('100%')
  })

  it('칸 본문은 칸 번호 차례(왼쪽 위부터)로 그려지고 칸마다 번호가 붙는다', () => {
    const { container } = renderPanes()
    expect(container.querySelectorAll('.pane-grid-cell')).toHaveLength(2)
    expect(cell(container, 0).textContent).toContain('왼쪽')
    expect(cell(container, 1).textContent).toContain('오른쪽')
  })

  it('칸이 하나여도 칸 머리가 칸 맨 위에 있고, 경계선은 없다', () => {
    const renderHead = vi.fn((pane: string) => <span>머리-{pane}</span>)
    const { container } = render(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={paneNode('L')} renderPane={body} renderHead={renderHead} />,
    )
    const heads = container.querySelectorAll('.pane-head')
    expect(heads).toHaveLength(1)
    expect(heads.item(0).textContent).toBe('머리-L')
    expect(renderHead).toHaveBeenCalledWith('L', 0)
    expect(cell(container, 0).querySelector('.pane-card')?.firstElementChild).toBe(heads.item(0))
    expect(screen.queryByRole('separator', { name: '패널 너비 조절' })).toBeNull()
    expect(container.querySelector('.app')?.classList.contains('app-single-pane')).toBe(true)
  })

  it('칸이 둘 이상이면 칸마다 자기 머리가 칸 맨 위에 있다', () => {
    const { container } = render(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={cols2()} renderPane={body} renderHead={(pane, index) => <span>머리-{pane}-{index}</span>} />,
    )
    const heads = container.querySelectorAll('.pane-head')
    expect(heads).toHaveLength(2)
    expect(heads.item(0).textContent).toBe('머리-L-0')
    expect(heads.item(1).textContent).toBe('머리-R-1')
    // 머리가 본문보다 앞에 있다
    expect(cell(container, 1).querySelector('.pane-card')?.firstElementChild).toBe(heads.item(1))
  })

  it('칸 하나마다 카드 하나(머리 + 본문)를 두고, 크게 보는 칸도 같은 카드다', () => {
    const { container } = render(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={cols2()} renderPane={body} renderHead={(pane) => <span>머리-{pane}</span>} focusedPane="zoom" zoomedPane="R" />,
    )
    const cards = container.querySelectorAll('.pane-grid-cell > .pane-card')
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card.children).toHaveLength(2)
      expect(card.children[0]!.classList.contains('pane-head')).toBe(true)
      expect(card.children[1]!.classList.contains('pane-grid-body')).toBe(true)
    }
    expect(cell(container, 1).style.width).toBe('100%')
  })

  it('아래 상태 줄은 없다: 앱 틀의 맨 아래는 칸 영역(.app)이다', () => {
    const { container } = render(<SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={cols2()} renderPane={body} />)
    const shell = container.querySelector('.shell') as HTMLElement
    expect(shell.lastElementChild).toBe(shell.querySelector('.app'))
    expect(container.querySelector('.status-bar')).toBeNull()
  })

  it('상단바에는 사이드바 폭과 보이는 여부만 건넨다(칸이 하나일 때 탭 줄이 쓰는 몫은 1)', () => {
    const topBar = vi.fn(() => null)
    render(<SplitPanes sidebar={null} topBar={topBar} sidebarCollapsed={false} root={cols2()} renderPane={body} />)
    expect(topBar).toHaveBeenLastCalledWith({ sidebarPx: expect.any(Number), leftFrac: 1, sidebarVisible: true })
  })
})

describe('SplitPanes — 중첩된 트리', () => {
  /** h(L, v(R, B)) — 왼쪽 하나 · 오른쪽 위아래 둘 */
  const nested = (): LayoutNode => layoutForLegacyId('left1-right2', ['L', 'R', 'B'])

  it('중첩된 나누기도 칸 사각형이 퍼센트로 그려진다', () => {
    const { container } = renderPanes(false, undefined, 'split', false, nested())
    expect(container.querySelectorAll('.pane-grid-cell')).toHaveLength(3)
    expect(cell(container, 0).style).toMatchObject({ left: '0%', top: '0%', width: '50%', height: '100%' })
    expect(cell(container, 1).style).toMatchObject({ left: '50%', top: '0%', width: '50%', height: '50%' })
    expect(cell(container, 2).style).toMatchObject({ left: '50%', top: '50%', width: '50%', height: '50%' })
  })

  it('나누기마다 경계선이 하나: 세로선(좌우 나누기)·가로선(위아래 나누기), 위치가 비율을 따른다', () => {
    const { container } = renderPanes(false, undefined, 'split', false, nested())
    const dividers = container.querySelectorAll('.pane-tree-divider')
    expect(dividers).toHaveLength(2)
    const vertical = container.querySelector('.pane-grid-divider-col') as HTMLElement
    const horizontal = container.querySelector('.pane-grid-divider-row') as HTMLElement
    expect(vertical.getAttribute('aria-orientation')).toBe('vertical')
    expect(vertical.style.left).toBe('50%')
    expect(horizontal.getAttribute('aria-orientation')).toBe('horizontal')
    expect(horizontal.style).toMatchObject({ top: '50%', left: '50%', width: '50%' })
  })

  it('트리 모양이 바뀌어도 남은 칸의 DOM 은 그대로다(PDF 보기가 다시 만들어지지 않는다)', () => {
    const { container, rerender } = render(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={paneNode('L')} renderPane={body} />,
    )
    const before = container.querySelector('[data-testid="body-L"]')
    rerender(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={cols2()} renderPane={body} />,
    )
    expect(container.querySelector('[data-testid="body-L"]')).toBe(before)
    expect(container.querySelectorAll('.pane-grid-cell')).toHaveLength(2)
    rerender(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={nested()} renderPane={body} />,
    )
    expect(container.querySelector('[data-testid="body-L"]')).toBe(before)
  })
})

describe('SplitPanes — 경계선을 끌어 비율 바꾸기', () => {
  afterEach(() => vi.restoreAllMocks())

  /** 작업 영역을 1000×800 으로 보이게 한다(jsdom 은 늘 0) */
  const measure = () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const panes = this.classList.contains('panes')
      return panes ? ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect) : ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    })
  }

  it('끄는 동안은 안에서만 다시 그리고, 놓을 때 한 번 바깥에 새 트리(바뀐 비율)를 알린다', () => {
    measure()
    const onRootChange = vi.fn()
    const { container } = render(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={cols2()} renderPane={body} onRootChange={onRootChange} />,
    )
    fireEvent.pointerDown(paneDivider(), { pointerId: 1, clientX: 500, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 100 })
    expect(cell(container, 0).style.width).toBe('30%')
    expect(cell(container, 1).style.width).toBe('70%')
    expect(onRootChange).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 100 })
    expect(onRootChange).toHaveBeenCalledTimes(1)
    const next = onRootChange.mock.calls[0]![0] as LayoutNode
    expect(next).toMatchObject({ kind: 'split', dir: 'h', ratio: 0.3 })
  })

  it('위아래 나누기는 세로 좌표로 비율을 정한다', () => {
    measure()
    const onRootChange = vi.fn()
    render(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={layoutForLegacyId('rows2', ['L', 'R'])} renderPane={body} onRootChange={onRootChange} />,
    )
    fireEvent.pointerDown(paneDivider(), { pointerId: 1, clientX: 100, clientY: 400 })
    expect(document.body.classList.contains('pane-resizing-row')).toBe(true)
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 600 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(onRootChange.mock.calls[0]![0]).toMatchObject({ dir: 'v', ratio: 0.75 })
    expect(document.body.classList.contains('pane-resizing-row')).toBe(false)
  })

  it('중첩된 나누기는 그 나누기가 차지한 사각형 안에서 비율을 잰다', () => {
    measure()
    const onRootChange = vi.fn()
    // 오른쪽 절반(x 500–1000)을 위아래로 나눈 안쪽 나누기: 세로 좌표 300 → 800 중 37.5%. 바깥 나누기(0.5)는 그대로
    const { container } = render(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={layoutForLegacyId('left1-right2', ['L', 'R', 'B'])} renderPane={body} onRootChange={onRootChange} />,
    )
    const horizontal = container.querySelector('.pane-grid-divider-row') as HTMLElement
    fireEvent.pointerDown(horizontal, { pointerId: 1, clientX: 700, clientY: 400 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 700, clientY: 300 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    const next = onRootChange.mock.calls[0]![0] as Extract<LayoutNode, { kind: 'split' }>
    expect(next.ratio).toBe(0.5)
    expect(next.b).toMatchObject({ kind: 'split', dir: 'v', ratio: 0.375 })
  })

  it('두 칸이 각각 최소 폭(240px)을 지키게 비율을 가둔다', () => {
    measure()
    const onRootChange = vi.fn()
    render(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={cols2()} renderPane={body} onRootChange={onRootChange} />,
    )
    fireEvent.pointerDown(paneDivider(), { pointerId: 1, clientX: 500, clientY: 0 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 0 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect((onRootChange.mock.calls[0]![0] as { ratio: number }).ratio).toBeCloseTo(0.24)
  })

  it('움직이지 않고 떼면(비율이 안 바뀜) 알리지 않는다', () => {
    measure()
    const onRootChange = vi.fn()
    render(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={cols2()} renderPane={body} onRootChange={onRootChange} />,
    )
    fireEvent.pointerDown(paneDivider(), { pointerId: 1, clientX: 500, clientY: 0 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(onRootChange).not.toHaveBeenCalled()
  })
})

describe('SplitPanes — 한 칸 크게(zoom)와 라이브러리', () => {
  it('zoom 이면 사이드바와 다른 칸을 숨기고 그 칸을 꽉 채운다(다른 칸은 마운트된 채 inert)', () => {
    const { container } = renderPanes(false, undefined, 'zoom', false, cols2(), 'R')
    const shell = container.querySelector('.shell') as HTMLElement
    expect(shell.classList.contains('shell-reader-focused')).toBe(true)
    expect(shell.style.getPropertyValue('--sidebar-width')).toBe('0px')
    const hidden = cell(container, 0)
    const shown = cell(container, 1)
    expect(hidden.getAttribute('aria-hidden')).toBe('true')
    expect(hidden.hasAttribute('inert')).toBe(true)
    expect(hidden.textContent).toContain('왼쪽')
    expect(shown.hasAttribute('aria-hidden')).toBe(false)
    expect(shown.style).toMatchObject({ left: '0%', top: '0%', width: '100%', height: '100%' })
    expect(container.querySelector('.sidebar')?.getAttribute('aria-hidden')).toBe('true')
    // 경계선은 숨는다
    expect(screen.queryByRole('separator', { name: '패널 너비 조절' })).toBeNull()
  })

  it('라이브러리를 펼쳐도 왼쪽 바는 그대로이고, 패널은 inert 가 되며 그 자리에 라이브러리 틀이 생긴다', () => {
    const { container } = renderPanes(false, undefined, 'split', true)
    const shell = container.querySelector('.shell') as HTMLElement
    expect(shell.classList.contains('shell-library-expanded')).toBe(true)
    // 왼쪽 바 폭·구분선은 펼치기 전과 같다(전체 폭이 되지 않는다)
    expect(shell.style.getPropertyValue('--sidebar-width')).not.toBe('100%')
    const panes = container.querySelector('.panes') as HTMLElement
    expect(panes.hasAttribute('inert')).toBe(true)
    expect(panes.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('separator', { name: '사이드바 너비 조절' })).not.toBeNull()
    expect(container.querySelector('.library-host')).not.toBeNull()
  })

  it('라이브러리를 펼쳐도 왼쪽 바는 눌린다(inert·접힘 표시가 붙지 않는다)', () => {
    const { container } = renderPanes(false, undefined, 'split', true)
    const shell = container.querySelector('.shell') as HTMLElement
    expect(shell.classList.contains('shell-sidebar-collapsed')).toBe(false)
    const sidebar = container.querySelector('.sidebar') as HTMLElement
    expect(sidebar.hasAttribute('inert')).toBe(false)
  })

  it('모드가 바뀌는 동안 shell-transitioning 을 붙였다가 뗀다', () => {
    vi.useFakeTimers()
    const { container, rerender } = renderPanes()
    rerender(
      <SplitPanes sidebar={<div>사이드바</div>} topBar={() => <div>상단바</div>} sidebarCollapsed={false}
        focusedPane="zoom" zoomedPane="L" root={cols2()} renderPane={body} />,
    )
    const shell = container.querySelector('.shell') as HTMLElement
    expect(shell.classList.contains('shell-transitioning')).toBe(true)
    act(() => { vi.advanceTimersByTime(400) })
    expect(shell.classList.contains('shell-transitioning')).toBe(false)
    vi.useRealTimers()
  })
})

describe('SplitPanes — 칸막이 「양쪽 바꾸기」', () => {
  const renderSwap = () => {
    const onSwapSplit = vi.fn()
    const onLayoutChange = vi.fn()
    const onRootChange = vi.fn()
    render(
      <SplitPanes
        sidebar={<div>사이드바</div>}
        topBar={() => <div>상단바</div>}
        sidebarCollapsed
        onLayoutChange={onLayoutChange}
        onSwapSplit={onSwapSplit}
        onRootChange={onRootChange}
        root={cols2()}
        renderPane={body}
      />,
    )
    return { onSwapSplit, onLayoutChange, onRootChange, button: screen.getByRole('button', { name: '양쪽 패널 바꾸기' }) }
  }

  it('단추를 끌지 않고 떼면 그 나누기의 양쪽을 바꾼다', () => {
    const { onSwapSplit, button } = renderSwap()
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 500 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 500 })
    expect(onSwapSplit).toHaveBeenCalledWith(expect.stringMatching(/^s/u))
  })

  it('단추를 누른 채 끌면 바꾸지 않고 크기를 조정한다', () => {
    const { onSwapSplit, onLayoutChange, button } = renderSwap()
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 500 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 560 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 560 })
    expect(onSwapSplit).not.toHaveBeenCalled()
    expect(onLayoutChange).toHaveBeenCalled()
  })
})

describe('SplitPanes — 맨 윗줄 칸 표시(위 틈 없애기)', () => {
  it('세로로 쌓은 칸은 위쪽 칸만 data-top-edge 를 가진다', () => {
    const tree = layoutForLegacyId('rows2', ['T', 'B'])
    const { container } = renderPanes(false, undefined, 'split', false, tree)
    expect(cell(container, 0).hasAttribute('data-top-edge')).toBe(true)
    expect(cell(container, 1).hasAttribute('data-top-edge')).toBe(false)
  })

  it('가로로 나눈 두 칸은 모두 맨 윗줄이다', () => {
    const { container } = renderPanes()
    expect(cell(container, 0).hasAttribute('data-top-edge')).toBe(true)
    expect(cell(container, 1).hasAttribute('data-top-edge')).toBe(true)
  })
})
