// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
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

    const empty = screen.getByText('열린 캔버스 없음')
    fireEvent.contextMenu(empty)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
