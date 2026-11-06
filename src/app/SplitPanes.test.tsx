// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { SplitPanes, type FocusedPane } from './SplitPanes'
import { SIDEBAR_DEFAULT } from './splitLayout'

/**
 * 드래그 수명주기 회귀. f885b7f 가 고친 리스너 크로스토크와, 그 뒤에
 * 더한 pointercancel/lostpointercapture 종료를 못박는다.
 *
 * 증상이 전부 "버튼을 안 눌렀는데 폭이 바뀐다"로 나타나므로 단언도
 * 전부 사이드바의 인라인 width 하나로 한다 — 내부 상태나 리스너 개수를
 * 들여다보면 구현을 바꿀 때마다 테스트가 같이 깨지고, 정작 사용자가
 * 보는 증상은 못 잡는다.
 */
function renderPanes(
  sidebarCollapsed = false,
  layout?: { sidebarPx: number; leftFrac: number },
  focusedPane: FocusedPane = 'split',
  libraryExpanded = false,
) {
  const view = render(
    <SplitPanes
      sidebar={<div>사이드바</div>}
      topBar={() => <div>상단바</div>}
      sidebarCollapsed={sidebarCollapsed}
      layout={layout}
      focusedPane={focusedPane}
      libraryExpanded={libraryExpanded}
      left={<div>왼쪽</div>}
      right={<div>오른쪽</div>}
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
  it('복원한 사이드바 폭과 패널 비율로 시작한다', () => {
    const { container } = renderPanes(false, { sidebarPx: 310, leftFrac: 0.4 })
    expect(sidebarWidth(container)).toBe('310px')
    const panes = container.querySelectorAll('.pane')
    const leftPane = panes.item(0)
    const rightPane = panes.item(1)
    if (!(leftPane instanceof HTMLElement) || !(rightPane instanceof HTMLElement)) {
      throw new Error('패널을 찾지 못했다')
    }
    expect(leftPane.style.flexGrow).toBe('0.4')
    expect(rightPane.style.flexGrow).toBe('0.6')
  })

  it('노트 전체 화면에서도 두 패널을 마운트한 채 PDF 쪽만 숨긴다', () => {
    const { container } = renderPanes(false, { sidebarPx: 310, leftFrac: 0.4 }, 'note')
    const left = container.querySelector('.pane-left')
    const right = container.querySelector('.pane-right')
    expect(left?.getAttribute('aria-hidden')).toBe('true')
    expect(right?.getAttribute('aria-hidden')).toBe('false')
    expect(left?.textContent).toContain('왼쪽')
    expect(right?.textContent).toContain('오른쪽')
    expect(container.querySelector('.sidebar')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('노트 전체 화면에서는 상단바에 사이드바 폭을 예약하지 않는다', () => {
    const { container } = render(
      <SplitPanes
        sidebar={<div>사이드바</div>}
        topBar={({ leftFrac, sidebarVisible }) => (
          <div
            data-testid="topbar-layout"
            data-left-frac={leftFrac}
            data-sidebar-visible={String(sidebarVisible)}
          />
        )}
        sidebarCollapsed={false}
        focusedPane="note"
        left={<div>왼쪽</div>}
        right={<div>오른쪽</div>}
      />,
    )

    expect(container.querySelector('[data-testid="topbar-layout"]')?.getAttribute('data-sidebar-visible')).toBe('false')
    expect(container.querySelector('[data-testid="topbar-layout"]')?.getAttribute('data-left-frac')).toBe('0')
  })
})

describe('SplitPanes — 집중 모드와 라이브러리', () => {
  it('reader 집중이면 사이드바와 오른쪽 패널을 숨기고 왼쪽을 꽉 채운다', () => {
    const { container } = renderPanes(false, undefined, 'reader')
    const shell = container.querySelector('.shell') as HTMLElement
    expect(shell.classList.contains('shell-reader-focused')).toBe(true)
    expect(shell.style.getPropertyValue('--sidebar-width')).toBe('0px')
    const right = container.querySelector('.pane-right') as HTMLElement
    const left = container.querySelector('.pane-left') as HTMLElement
    expect(right.getAttribute('aria-hidden')).toBe('true')
    expect(right.hasAttribute('inert')).toBe(true)
    expect(left.style.flexGrow).toBe('1')
    expect(right.style.flexGrow).toBe('0')
  })

  it('라이브러리를 펼치면 사이드바가 전체 폭이 되고 패널은 inert 가 된다', () => {
    const { container } = renderPanes(true, undefined, 'split', true)
    const shell = container.querySelector('.shell') as HTMLElement
    expect(shell.classList.contains('shell-library-expanded')).toBe(true)
    expect(shell.style.getPropertyValue('--sidebar-width')).toBe('100%')
    const panes = container.querySelector('.panes') as HTMLElement
    expect(panes.hasAttribute('inert')).toBe(true)
    expect(panes.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('separator', { name: '사이드바 너비 조절' })).toBeNull()
  })

  it('접힌 사이드바에서 라이브러리를 펼쳐도 접힘 표시(클릭 차단)를 붙이지 않는다', () => {
    const { container } = renderPanes(true, undefined, 'split', true)
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
        focusedPane="reader" left={<div>왼쪽</div>} right={<div>오른쪽</div>} />,
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
    const onSwapPanes = vi.fn()
    const onLayoutChange = vi.fn()
    render(
      <SplitPanes
        sidebar={<div>사이드바</div>}
        topBar={() => <div>상단바</div>}
        sidebarCollapsed
        onLayoutChange={onLayoutChange}
        onSwapPanes={onSwapPanes}
        left={<div>왼쪽</div>}
        right={<div>오른쪽</div>}
      />,
    )
    return { onSwapPanes, onLayoutChange, button: screen.getByRole('button', { name: '양쪽 패널 바꾸기' }) }
  }

  it('단추를 끌지 않고 떼면 양쪽을 바꾼다', () => {
    const { onSwapPanes, button } = renderSwap()
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 500 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 500 })
    expect(onSwapPanes).toHaveBeenCalledWith(0)
  })

  it('단추를 누른 채 끌면 바꾸지 않고 폭을 조정한다', () => {
    const { onSwapPanes, onLayoutChange, button } = renderSwap()
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 500 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 560 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 560 })
    expect(onSwapPanes).not.toHaveBeenCalled()
    expect(onLayoutChange).toHaveBeenCalled()
  })
})
