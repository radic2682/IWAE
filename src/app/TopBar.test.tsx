// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from './TopBar'

const props = { sidebarCollapsed: false, onToggleSidebar: vi.fn(), sidebarMode: 'library' as const, onSidebarModeChange: vi.fn(), sidebarPx: 240 }

const templates = [
  { id: 'read', label: '읽기', hint: '문서 | 노트' },
  { id: 'compare', label: '비교', hint: '문서 둘 | 노트 둘' },
  { id: 'blank', label: '빈 화면', hint: '빈 칸 하나' },
]

function screensProp(overrides: Partial<NonNullable<React.ComponentProps<typeof TopBar>['screens']>> = {}) {
  return {
    items: [{ id: 'w1', name: '읽기' }, { id: 'w2', name: '비교' }, { id: 'w3', name: '정리' }],
    activeId: 'w1',
    lastId: 'w2',
    templates,
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onReorder: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    ...overrides,
  }
}

describe('TopBar', () => {
  it('버튼이 아닌 상단 영역을 잡아 프레임리스 창을 이동할 수 있다', () => {
    const { container } = render(<TopBar {...props} />)
    expect(container.querySelector('.topbar')?.getAttribute('data-tauri-drag-region')).toBe('deep')
  })

  it('닫기 버튼은 앱이 제공한 저장 후 종료 동작을 호출한다', () => {
    const onCloseWindow = vi.fn()
    render(<TopBar {...props} onCloseWindow={onCloseWindow} />)
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(onCloseWindow).toHaveBeenCalledOnce()
  })

  it('동작하지 않는 뒤로·앞으로 주석단 버튼을 렌더링하지 않는다', () => {
    render(<TopBar {...props} />)
    expect(screen.queryByRole('button', { name: '뒤로' })).toBeNull()
    expect(screen.queryByRole('button', { name: '앞으로' })).toBeNull()
  })

  it('사이드바가 접히면 빈 사이드바 폭을 남기지 않는 정렬 상태를 표시한다', () => {
    const { container } = render(<TopBar {...props} sidebarCollapsed sidebarPx={320} />)
    expect(container.querySelector('.topbar')?.classList.contains('topbar-sidebar-collapsed')).toBe(true)
    expect((container.querySelector('.topbar-leftcluster') as HTMLElement).style.width).toBe('')
  })

  it('노트 전체화면에서 숨은 사이드바 폭이 줄과 겹치지 않는다', () => {
    const { container } = render(<TopBar {...props} sidebarVisible={false} sidebarPx={320} />)
    expect(container.querySelector('.topbar')?.classList.contains('topbar-sidebar-unreserved')).toBe(true)
    expect((container.querySelector('.topbar-leftcluster') as HTMLElement).style.width).toBe('')
    expect(screen.getByRole('button', { name: '사이드바 접기' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('주석 탭은 없고 다른 보기로 바꿀 수 있다', () => {
    const onSidebarModeChange = vi.fn()
    render(<TopBar {...props} sidebarMode="thumbnails" onSidebarModeChange={onSidebarModeChange} />)
    expect(screen.queryByRole('radio', { name: '주석' })).toBeNull()
    expect(screen.getByRole('radio', { name: '미리보기' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '목록' }))
    expect(onSidebarModeChange).toHaveBeenCalledWith('outline')
  })

  it('맨 왼쪽 로고 단추가 앱 메뉴를 열고, 고른 항목을 실행한다', () => {
    const onPrint = vi.fn()
    const onSettings = vi.fn()
    render(
      <TopBar
        {...props}
        appMenu={[
          [{ id: 'print', label: '인쇄', hint: 'Ctrl+P', onSelect: onPrint }],
          [],
          [{ id: 'settings', label: '설정', onSelect: onSettings }],
        ]}
      />,
    )
    const button = screen.getByRole('button', { name: 'IWAE 메뉴' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    const items = screen.getAllByRole('menuitem')
    // 빈 묶음은 그리지 않는다
    expect(items.map((item) => item.textContent)).toEqual(['인쇄Ctrl+P', '설정'])
    fireEvent.click(items[1]!)
    expect(onSettings).toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('사이드바를 접으면 사이드바 보기 탭을 숨기고, 로고 메뉴는 남긴다', () => {
    render(<TopBar {...props} sidebarCollapsed appMenu={[[{ id: 'settings', label: '설정', onSelect: vi.fn() }]]} />)
    expect(screen.queryByRole('radiogroup', { name: '사이드바 보기' })).toBeNull()
    expect(screen.getByRole('button', { name: 'IWAE 메뉴' })).toBeDefined()
  })

  describe('칸 탭 구역은 없다 — 화면 탭이 대신한다', () => {
    it('상단바에 문서 탭 구역(.topbar-panetab-zone)이 없고, 창 나누기·옆에 노트 단추도 없다', () => {
      const { container } = render(<TopBar {...props} screens={screensProp()} onOpenPalette={vi.fn()} />)
      expect(container.querySelectorAll('.topbar-panetab-zone')).toHaveLength(0)
      expect(container.querySelector('.topbar-panetabs')).toBeNull()
      expect(screen.queryByRole('button', { name: '창 나누기' })).toBeNull()
      expect(screen.queryByRole('button', { name: '옆에 노트 열기' })).toBeNull()
      expect(screen.queryByRole('button', { name: '옆에 노트 닫기' })).toBeNull()
      // 탭 줄 자체(탭 목록)가 상단바에 없다: 있는 tablist 는 화면 탭 하나뿐
      expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(1)
      expect(container.querySelector('.pane-tabs-menu')).toBeNull()
    })

    it('「세션 이름 ▾」 단추가 「기본」을 보이고, 메뉴는 세션이 다음 단계라고 알리며 새 화면 템플릿을 둔다', () => {
      const screens = screensProp()
      render(<TopBar {...props} screens={screens} />)
      const button = screen.getByRole('button', { name: '기본' })
      expect(button.getAttribute('aria-haspopup')).toBe('menu')
      fireEvent.click(button)
      const menu = screen.getByRole('menu', { name: '세션' })
      expect(menu.textContent).toContain('세션은 다음 단계에서')
      fireEvent.click(within(menu).getByRole('menuitem', { name: /비교/u }))
      expect(screens.onNew).toHaveBeenCalledWith('compare')
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('「⌘ 명령」 단추가 창 단추 곁에 있고 명령 팔레트를 연다', () => {
      const onOpenPalette = vi.fn()
      const { container } = render(<TopBar {...props} onOpenPalette={onOpenPalette} paletteShortcut="Ctrl+K" />)
      const tools = container.querySelector('.wincontrols .topbar-window-tools') as HTMLElement
      const button = within(tools).getByRole('button', { name: '명령 팔레트' })
      expect(button.textContent).toContain('명령 (Ctrl+K)')
      fireEvent.click(button)
      expect(onOpenPalette).toHaveBeenCalledOnce()
    })
  })

  describe('화면 탭', () => {
    it('「0 읽기」 「1 비교」 …를 보이고 보는 화면이 선택되어 있다', () => {
      render(<TopBar {...props} screens={screensProp()} />)
      const tabs = screen.getAllByRole('tab')
      expect(tabs.map((tab) => tab.textContent)).toEqual(['0읽기', '1비교-', '2정리'])
      expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    })

    it('누르면 그 화면으로 간다', () => {
      const screens = screensProp()
      render(<TopBar {...props} screens={screens} />)
      fireEvent.click(screen.getByRole('tab', { name: /정리/u }))
      expect(screens.onSelect).toHaveBeenCalledWith('w3')
    })

    it('두 번 누르면 이름 바꾸기: Enter 로 확정하고 Esc 로 취소한다', () => {
      const screens = screensProp()
      render(<TopBar {...props} screens={screens} />)
      fireEvent.doubleClick(screen.getByRole('tab', { name: /비교/u }))
      const input = screen.getByRole('textbox', { name: '화면 이름' })
      fireEvent.change(input, { target: { value: '대조' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(screens.onRename).toHaveBeenCalledWith('w2', '대조')
      expect(screen.queryByRole('textbox')).toBeNull()

      fireEvent.doubleClick(screen.getByRole('tab', { name: /정리/u }))
      fireEvent.keyDown(screen.getByRole('textbox', { name: '화면 이름' }), { key: 'Escape' })
      expect(screens.onRename).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('textbox')).toBeNull()
    })

    it('끌어서 순서를 바꾼다: 이웃 탭의 가운데를 넘으면 그 뒤로 간다', () => {
      const screens = screensProp()
      const { container } = render(<TopBar {...props} screens={screens} />)
      const rects: Record<string, [number, number]> = { w1: [0, 100], w2: [100, 100], w3: [200, 100] }
      for (const [id, [left, width]] of Object.entries(rects)) {
        const element = container.querySelector(`[data-screen-id="${id}"]`) as HTMLElement
        element.getBoundingClientRect = () => ({ left, width, right: left + width, top: 0, bottom: 26, height: 26, x: left, y: 0, toJSON: () => ({}) })
      }
      const first = container.querySelector('[data-screen-id="w1"]') as HTMLElement
      fireEvent.pointerDown(first, { button: 0, clientX: 50 })
      fireEvent(window, new MouseEvent('pointermove', { clientX: 260 }))
      fireEvent(window, new MouseEvent('pointerup', { clientX: 260 }))
      // 나머지(w2, w3) 기준으로 x=260 은 둘 다의 가운데를 넘었다 → 맨 뒤(2)
      expect(screens.onReorder).toHaveBeenCalledWith('w1', 2)
    })

    it('조금만 움직이면 끌기가 아니라 누름이다(순서가 바뀌지 않는다)', () => {
      const screens = screensProp()
      const { container } = render(<TopBar {...props} screens={screens} />)
      fireEvent.pointerDown(container.querySelector('[data-screen-id="w2"]') as HTMLElement, { button: 0, clientX: 150 })
      fireEvent(window, new MouseEvent('pointermove', { clientX: 152 }))
      fireEvent(window, new MouseEvent('pointerup', { clientX: 152 }))
      expect(screens.onReorder).not.toHaveBeenCalled()
    })

    it('Alt+←→ 로도 순서를 바꾼다', () => {
      const screens = screensProp()
      render(<TopBar {...props} screens={screens} />)
      fireEvent.keyDown(screen.getByRole('tab', { name: /비교/u }), { key: 'ArrowRight', altKey: true })
      expect(screens.onReorder).toHaveBeenCalledWith('w2', 2)
    })

    it('「＋」는 템플릿 목록을 펼치고 고른 템플릿으로 새 화면을 만든다', () => {
      const screens = screensProp()
      render(<TopBar {...props} screens={screens} />)
      fireEvent.click(screen.getByRole('button', { name: '새 화면' }))
      const menu = screen.getByRole('menu', { name: '새 화면' })
      expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['읽기문서 | 노트', '비교문서 둘 | 노트 둘', '빈 화면빈 칸 하나'])
      fireEvent.click(within(menu).getByRole('menuitem', { name: /빈 화면/u }))
      expect(screens.onNew).toHaveBeenCalledWith('blank')
    })

    it('우클릭 메뉴에서 닫는다(화면이 하나뿐이면 닫을 수 없다)', () => {
      const screens = screensProp()
      const { rerender } = render(<TopBar {...props} screens={screens} />)
      fireEvent.contextMenu(screen.getByRole('tab', { name: /비교/u }))
      fireEvent.click(screen.getByRole('menuitem', { name: /화면 닫기/u }))
      expect(screens.onClose).toHaveBeenCalledWith('w2')

      rerender(<TopBar {...props} screens={screensProp({ items: [{ id: 'w1', name: '읽기' }], lastId: null })} />)
      fireEvent.contextMenu(screen.getByRole('tab', { name: /읽기/u }))
      expect((screen.getByRole('menuitem', { name: /화면 닫기/u }) as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
