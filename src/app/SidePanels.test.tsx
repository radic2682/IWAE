// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OutlinePanel, limitOutlineDepth, outlinePageGroups } from './SidePanels'
import type { PdfDocMeta } from '../bridge/pdf'
import { createPdfBookmark } from '../core/pdfBookmarks'

const pdfOutline = vi.fn()

vi.mock('../bridge/pdf', () => ({
  pageImageUrl: () => '/page.png',
  pdfOutline: (...args: unknown[]) => pdfOutline(...args),
}))

const activeDoc: PdfDocMeta = {
  docId: '0123456789ab',
  sha256: '0'.repeat(64),
  size: 1024,
  title: 'HTTP Guide',
  pageCount: 12,
  pageSizes: [[612, 792]],
  hasText: true,
}

describe('OutlinePanel', () => {
  it('PDF 북마크를 계층과 페이지 번호로 보여주고 선택한 페이지로 이동한다', async () => {
    pdfOutline.mockResolvedValue([
      { title: 'Introduction', page: 0, depth: 0 },
      { title: 'Dynamic Address Assignment', page: 4, depth: 1 },
    ])
    const onSelectPage = vi.fn()

    const { container } = render(
      <OutlinePanel activeDoc={activeDoc} onSelectPage={onSelectPage} />,
    )

    // 처음에는 접혀 있어 하위 항목이 보이지 않는다
    await screen.findByRole('button', { name: 'Introduction 1쪽' })
    expect(screen.queryByRole('button', { name: 'Dynamic Address Assignment 5쪽' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Introduction 펼치기' }))
    const nested = screen.getByRole('button', { name: 'Dynamic Address Assignment 5쪽' })
    expect(nested.closest('.outline-row')?.getAttribute('style')).toContain('--outline-depth: 1')

    fireEvent.click(nested)
    expect(onSelectPage).toHaveBeenCalledWith(4)
    expect(container.querySelectorAll('.outline-item')).toHaveLength(2)
  })

  it('지금 보는 쪽의 항목을 칠하고, 접힌 가지 안이면 보이는 조상을 칠한다', async () => {
    pdfOutline.mockResolvedValue([
      { title: 'Introduction', page: 0, depth: 0 },
      { title: 'Dynamic Address Assignment', page: 4, depth: 1 },
      { title: 'Timing', page: 9, depth: 0 },
    ])
    render(<OutlinePanel activeDoc={activeDoc} currentPage={6} />)

    const parent = await screen.findByRole('button', { name: 'Introduction 1쪽' })
    expect(parent.getAttribute('aria-current')).toBe('location')

    fireEvent.click(screen.getByRole('button', { name: 'Introduction 펼치기' }))
    expect(screen.getByRole('button', { name: 'Dynamic Address Assignment 5쪽' }).getAttribute('aria-current')).toBe('location')
    expect(parent.getAttribute('aria-current')).toBeNull()
  })

  it('목차가 없는 PDF는 빈 상태를 명확히 보여준다', async () => {
    pdfOutline.mockResolvedValue([])
    render(<OutlinePanel activeDoc={activeDoc} />)

    await waitFor(() => {
      expect(screen.getByText('이 PDF에는 목차가 없습니다')).toBeDefined()
    })
  })

  it('목차 아래 별도 구역에 현재 문서 책갈피를 보여준다', async () => {
    pdfOutline.mockResolvedValue([{ title: 'Introduction', page: 0, depth: 0 }])
    const onSelectPage = vi.fn()
    const bookmark = createPdfBookmark(activeDoc.docId, 6, '검토 위치')
    render(<OutlinePanel activeDoc={activeDoc} bookmarks={[bookmark]} onSelectPage={onSelectPage} />)

    await screen.findByRole('heading', { name: '책갈피' })
    fireEvent.click(screen.getByRole('button', { name: '검토 위치 7쪽' }))
    expect(onSelectPage).toHaveBeenCalledWith(6)
  })

  it('문서 범위를 벗어난 책갈피는 남겨 두되 이동을 막고 삭제할 수 있다', async () => {
    pdfOutline.mockResolvedValue([])
    const onSelectPage = vi.fn()
    const onRemoveBookmark = vi.fn()
    const bookmark = createPdfBookmark(activeDoc.docId, 998, '오래된 위치')
    render(
      <OutlinePanel
        activeDoc={activeDoc}
        bookmarks={[bookmark]}
        onSelectPage={onSelectPage}
        onRemoveBookmark={onRemoveBookmark}
      />,
    )

    const open = await screen.findByRole('button', { name: '오래된 위치 열기' })
    expect(open.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('범위 밖')).toBeDefined()
    fireEvent.click(open)
    expect(onSelectPage).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '오래된 위치 책갈피 삭제' }))
    expect(onRemoveBookmark).toHaveBeenCalledWith(bookmark)
  })
})

describe('목차 + 미리보기 묶기', () => {
  const entries = [
    { title: '1 Intro', page: 2, depth: 0 },
    { title: '1.1 Scope', page: 2, depth: 1 },
    { title: '1.1.1 Terms', page: 3, depth: 2 },
    { title: '1.1.1.1 Too deep', page: 4, depth: 3 },
    { title: '2 Bus', page: 6, depth: 0 },
  ]

  it('목차는 세 단계(깊이 2)까지만 남긴다', () => {
    expect(limitOutlineDepth(entries).map((entry) => entry.title)).toEqual(['1 Intro', '1.1 Scope', '1.1.1 Terms', '2 Bus'])
  })

  it('시작 쪽으로 쪽을 묶고, 같은 쪽에서 시작하는 제목은 한 묶음에 모은다', () => {
    const groups = outlinePageGroups(limitOutlineDepth(entries), 8)
    expect(groups.map((group) => [group.startPage, group.endPage, group.headings.map((heading) => heading.entry.title)])).toEqual([
      [0, 1, []],
      [2, 2, ['1 Intro', '1.1 Scope']],
      [3, 5, ['1.1.1 Terms']],
      [6, 7, ['2 Bus']],
    ])
  })
})
