// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PdfToolsPanel } from './PdfToolsPanel'
import { SearchScopeSwitch } from './DocumentSearchPanel'
import { ThumbnailPanel } from './SidePanels'
import { publishPdfViewport } from '../pdf/pdfViewportStore'
import type { PdfDocMeta } from '../bridge/pdf'

vi.mock('../bridge/pdf', () => ({ pageImageUrl: () => '/page.png', pdfOutline: () => Promise.resolve([]) }))

describe('PdfToolsPanel', () => {
  it('lists the tools including page edit, and reports the picked tool', () => {
    const onPick = vi.fn()
    render(<PdfToolsPanel docTitle="문서" activeTool="flatten" onPick={onPick} />)
    expect(screen.getByRole('button', { name: '쪽 편집' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '주석을 넣은 PDF 저장' }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '쪽 번호 넣기' }))
    expect(onPick).toHaveBeenCalledWith('numbers')
  })
  it('unfolds the picked tool body right under its row, only for that tool', () => {
    const renderTool = vi.fn((tool: string) => <div data-testid="body">{tool} 옵션</div>)
    const { container } = render(<PdfToolsPanel docTitle="문서" activeTool="numbers" onPick={vi.fn()} renderTool={renderTool} />)
    expect(screen.getAllByTestId('body')).toHaveLength(1)
    const entry = screen.getByRole('button', { name: '쪽 번호 넣기' }).closest('.pdf-tools-entry')!
    expect(entry.querySelector('.pdf-tools-body')?.textContent).toBe('numbers 옵션')
    expect(container.querySelectorAll('.pdf-tools-body')).toHaveLength(1)
  })
  it('keeps page edit as a plain row (it takes over the PDF pane instead of unfolding)', () => {
    render(<PdfToolsPanel docTitle="문서" activeTool="pageEdit" onPick={vi.fn()} renderTool={(tool) => (tool === 'pageEdit' ? null : <div />)} />)
    expect(screen.getByRole('button', { name: '쪽 편집' }).getAttribute('aria-current')).toBe('true')
    expect(document.querySelector('.pdf-tools-body')).toBeNull()
  })
  it('names the target document on its own line, not in the header', () => {
    const { container } = render(<PdfToolsPanel docTitle="IWAE 사용 설명서" activeTool={null} onPick={vi.fn()} />)
    expect(container.querySelector('.side-tools-head')?.textContent).toBe('PDF 도구')
    expect(container.querySelector('.pdf-tools-target')?.textContent).toBe('IWAE 사용 설명서')
  })
  it('gives every row a trailing slot, page edit included, so the rows line up', () => {
    const { container } = render(<PdfToolsPanel docTitle="문서" activeTool={null} onPick={vi.fn()} />)
    const rows = container.querySelectorAll('.pdf-tools-item')
    expect(rows.length).toBeGreaterThan(10)
    for (const row of rows) expect(row.querySelector('.pdf-tools-item-trail svg')).not.toBeNull()
  })
  it('disables the tools when no PDF is open', () => {
    render(<PdfToolsPanel docTitle={null} activeTool={null} onPick={vi.fn()} />)
    expect((screen.getByRole('button', { name: '쪽 편집' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('SearchScopeSwitch', () => {
  it('switches between this PDF and all documents', () => {
    const onChange = vi.fn()
    render(<SearchScopeSwitch scope="pdf" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: '이 문서' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '모든 문서' }))
    expect(onChange).toHaveBeenCalledWith('vault')
  })
})

describe('ThumbnailPanel viewport rectangle', () => {
  const doc: PdfDocMeta = { docId: 'abc', sha256: '0'.repeat(64), size: 1, title: 't', pageCount: 3, pageSizes: [[100, 200]], hasText: true }
  it('draws the visible part of the pages the active pane shows', () => {
    const { container } = render(<ThumbnailPanel activeDoc={doc} currentPage={0} viewportPane="p-test" />)
    expect(container.querySelector('.thumb-viewport')).toBeNull()
    act(() => publishPdfViewport('p-test', { docId: 'abc', regions: [{ page: 0, x: 0, y: 0.5, w: 1, h: 0.5 }, { page: 1, x: 0, y: 0, w: 1, h: 0.25 }] }))
    const rects = [...container.querySelectorAll<HTMLElement>('.thumb-viewport')]
    expect(rects).toHaveLength(2)
    expect(rects[0]!.style.top).toBe('50%')
    expect(rects[1]!.style.height).toBe('25%')
    // 다른 문서의 보기는 그리지 않는다
    act(() => publishPdfViewport('p-test', { docId: 'other', regions: [{ page: 0, x: 0, y: 0, w: 1, h: 1 }] }))
    expect(container.querySelector('.thumb-viewport')).toBeNull()
    act(() => publishPdfViewport('p-test', null))
  })
})
