// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PaneToolbar } from './PaneToolbar'
import { PdfBottomBar } from './PdfBottomBar'

describe('PaneToolbar', () => {
  it('형광펜은 도구줄 단추: 누르면 형광펜 모드, 그동안 색 넷과 지우개가 펼쳐진다(PDF·Markdown 같다)', () => {
    for (const kind of ['pdf', 'markdown'] as const) {
      const onModeChange = vi.fn()
      const { rerender, unmount } = render(<PaneToolbar kind={kind} mode="text" onModeChange={onModeChange} />)
      expect(screen.queryByRole('button', { name: '형광펜 지우개' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '형광펜' }))
      expect(onModeChange).toHaveBeenLastCalledWith('highlight')
      rerender(<PaneToolbar kind={kind} mode="highlight" onModeChange={onModeChange} />)
      expect(screen.getByRole('button', { name: '형광펜' }).getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(screen.getByRole('button', { name: '초록 형광펜' }))
      expect(screen.getByRole('button', { name: '초록 형광펜' }).getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(screen.getByRole('button', { name: '형광펜 지우개' }))
      expect(screen.getByRole('button', { name: '형광펜 지우개' }).getAttribute('aria-pressed')).toBe('true')
      fireEvent.click(screen.getByRole('button', { name: '형광펜 지우개' }))
      unmount()
    }
  })

  it('Markdown 도 깨끗이 보기(눈 단추)를 PDF 와 같이 쓴다', () => {
    const onCleanViewChange = vi.fn()
    render(<PaneToolbar kind="markdown" mode="text" onModeChange={vi.fn()} cleanView={false} onCleanViewChange={onCleanViewChange} />)
    fireEvent.click(screen.getByRole('button', { name: '표시 모두 감추기' }))
    expect(onCleanViewChange).toHaveBeenCalledWith(true)
  })

  it('편집 도구를 누르면 그 도구로 편집 모드, 다시 누르면 텍스트로. 쪽 편집 단추는 따로', () => {
    const onModeChange = vi.fn()
    const onEditPages = vi.fn()
    const { rerender } = render(<PaneToolbar kind="pdf" mode="text" onModeChange={onModeChange} onEditPages={onEditPages} />)
    fireEvent.click(screen.getByRole('button', { name: '펜' }))
    expect(onModeChange).toHaveBeenLastCalledWith('edit')
    rerender(<PaneToolbar kind="pdf" mode="edit" onModeChange={onModeChange} onEditPages={onEditPages} />)
    expect(screen.getByRole('button', { name: '펜' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '선' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '펜' }))
    expect(onModeChange).toHaveBeenLastCalledWith('text')
    fireEvent.click(screen.getByRole('button', { name: '쪽 편집' }))
    expect(onEditPages).toHaveBeenCalledTimes(1)
  })

  it('문서 전체 화면 버튼은 없다(지웠다)', () => {
    render(<PaneToolbar kind="pdf" mode="text" onModeChange={vi.fn()} fullscreen={false} onToggleFullscreen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '문서 전체 화면' })).toBeNull()
  })

  it('Markdown 검색 입력을 확장하고 검색어를 전달한다', () => {
    const onQueryChange = vi.fn()
    render(
      <PaneToolbar
        kind="markdown"
        mode="text"
        onModeChange={vi.fn()}
        query=""
        onQueryChange={onQueryChange}
      />,
    )

    fireEvent.mouseEnter(screen.getByRole('button', { name: '검색' }).parentElement!)
    fireEvent.change(screen.getByRole('searchbox', { name: '문서 검색' }), { target: { value: 'anchor' } })
    expect(onQueryChange).toHaveBeenCalledWith('anchor')
  })

  it('검색·형광펜과 중복되지 않는 손 도구·텍스트 선택·올가미 모드만 보여준다(손 도구는 T 왼쪽)', () => {
    const { container } = render(<PaneToolbar kind="pdf" mode="text" onModeChange={vi.fn()} />)

    expect(screen.queryByRole('searchbox', { name: 'PDF 검색' })).toBeNull()
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['손 도구', '텍스트 선택', '영역 캡처', '형광펜', '박스 메모', '글 상자', '펜', '선', '지우개'])
    expect(screen.getByRole('button', { name: '텍스트 선택' }).textContent).toBe('')
    expect(screen.getByRole('button', { name: '영역 캡처' }).textContent).toBe('')
    expect(container.querySelector('.pdf-mode-toggle-row')).not.toBeNull()
  })

  it('박스 메모 도구를 누르면 box 모드로, 다시 누르면 text 로 돌아온다', () => {
    const onModeChange = vi.fn()
    const { rerender } = render(<PaneToolbar kind="pdf" mode="text" onModeChange={onModeChange} />)
    fireEvent.click(screen.getByRole('button', { name: '박스 메모' }))
    expect(onModeChange).toHaveBeenLastCalledWith('box')
    rerender(<PaneToolbar kind="pdf" mode="box" onModeChange={onModeChange} />)
    expect(screen.getByRole('button', { name: '박스 메모' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '박스 메모' }))
    expect(onModeChange).toHaveBeenLastCalledWith('text')
  })

  it('손 도구를 누르면 hand 모드로 바꾸고, 그 모드면 손 도구가 눌린 모양이다', () => {
    const onModeChange = vi.fn()
    const { rerender } = render(<PaneToolbar kind="pdf" mode="text" onModeChange={onModeChange} />)
    fireEvent.click(screen.getByRole('button', { name: '손 도구' }))
    expect(onModeChange).toHaveBeenCalledWith('hand')
    rerender(<PaneToolbar kind="pdf" mode="hand" onModeChange={onModeChange} />)
    expect(screen.getByRole('button', { name: '손 도구' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '텍스트 선택' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('도구 모드 전환을 위로 전달한다', () => {
    const onModeChange = vi.fn()
    render(<PaneToolbar kind="pdf" mode="text" onModeChange={onModeChange} />)

    fireEvent.click(screen.getByRole('button', { name: '영역 캡처' }))
    expect(onModeChange).toHaveBeenCalledWith('lasso')
  })

  it('Markdown 읽기 화면에도 같은 텍스트 선택·영역 캡처 도구를 제공한다', () => {
    render(<PaneToolbar kind="markdown" mode="text" onModeChange={vi.fn()} />)

    expect(screen.getAllByRole('toolbar', { name: '문서 읽기 도구' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '텍스트 선택' })).toBeDefined()
    expect(screen.getByRole('button', { name: '영역 캡처' })).toBeDefined()
    // PDF 와 같은 손 도구·박스 메모·편집
    for (const name of ['손 도구', '박스 메모', '글 상자', '펜', '지우개', '선']) expect(screen.getByRole('button', { name })).toBeDefined()
  })

  it('PDF 하단 조작을 하나의 오버레이 표면으로 묶는다', () => {
    const { container } = render(
      <PdfBottomBar
        zoomPercent={100}
        page={1}
        pageCount={12}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomChange={vi.fn()}
        onPageChange={vi.fn()}
        onFitWidth={vi.fn()}
        onFitPage={vi.fn()}
      />,
    )

    const surface = container.querySelector('.pdf-bottom-bar-surface')
    expect(surface).not.toBeNull()
    expect(surface?.children).toHaveLength(2)
  })

  it('막대가 넘치면 덜 쓰는 단추부터 「…」 메뉴로 옮기고, 메뉴에서 그대로 쓴다', () => {
    // jsdom 에는 배치가 없으니 언제나 넘치는 막대(내용 600 > 칸 300)로 만든다
    const widths = { scrollWidth: 600, clientWidth: 300 } as const
    for (const [key, value] of Object.entries(widths)) {
      Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value })
    }
    try {
      const onPageChange = vi.fn()
      render(
        <PdfBottomBar
          zoomPercent={100} page={5} pageCount={12}
          onZoomIn={vi.fn()} onZoomOut={vi.fn()} onZoomChange={vi.fn()} onPageChange={onPageChange}
          onFitWidth={vi.fn()} onFitPage={vi.fn()}
        />,
      )
      expect(screen.queryByRole('button', { name: '첫 페이지' })).toBeNull()
      // 쪽 번호·배율은 늘 막대에 남는다
      expect(screen.getByRole('textbox', { name: '페이지' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '확대' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: '더 보기' }))
      fireEvent.click(screen.getByRole('menuitem', { name: /첫 페이지/ }))
      expect(onPageChange).toHaveBeenCalledWith(1)
      expect(screen.queryByRole('menu', { name: '접어 둔 단추' })).toBeNull()
    } finally {
      for (const key of Object.keys(widths)) Reflect.deleteProperty(HTMLElement.prototype, key)
    }
  })

  it('뒤로·앞으로 버튼은 갈 곳이 있을 때만 눌린다', () => {
    const onBack = vi.fn()
    const onForward = vi.fn()
    render(
      <PdfBottomBar
        zoomPercent={100}
        page={3}
        pageCount={12}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomChange={vi.fn()}
        onPageChange={vi.fn()}
        onFitWidth={vi.fn()}
        onFitPage={vi.fn()}
        canGoBack
        canGoForward={false}
        onBack={onBack}
        onForward={onForward}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }))
    expect(onBack).toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '앞으로' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
