// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { applyRoving, handleTreeKey, installTreeKeyboard } from './treeKeyboard'
import { useFocusTrap } from './useFocusTrap'

installTreeKeyboard()
// jsdom 은 배치를 하지 않아 getClientRects 가 비어 있다: 보이는 것으로 친다
HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList
afterEach(cleanup)

function Trap() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>열기</button>
      {open ? <Dialog refTo={ref} onClose={() => setOpen(false)} /> : null}
    </div>
  )
}
function Dialog({ refTo, onClose }: { refTo: React.RefObject<HTMLDivElement | null>; onClose: () => void }) {
  useFocusTrap(refTo)
  return (
    <div ref={refTo} role="dialog">
      <button type="button">첫째</button>
      <button type="button" onClick={onClose}>닫기</button>
    </div>
  )
}

describe('useFocusTrap', () => {
  it('열리면 안으로 초점이 가고, Tab 이 처음↔끝을 돌고, 닫히면 열던 단추로 돌아간다', () => {
    render(<Trap />)
    const opener = screen.getByRole('button', { name: '열기' })
    opener.focus()
    fireEvent.click(opener)
    const first = screen.getByRole('button', { name: '첫째' })
    const last = screen.getByRole('button', { name: '닫기' })
    expect(document.activeElement).toBe(first)
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.click(last)
    expect(document.activeElement).toBe(opener)
  })
})

function Tree() {
  return (
    <ul className="side-tree" role="tree">
      <li role="treeitem" aria-expanded="true"><div className="side-tree-row" style={{ '--side-tree-depth': 0 } as React.CSSProperties}><button type="button">폴더</button></div></li>
      <li role="treeitem"><div className="side-tree-row" style={{ '--side-tree-depth': 1 } as React.CSSProperties}><button type="button">문서A</button></div></li>
      <li role="treeitem" aria-expanded="false"><div className="side-tree-row" style={{ '--side-tree-depth': 0 } as React.CSSProperties}><button type="button" onClick={(event) => event.currentTarget.parentElement?.parentElement?.setAttribute('aria-expanded', 'true')}>폴더2</button></div></li>
    </ul>
  )
}

describe('트리 방향키', () => {
  const press = (name: string, key: string) => {
    const target = screen.getByRole('button', { name })
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event
  }

  it('↑↓ 로 행을 옮기고, ← 는 부모로, → 는 접힌 폴더를 펼친다', () => {
    render(<Tree />)
    screen.getByRole('button', { name: '폴더' }).focus()
    press('폴더', 'ArrowDown')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '문서A' }))
    press('문서A', 'ArrowLeft')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '폴더' }))
    press('폴더', 'End')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '폴더2' }))
    press('폴더2', 'ArrowRight')
    expect(screen.getByRole('button', { name: '폴더2' }).closest('li')?.getAttribute('aria-expanded')).toBe('true')
    press('폴더2', 'Home')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '폴더' }))
  })

  it('입력 칸이나 수식 키가 눌렸을 때는 건드리지 않는다', () => {
    render(<Tree />)
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true, cancelable: true })
    expect(handleTreeKey(event)).toBe(false)
  })

  it('roving tabindex: 대표 단추 하나만 Tab 으로 닿는다', () => {
    const view = render(<Tree />)
    const root = view.container.querySelector('ul') as HTMLElement
    applyRoving(root)
    const tabs = [...root.querySelectorAll('button')].map((button) => button.getAttribute('tabindex'))
    expect(tabs).toEqual(['0', '-1', '-1'])
    applyRoving(root, root.querySelectorAll('li')[2] as HTMLElement)
    expect([...root.querySelectorAll('button')].map((button) => button.getAttribute('tabindex'))).toEqual(['-1', '-1', '0'])
  })
})

describe('메뉴 방향키', () => {
  it('↑↓ 가 항목을 돌고 Home·End 가 처음·끝으로 간다', () => {
    render(
      <div role="menu">
        <button type="button" role="menuitem">하나</button>
        <button type="button" role="menuitem">둘</button>
        <button type="button" role="menuitem">셋</button>
      </div>,
    )
    const press = (name: string, key: string) => screen.getByRole('menuitem', { name }).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    screen.getByRole('menuitem', { name: '하나' }).focus()
    press('하나', 'ArrowDown')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '둘' }))
    press('둘', 'End')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '셋' }))
    press('셋', 'ArrowDown')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '하나' }))
    press('하나', 'ArrowUp')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '셋' }))
  })
})
