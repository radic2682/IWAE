// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PaneTabsMenu } from './PaneTabsMenu'
import type { TabsState } from './tabs'

const state: TabsState = {
  tabs: [
    { id: 'spec', title: 'HTTP Semantics Guide', kind: 'pdf' },
    { id: 'book', title: 'Rust Handbook', kind: 'pdf' },
  ],
  activeId: 'book',
}

describe('PaneTabsMenu', () => {
  it('열린 문서마다 상단에 탭 하나를 그리고 활성 탭을 표시한다', () => {
    render(<PaneTabsMenu state={state} label="PDF" onActivate={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'HTTP Semantics Guide' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tab', { name: 'Rust Handbook' }).getAttribute('aria-selected')).toBe('true')
  })

  it('목록 단추로 열린 탭 목록을 열고 선택한 탭으로 전환한다', () => {
    const onActivate = vi.fn()
    render(<PaneTabsMenu state={state} label="PDF" onActivate={onActivate} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /탭 목록/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'HTTP Semantics Guide' }))

    expect(onActivate).toHaveBeenCalledWith('spec')
  })

  it('탭을 우클릭하면 닫기·다른 탭 모두 닫기 메뉴가 뜬다', () => {
    const onClose = vi.fn()
    render(<PaneTabsMenu state={state} label="PDF" onActivate={vi.fn()} onClose={onClose} />)

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Rust Handbook' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '다른 탭 모두 닫기' }))

    expect(onClose).toHaveBeenCalledTimes(state.tabs.length - 1)
    expect(onClose).not.toHaveBeenCalledWith(state.tabs.find((tab) => tab.title === 'Rust Handbook')!.id)
  })

  it('목록에서 탭을 닫을 수 있다', () => {
    const onClose = vi.fn()
    render(<PaneTabsMenu state={state} label="PDF" onActivate={vi.fn()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /탭 목록/ }))
    fireEvent.click(screen.getByRole('button', { name: 'HTTP Semantics Guide 목록에서 닫기' }))

    expect(onClose).toHaveBeenCalledWith('spec')
  })

  it('탭이 많아도 목록 버튼으로 원하는 탭을 선택한다', () => {
    const onActivate = vi.fn()
    const many: TabsState = {
      tabs: Array.from({ length: 12 }, (_, index) => ({ id: `pdf-${index}`, title: `PDF ${index + 1}`, kind: 'pdf' as const })),
      activeId: 'pdf-11',
    }
    render(<PaneTabsMenu state={many} label="PDF" onActivate={onActivate} onClose={vi.fn()} />)
    expect(screen.getAllByRole('tab')).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: /^열린 PDF 탭 목록 \(\d+개\)$/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'PDF 1' }))
    expect(onActivate).toHaveBeenCalledWith('pdf-0')
  })

  it('× 로 닫으면 남은 탭 폭을 그대로 묶어 두고, 마우스가 탭 줄을 벗어나면 푼다(크롬처럼)', () => {
    const three: TabsState = {
      tabs: [
        { id: 'a', title: 'A', kind: 'pdf' },
        { id: 'b', title: 'B', kind: 'pdf' },
        { id: 'c', title: 'C', kind: 'pdf' },
      ],
      activeId: 'a',
    }
    const onClose = vi.fn()
    const view = render(<PaneTabsMenu state={three} label="PDF" onActivate={vi.fn()} onClose={onClose} />)
    const tabA = view.container.querySelector<HTMLElement>('[data-tab-id="a"]')!
    tabA.getBoundingClientRect = () => ({ width: 180, height: 33, x: 0, y: 0, top: 0, left: 0, right: 180, bottom: 33, toJSON: () => ({}) })

    fireEvent.click(screen.getByRole('button', { name: 'A 닫기' }))
    expect(onClose).toHaveBeenCalledWith('a')
    view.rerender(<PaneTabsMenu state={{ tabs: three.tabs.slice(1), activeId: 'b' }} label="PDF" onActivate={vi.fn()} onClose={onClose} />)
    const tabB = view.container.querySelector<HTMLElement>('[data-tab-id="b"]')!
    expect(tabB.style.width).toBe('180px')

    fireEvent.pointerLeave(view.container.querySelector('.pane-tabs-strip')!)
    expect(view.container.querySelector<HTMLElement>('[data-tab-id="b"]')!.style.width).toBe('')
  })

  it('가운데 단추(휠 클릭)로 탭을 닫는다', () => {
    const onClose = vi.fn()
    const view = render(<PaneTabsMenu state={state} label="PDF" onActivate={vi.fn()} onClose={onClose} />)
    fireEvent(view.container.querySelector('[data-tab-id="spec"]')!, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
    expect(onClose).toHaveBeenCalledWith('spec')
  })

  it('열린 탭이 없으면 빈 제목을 보여주고 메뉴를 열지 않는다', () => {
    render(
      <PaneTabsMenu
        state={{ tabs: [], activeId: null }}
        label="캔버스"
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const empty = screen.getByRole('group', { name: '열린 캔버스 없음' })
    // 머리에는 안내 글자가 없다(본문의 「빈 칸」 과 겹말) — 이름은 접근성 이름으로만 남는다
    expect(screen.queryByText('열린 캔버스 없음')).toBeNull()
    fireEvent.contextMenu(empty)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('PaneTabsMenu — 말풍선(title)은 이름이 다 안 보이는 탭에만', () => {
  const three: TabsState = {
    tabs: [
      { id: 'a', title: 'Fits', kind: 'pdf' },
      { id: 'b', title: 'A very long title that is cut', kind: 'pdf' },
      { id: 'c', title: 'Icon only', kind: 'pdf' },
    ],
    activeId: 'a',
  }
  const widths = { clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'), scrollWidth: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth') }
  afterEach(() => {
    if (widths.clientWidth !== undefined) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widths.clientWidth)
    if (widths.scrollWidth !== undefined) Object.defineProperty(Element.prototype, 'scrollWidth', widths.scrollWidth)
    document.head.querySelectorAll('style[data-test]').forEach((style) => style.remove())
  })

  it('이름이 다 보이는 탭에는 title 이 없고, 줄임표로 잘린 탭 · 아이콘만 남은 탭에만 이름이 말풍선으로 붙는다', () => {
    // jsdom 에는 레이아웃이 없다: 탭 폭 200 · 이름 칸 폭 50, 긴 이름만 내용이 120(잘림)
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('pane-top-tab-label') ? 50 : 200 } })
    Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get() { return (this as HTMLElement).textContent?.startsWith('A very long') === true && (this as HTMLElement).classList.contains('pane-top-tab-label') ? 120 : 50 } })
    const style = document.createElement('style')
    style.dataset.test = ''
    style.textContent = '[data-tab-id="c"] .pane-top-tab-label { display: none; }'
    document.head.append(style)
    render(<PaneTabsMenu state={three} label="PDF" onActivate={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Fits' }).hasAttribute('title')).toBe(false)
    expect(screen.getByRole('tab', { name: 'A very long title that is cut' }).getAttribute('title')).toBe('A very long title that is cut')
    expect(screen.getByRole('tab', { name: 'Icon only' }).getAttribute('title')).toBe('Icon only')
  })
})
