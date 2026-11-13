// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GithubSource } from '../../bridge/github'
import { GithubChangesDialog } from './GithubDialogs'

afterEach(cleanup)

const SOURCE: GithubSource = {
  name: 'repo', target: 'Docs', url: 'https://github.com/o/r', path: null, branch: 'main', detached: null,
  head: 'abc1234', headDate: '2026-11-13', headSubject: 'update', behind: 0,
}

describe('GithubChangesDialog', () => {
  it('받은 뒤에는 .md 와 .markdown 모두 열기 단추가 켜져 있고 누르면 그 경로로 연다', () => {
    const onOpen = vi.fn()
    render(<GithubChangesDialog source={SOURCE} changed={['Docs/repo/a.md', 'Docs/repo/b.MARKDOWN', 'Docs/repo/c.pdf']} applied onOpen={onOpen} onClose={vi.fn()} />)
    const buttons = screen.getAllByRole('button').filter((button) => button.classList.contains('gh-change'))
    expect(buttons).toHaveLength(3)
    const [md, markdown, pdf] = buttons as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement]
    expect(md.disabled).toBe(false)
    expect(markdown.disabled).toBe(false)
    // PDF 는 이 단추로 열지 않는다(기존 동작)
    expect(pdf.disabled).toBe(true)
    fireEvent.click(markdown)
    expect(onOpen).toHaveBeenCalledWith('Docs/repo/b.MARKDOWN')
  })
})
