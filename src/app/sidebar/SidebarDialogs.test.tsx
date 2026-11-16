// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AddPdfDialog } from './SidebarDialogs'

describe('sidebar dialogs focus', () => {
  it('문서 추가: 열리면 고른 폴더로 초점이 가고 Tab 이 밖으로 나가지 않으며 닫으면 연 단추로 돌아간다', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const view = render(<AddPdfDialog currentFolder="" folderChoices={['A', 'B']} onChoose={vi.fn()} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: '문서 추가' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: '닫기' }))
    // 마지막 단추에서 Tab 하면 처음으로 돈다
    const primary = screen.getByRole('button', { name: '파일을 골라 복사' })
    primary.focus()
    const wrapped = fireEvent.keyDown(primary, { key: 'Tab' })
    expect(wrapped).toBe(false)
    expect(dialog.contains(document.activeElement)).toBe(true)
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

})
