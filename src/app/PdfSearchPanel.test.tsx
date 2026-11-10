// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PdfSearchMatch, PdfSearchOptions } from '../core/pdfSearch'
import type { UsePdfSearchResult } from './usePdfSearch'
import { PdfSearchPanel } from './PdfSearchPanel'

const matches: readonly PdfSearchMatch[] = [
  {
    id: 'doc:1:10:16',
    docId: 'doc',
    page: 1,
    start: 10,
    end: 16,
    quote: 'needle',
    before: 'first before ',
    after: ' first after',
    rects: [{ x: 72, y: 100, w: 36, h: 12 }],
  },
  {
    id: 'doc:5:40:46',
    docId: 'doc',
    page: 5,
    start: 40,
    end: 46,
    quote: 'needle',
    before: 'second before ',
    after: ' second after',
    rects: [{ x: 72, y: 200, w: 36, h: 12 }],
  },
]

function searchResult(overrides: Partial<UsePdfSearchResult> = {}): UsePdfSearchResult {
  return {
    status: 'searching',
    matches,
    activeIndex: 1,
    progress: { completed: 3, total: 10 },
    next: vi.fn(),
    previous: vi.fn(),
    select: vi.fn(),
    cancel: vi.fn(),
    recentQueries: ['HTTP', 'JSON'],
    ...overrides,
  }
}

const options: PdfSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
}

