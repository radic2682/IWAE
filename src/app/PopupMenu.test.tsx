// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PopupMenu } from './PopupMenu'

function Host() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button">연 단추</button>
      {open ? (
        // 일부러 매번 새 onClose 를 건넨다(호출하는 쪽이 보통 그렇게 한다)
        <PopupMenu label="칸 메뉴" top={0} left={0} onClose={(restoreFocus) => { setOpen(false); if (restoreFocus) screen.getByRole('button', { name: '연 단추' }).focus() }}>
          <button type="button" role="menuitem">하나</button>
          <button type="button" role="menuitem">둘</button>
        </PopupMenu>
      ) : null}
    </>
  )
}

describe('PopupMenu', () => {
  it('열리면 첫 항목에 초점이 가고 ↓ 로 다음 항목으로 간다', () => {
    render(<Host />)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '하나' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '둘' }))
  })

  it('초점이 항목에 있어도 Esc 로 닫히고 연 단추로 초점이 돌아간다', () => {
    render(<Host />)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '연 단추' }))
  })

  it('Tab 으로 초점이 나가면 닫힌다', () => {
    render(<Host />)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
