// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from './TopBar'

describe('TopBar', () => {
  it('버튼이 아닌 상단 영역을 잡아 프레임리스 창을 이동할 수 있다', () => {
    const { container } = render(
      <TopBar
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        sidebarMode="library"
        onSidebarModeChange={vi.fn()}
        sidebarPx={240}
        leftFrac={0.5}
        leftTabs={<span>왼쪽</span>}
        rightTabs={<span>오른쪽</span>}
      />,
    )

    expect(container.querySelector('.topbar')?.getAttribute('data-tauri-drag-region')).toBe('deep')
  })

  it('닫기 버튼은 앱이 제공한 저장 후 종료 동작을 호출한다', () => {
    const onCloseWindow = vi.fn()
    render(
      <TopBar
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        sidebarMode="library"
        onSidebarModeChange={vi.fn()}
        sidebarPx={240}
        leftFrac={0.5}
        leftTabs={<span>왼쪽</span>}
        rightTabs={<span>오른쪽</span>}
        onCloseWindow={onCloseWindow}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onCloseWindow).toHaveBeenCalledOnce()
  })

  it('동작하지 않는 뒤로·앞으로 주석단 버튼을 렌더링하지 않는다', () => {
    render(
      <TopBar
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        sidebarMode="library"
        onSidebarModeChange={vi.fn()}
        sidebarPx={240}
        leftFrac={0.5}
        leftTabs={<span>왼쪽</span>}
        rightTabs={<span>오른쪽</span>}
      />,
    )

    expect(screen.queryByRole('button', { name: '뒤로' })).toBeNull()
    expect(screen.queryByRole('button', { name: '앞으로' })).toBeNull()
  })

  it('사이드바가 접히면 빈 사이드바 폭을 남기지 않는 정렬 상태를 표시한다', () => {
    const { container } = render(
      <TopBar
        sidebarCollapsed
        onToggleSidebar={vi.fn()}
        sidebarMode="library"
        onSidebarModeChange={vi.fn()}
        sidebarPx={320}
        leftFrac={0.5}
        leftTabs={<span>왼쪽</span>}
        rightTabs={<span>오른쪽</span>}
      />,
    )
    expect(container.querySelector('.topbar')?.classList.contains('topbar-sidebar-collapsed')).toBe(true)
    expect((container.querySelector('.topbar-leftcluster') as HTMLElement).style.width).toBe('')
  })

  it('노트 전체화면에서 숨은 사이드바 폭이 탭 영역과 겹치지 않는다', () => {
    const { container } = render(
      <TopBar
        sidebarCollapsed={false}
        sidebarVisible={false}
        onToggleSidebar={vi.fn()}
        sidebarMode="library"
        onSidebarModeChange={vi.fn()}
        sidebarPx={320}
        leftFrac={0.5}
        leftTabs={<span>왼쪽</span>}
        rightTabs={<span>오른쪽</span>}
      />,
    )

    expect(container.querySelector('.topbar')?.classList.contains('topbar-sidebar-unreserved')).toBe(true)
    expect((container.querySelector('.topbar-leftcluster') as HTMLElement).style.width).toBe('')
    expect(screen.getByRole('button', { name: '사이드바 접기' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('주석 탭은 없고 다른 보기로 바꿀 수 있다', () => {
    const onSidebarModeChange = vi.fn()
    render(
      <TopBar
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        sidebarMode="thumbnails"
        onSidebarModeChange={onSidebarModeChange}
        sidebarPx={240}
        leftFrac={0.5}
        leftTabs={<span>왼쪽</span>}
        rightTabs={<span>오른쪽</span>}
      />,
    )
    expect(screen.queryByRole('radio', { name: '주석' })).toBeNull()
    expect(screen.getByRole('radio', { name: '미리보기' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '목록' }))
    expect(onSidebarModeChange).toHaveBeenCalledWith('outline')
  })

  it('맨 위 줄에 메모 바 열기·닫기 단추가 있다', () => {
    const onToggle = vi.fn()
    render(
      <TopBar
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        sidebarMode="library"
        onSidebarModeChange={vi.fn()}
        sidebarPx={240}
        leftFrac={1}
        leftTabs={<span>탭</span>}
        rightTabs={null}
        memoBar={{ visible: true, onToggle }}
      />,
    )
    const button = screen.getByRole('button', { name: '메모 바 닫기' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalled()
  })

  it('창 나누기는 PDF 화면 나누기와 같은 배치를 고른다', () => {
    const onPaneLayoutChange = vi.fn()
    render(
      <TopBar
        sidebarCollapsed={false}
        onToggleSidebar={vi.fn()}
        sidebarMode="library"
        onSidebarModeChange={vi.fn()}
        sidebarPx={240}
        leftFrac={1}
        leftTabs={<span>탭</span>}
        rightTabs={null}
        paneLayout="single"
        onPaneLayoutChange={onPaneLayoutChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '창 나누기' }))
    const items = screen.getAllByRole('menuitemradio')
    // PDF 안 화면 나누기와 같은 아홉 배치
    expect(items).toHaveLength(9)
    expect(items.map((item) => item.textContent)).toContain('위아래 둘')
    fireEvent.click(items.find((item) => item.textContent === '넷(2×2)')!)
    expect(onPaneLayoutChange).toHaveBeenCalledWith('grid4')
  })
})
