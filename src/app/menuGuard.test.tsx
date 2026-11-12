// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MENU_GUARD_MS, menuGuardActive, resetMenuGuard } from './menuGuard'
import { PopupMenu } from './PopupMenu'
import { ContextMenu } from '../ui/ContextMenu'

afterEach(() => { cleanup(); resetMenuGuard(); vi.restoreAllMocks() })

/** 메뉴 밑에 깔린 내용(메모 카드 같은 것) */
function Under({ children, onClick, onEnterGuard }: { readonly children: React.ReactNode; readonly onClick: () => void; readonly onEnterGuard: (blocked: boolean) => void }) {
  return (
    <div>
      <div data-testid="under" onClick={onClick} onPointerEnter={() => onEnterGuard(menuGuardActive())}>카드</div>
      {children}
    </div>
  )
}

describe('메뉴 항목을 고른 직후, 밑에 있던 내용이 호버로 켜지지 않는다(모든 메뉴 공통)', () => {
  it('PopupMenu 항목을 고르면 짧은 시간 menuGuardActive 가 켜지고, 지나면 꺼진다 — 밑 카드의 pointerenter 는 그동안 비켜 간다', () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    const onEnter = vi.fn()
    render(
      <Under onClick={vi.fn()} onEnterGuard={onEnter}>
        <PopupMenu label="칸 메뉴" right={10} top={10} onClose={vi.fn()}>
          <button type="button" role="menuitem">띄우기</button>
        </PopupMenu>
      </Under>,
    )
    fireEvent.pointerEnter(screen.getByTestId('under'))
    expect(onEnter).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('menuitem', { name: '띄우기' }))
    now.mockReturnValue(1000 + MENU_GUARD_MS - 50)
    fireEvent.pointerEnter(screen.getByTestId('under'))
    expect(onEnter).toHaveBeenLastCalledWith(true)
    now.mockReturnValue(1000 + MENU_GUARD_MS + 50)
    fireEvent.pointerEnter(screen.getByTestId('under'))
    expect(onEnter).toHaveBeenLastCalledWith(false)
  })

  it('ContextMenu(우클릭 메뉴)도 같다', () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(5000)
    const onEnter = vi.fn()
    render(
      <Under onClick={vi.fn()} onEnterGuard={onEnter}>
        <ContextMenu x={5} y={5} label="문서" onClose={vi.fn()} entries={[{ key: 'a', icon: null, label: '열기', onSelect: vi.fn() }]} />
      </Under>,
    )
    fireEvent.click(screen.getByRole('menuitem', { name: '열기' }))
    fireEvent.pointerEnter(screen.getByTestId('under'))
    expect(onEnter).toHaveBeenLastCalledWith(true)
  })
})