describe('PdfSearchPanel', () => {
  it('호버하면 펼쳐지고 돋보기를 누르면 펼친 상태를 고정한다', () => {
    const onQueryChange = vi.fn()
    const { container } = render(
      <PdfSearchPanel
        query=""
        onQueryChange={onQueryChange}
        search={searchResult({ matches: [], activeIndex: -1 })}
        options={options}
        onOptionsChange={vi.fn()}
        onSelectMatch={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'PDF 검색' })
    const expansion = container.querySelector('.pdf-floating-control-expansion')
    expect(trigger.textContent).toBe('')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(expansion).not.toBeNull()
    expect(expansion?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('searchbox', { name: 'PDF 검색' })).toBeNull()

    fireEvent.mouseEnter(container.querySelector('.pdf-search-floating-tool')!)
    const field = screen.getByRole('searchbox', { name: 'PDF 검색' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    fireEvent.mouseLeave(container.querySelector('.pdf-search-floating-tool')!)
    expect(screen.queryByRole('searchbox', { name: 'PDF 검색' })).toBeNull()

    fireEvent.click(trigger)
    const pinnedField = screen.getByRole('searchbox', { name: 'PDF 검색' })
    expect(document.activeElement).toBe(pinnedField)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(expansion?.getAttribute('aria-hidden')).toBe('false')

    fireEvent.mouseLeave(container.querySelector('.pdf-search-floating-tool')!)
    expect(screen.getByRole('searchbox', { name: 'PDF 검색' })).toBe(pinnedField)
  })

  it('전역 검색 요청을 받으면 검색 필드를 펼치고 포커스한다', async () => {
    render(
      <PdfSearchPanel
        query=""
        onQueryChange={vi.fn()}
        search={searchResult({ matches: [], activeIndex: -1 })}
        options={options}
        onOptionsChange={vi.fn()}
        onSelectMatch={vi.fn()}
      />,
    )

    fireEvent(window, new Event('iwae:pdf-search'))

    const field = await screen.findByRole('searchbox', { name: 'PDF 검색' })
    expect(document.activeElement).toBe(field)
  })

  it('고른 글자와 함께 Ctrl+F 가 오면 그 글자로 검색어를 바꾼다', () => {
    const onQueryChange = vi.fn()
    render(
      <PdfSearchPanel
        query=""
        onQueryChange={onQueryChange}
        search={searchResult({ matches: [], activeIndex: -1 })}
        options={options}
        onOptionsChange={vi.fn()}
        onSelectMatch={vi.fn()}
      />,
    )
    fireEvent(window, new CustomEvent('iwae:pdf-search', { detail: { query: 'Recovery Interface' } }))
    expect(onQueryChange).toHaveBeenCalledWith('Recovery Interface')
  })

  it('검색 필드 안에 현재/전체 결과와 대소문자·완전한 단어 토글을 둔다', () => {
    const onOptionsChange = vi.fn()
    render(
      <PdfSearchPanel
        query="needle"
        onQueryChange={vi.fn()}
        search={searchResult()}
        options={options}
        onOptionsChange={onOptionsChange}
        onSelectMatch={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'PDF 검색' }))
    expect(screen.getByLabelText('검색 결과 위치').textContent).toBe('2/2')
    const caseToggle = screen.getByRole('button', { name: '대소문자 구분' })
    const wordToggle = screen.getByRole('button', { name: '완전한 단어' })
    expect(caseToggle.closest('.pdf-search-field')).not.toBeNull()
    expect(wordToggle.closest('.pdf-search-field')).not.toBeNull()
    fireEvent.click(caseToggle)
    expect(onOptionsChange).toHaveBeenLastCalledWith({ caseSensitive: true, wholeWord: false })
  })

  it('바깥을 눌러도 결과를 닫지 않는다 — 결과를 눌러 가며 본문을 오가야 한다', () => {
    const onQueryChange = vi.fn()
    render(
      <div>
        <PdfSearchPanel
          query="needle"
          onQueryChange={onQueryChange}
          search={searchResult()}
          options={options}
          onOptionsChange={vi.fn()}
          onSelectMatch={vi.fn()}
        />
        <button type="button">바깥</button>
      </div>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'PDF 검색' }))
    expect(screen.getByRole('region', { name: 'PDF 검색 결과' }).classList.contains('pdf-search-panel-compact')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '최근 검색어 HTTP' }))
    expect(onQueryChange).toHaveBeenCalledWith('HTTP')

    fireEvent.pointerDown(screen.getByRole('button', { name: '바깥' }))
    expect(screen.queryByRole('region', { name: 'PDF 검색 결과' })).not.toBeNull()
    const field = screen.getByRole('searchbox', { name: 'PDF 검색' }) as HTMLInputElement
    expect(field.value).toBe('needle')
    expect(screen.getByLabelText('검색 결과 위치').textContent).toBe('2/2')
    expect(screen.getByRole('button', { name: 'PDF 검색' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('현재 결과·전체 결과·진행률과 페이지별 문맥을 표시한다', () => {
    const { container } = render(
      <PdfSearchPanel
        search={searchResult()}
        options={options}
        onOptionsChange={vi.fn()}
        onSelectMatch={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('검색 결과 위치').textContent).toBe('2/2')
    expect(screen.getByLabelText('PDF 검색 진행률').textContent).toBe('3 / 10 페이지')
    expect(screen.getByRole('button', { name: '2페이지 needle' })).toBeDefined()
    expect(screen.getByRole('button', { name: '6페이지 needle' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getAllByText('needle')).toHaveLength(2)
    expect(container.querySelector('.pdf-search-panel')).not.toBeNull()
    expect(container.querySelectorAll('.pdf-search-result-row')).toHaveLength(2)
    expect(container.querySelectorAll('.pdf-search-result-snippet')[0]?.textContent)
      .toBe('first before needle first after')
    expect(container.querySelectorAll('.pdf-search-result-snippet')[1]?.textContent)
      .toBe('second before needle second after')
  })

  it('대소문자와 완전한 단어 옵션 변경을 알린다', () => {
    const onOptionsChange = vi.fn()
    render(
      <PdfSearchPanel
        search={searchResult()}
        options={options}
        onOptionsChange={onOptionsChange}
        onSelectMatch={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '대소문자 구분' }))
    expect(onOptionsChange).toHaveBeenLastCalledWith({
      caseSensitive: true,
      wholeWord: false,
    })

    fireEvent.click(screen.getByRole('button', { name: '완전한 단어' }))
    expect(onOptionsChange).toHaveBeenLastCalledWith({
      caseSensitive: false,
      wholeWord: true,
    })
  })

  it('결과 행을 선택하면 훅 인덱스와 선택 콜백을 함께 갱신한다', () => {
    const search = searchResult({ activeIndex: 0 })
    const onSelectMatch = vi.fn()
    render(
      <PdfSearchPanel
        search={search}
        options={options}
        onOptionsChange={vi.fn()}
        onSelectMatch={onSelectMatch}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '6페이지 needle' }))

    expect(search.select).toHaveBeenCalledWith(1)
    expect(onSelectMatch).toHaveBeenCalledWith(matches[1])
  })

  it('완료 후 결과가 없거나 검색이 실패하면 상태를 명확히 표시한다', () => {
    const { rerender } = render(
      <PdfSearchPanel
        search={searchResult({ status: 'complete', matches: [], activeIndex: -1 })}
        options={options}
        onOptionsChange={vi.fn()}
        onSelectMatch={vi.fn()}
      />,
    )
    expect(screen.getByText('검색 결과가 없습니다')).toBeDefined()

    rerender(
      <PdfSearchPanel
        search={searchResult({ status: 'error', matches: [], activeIndex: -1 })}
        options={options}
        onOptionsChange={vi.fn()}
        onSelectMatch={vi.fn()}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe('PDF 검색 중 오류가 발생했습니다')
  })

  it('왼쪽 결과 줄을 누른 뒤 Enter·↓ 는 다음, Shift+Enter·↑ 는 앞 결과로 가고, 줄마다 쪽 미리보기를 보인다', () => {
    const select = vi.fn()
    const onSelectMatch = vi.fn()
    const { container } = render(
      <PdfSearchPanel
        docked
        query="needle"
        onQueryChange={vi.fn()}
        search={searchResult({ status: 'complete', activeIndex: 0, select })}
        options={options}
        onOptionsChange={vi.fn()}
        onSelectMatch={onSelectMatch}
        pageSizes={Array.from({ length: 10 }, () => [612, 792] as const)}
      />,
    )
    const rows = container.querySelectorAll<HTMLElement>('.pdf-search-result-row')
    expect(rows).toHaveLength(2)
    expect(container.querySelectorAll('.pdf-search-thumb')).toHaveLength(2)
    expect(container.querySelector('.pdf-search-thumb-hit')).not.toBeNull()
    fireEvent.keyDown(rows[0]!, { key: 'Enter' })
    expect(select).toHaveBeenLastCalledWith(1)
    expect(onSelectMatch).toHaveBeenLastCalledWith(matches[1])
    fireEvent.keyDown(rows[0]!, { key: 'Enter', shiftKey: true })
    expect(select).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' })
    expect(select).toHaveBeenLastCalledWith(1)
  })

  it('결과가 아주 많아도 줄은 한 번에 150개까지만 그리고, 「더 보기」로 늘린다', () => {
    const many: PdfSearchMatch[] = Array.from({ length: 70000 }, (_, index) => ({
      ...matches[0]!,
      id: `doc:${index}`,
      page: Math.floor(index / 20),
    }))
    const { container } = render(
      <PdfSearchPanel
        docked
        query="needle"
        onQueryChange={vi.fn()}
        search={searchResult({ status: 'complete', matches: many, activeIndex: 0 })}
        options={options}
        onOptionsChange={vi.fn()}
        onSelectMatch={vi.fn()}
      />,
    )
    expect(container.querySelectorAll('.pdf-search-result-row')).toHaveLength(150)
    expect(screen.getByText('70000건 · 3500쪽')).toBeTruthy()
    expect(container.querySelector('.pdf-search-group-meta')?.textContent).toBe('1–3500쪽 · 70000')
    fireEvent.click(screen.getByRole('button', { name: /더 보기/u }))
    expect(container.querySelectorAll('.pdf-search-result-row')).toHaveLength(300)
  })

  it('지금 결과가 그린 줄 밖이면 그 줄까지 그린다', () => {
    const many: PdfSearchMatch[] = Array.from({ length: 1000 }, (_, index) => ({ ...matches[0]!, id: `doc:${index}`, page: index }))
    const { container } = render(
      <PdfSearchPanel
        docked
        query="needle"
        onQueryChange={vi.fn()}
        search={searchResult({ status: 'complete', matches: many, activeIndex: 600 })}
        options={options}
        onOptionsChange={vi.fn()}
        onSelectMatch={vi.fn()}
      />,
    )
    expect(container.querySelector('[aria-current="true"]')).not.toBeNull()
    expect(container.querySelectorAll('.pdf-search-result-row').length).toBeLessThan(1000)
  })

  it('왼쪽 바 검색칸은 검색어가 없을 때 위치(0/0)를 감추고, 있으면 보인다', () => {
    const props = { docked: true, onQueryChange: vi.fn(), search: searchResult({ matches: [], activeIndex: -1 }), options, onOptionsChange: vi.fn(), onSelectMatch: vi.fn() }
    const { rerender } = render(<PdfSearchPanel {...props} query="" />)
    expect(screen.queryByLabelText('검색 결과 위치')).toBeNull()
    expect(screen.getByRole('button', { name: '대소문자 구분' })).toBeDefined()
    rerender(<PdfSearchPanel {...props} query="needle" />)
    expect(screen.getByLabelText('검색 결과 위치').textContent).toBe('0/0')
  })
})
