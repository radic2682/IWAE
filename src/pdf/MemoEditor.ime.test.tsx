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

describe('MemoEditor when the stored text changes while typing', () => {
  it('keeps both the typed text and the external text on save', () => {
    const onSave = vi.fn(); const onCancel = vi.fn()
    const { getByRole, rerender } = render(<MemoEditor initialText="old" onSave={onSave} onCancel={onCancel} />)
    const editor = getByRole('textbox')
    editor.textContent = 'old plus mine'
    rerender(<MemoEditor initialText="theirs" onSave={onSave} onCancel={onCancel} />)
    return Promise.resolve().then(() => {
      fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
      expect(onSave).toHaveBeenCalledTimes(1)
      const saved = onSave.mock.calls[0]![0] as { text: string }
      expect(saved.text).toContain('old plus mine')
      expect(saved.text).toContain('theirs')
    })
  })

  it('does not overwrite an external change when nothing was typed', () => {
    const onSave = vi.fn(); const onCancel = vi.fn()
    const { getByRole, rerender } = render(<MemoEditor initialText="old" onSave={onSave} onCancel={onCancel} />)
    const editor = getByRole('textbox')
    rerender(<MemoEditor initialText="theirs" onSave={onSave} onCancel={onCancel} />)
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(onSave).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('MemoEditor keep-both notice', () => {
  it('announces when the external text is kept below the typed text', async () => {
    const heard: string[] = []
    const listen = (event: Event) => heard.push((event as CustomEvent<string>).detail)
    window.addEventListener('iwae:action-feedback', listen)
    const { getByRole, rerender } = render(<MemoEditor initialText="old" onSave={vi.fn()} onCancel={vi.fn()} />)
    const editor = getByRole('textbox')
    editor.textContent = 'mine'
    rerender(<MemoEditor initialText="theirs" onSave={vi.fn()} onCancel={vi.fn()} />)
    await Promise.resolve()
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    window.removeEventListener('iwae:action-feedback', listen)
    expect(heard).toHaveLength(1)
  })
})
