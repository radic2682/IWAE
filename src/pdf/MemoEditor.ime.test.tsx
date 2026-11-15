// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { MemoEditor } from './MemoEditor'

afterEach(cleanup)

describe('MemoEditor while composing', () => {
  it('Esc and Ctrl+Enter during IME composition do not cancel or save', () => {
    const onSave = vi.fn(); const onCancel = vi.fn()
    const { getByRole } = render(<MemoEditor initialText="가" onSave={onSave} onCancel={onCancel} />)
    const editor = getByRole('textbox')
    fireEvent.keyDown(editor, { key: 'Escape', keyCode: 229, isComposing: true })
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, keyCode: 229, isComposing: true })
    expect(onCancel).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
