// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AppShortcut } from '../core/keyboardShortcuts'
import { useAppShortcuts } from './useAppShortcuts'

function Harness({ actions }: { actions: Partial<Record<AppShortcut, () => void>> }) {
  useAppShortcuts(actions)
  return <input aria-label="편집기" />
}

describe('useAppShortcuts', () => {
  it('등록된 앱 단축키를 실행하고 브라우저 기본 동작을 막는다', () => {
    const save = vi.fn()
    const undo = vi.fn()
    const remove = vi.fn()
    render(<Harness actions={{ save, undo, delete: remove }} />)

    const saveEvent = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(saveEvent)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'Delete' })

    expect(save).toHaveBeenCalledTimes(1)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(saveEvent.defaultPrevented).toBe(true)
  })

  it('입력 필드에서는 저장 외 편집 단축키를 가로채지 않는다', () => {
    const save = vi.fn()
    const undo = vi.fn()
    const view = render(<Harness actions={{ save, undo }} />)
    const input = view.getByRole('textbox', { name: '편집기' })

    fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(input, { key: 's', ctrlKey: true })

    expect(undo).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('scope 가 false 면 이 묶음은 키를 받지 않고 브라우저 기본 동작도 막지 않는다', () => {
    const undo = vi.fn()
    let inScope = false
    function Scoped() {
      useAppShortcuts({ undo }, () => inScope)
      return null
    }
    render(<Scoped />)
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(undo).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    inScope = true
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(undo).toHaveBeenCalledTimes(1)
  })
})
