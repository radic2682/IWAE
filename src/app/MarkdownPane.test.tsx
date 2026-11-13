// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { dragInternally } from '../test/internalDrag'
import { describe, expect, it, vi } from 'vitest'
import { MARKDOWN_EXCERPT_DRAG_MIME, parseMarkdownExcerptDrag } from '../core/markdownExcerpt'
import { createPersistentMarkdownHighlight } from '../core/markdownHighlight'
import { MarkdownPane } from './MarkdownPane'

describe('MarkdownPane', () => {
  it('검색어를 렌더링된 Markdown 글자 뒤에서 모두 강조하고 결과 수를 표시한다', () => {
    const { container } = render(
      <MarkdownPane title="Guide" source={'# Search\n\nsearch result and SEARCH again'} searchQuery="search" />,
    )

    expect(container.querySelectorAll('mark.markdown-search-hit')).toHaveLength(3)
    expect(screen.getByLabelText('Markdown 검색 결과').textContent).toBe('3개 결과')
    expect(screen.getByRole('heading', { name: 'Search' })).toBeDefined()
  })

  it('Markdown을 편집기 없이 읽기 문서로 렌더링한다', () => {
    const { container } = render(<MarkdownPane title="README" source={'# 안내\n\n읽기 전용입니다.'} />)

    expect(screen.getByRole('article', { name: 'README' })).toBeDefined()
    expect(screen.getByRole('heading', { name: '안내' })).toBeDefined()
    expect(screen.getByText('읽기 전용입니다.')).toBeDefined()
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('원문 HTML 중 위험한 것(스크립트·이벤트 속성)은 넣지 않고, 안전한 것(표·그림 크기)은 살린다', () => {
    const { container } = render(<MarkdownPane title="Unsafe" source={'<script>alert(1)</script>\n\n<b onclick="x()">굵게</b>'} />)

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')?.textContent).toBe('굵게')
    expect(container.querySelector('b')?.getAttribute('onclick')).toBeNull()
  })

  it('선택한 Markdown의 위치와 제목 형식을 노트 드래그 payload로 만든다', () => {
    render(<MarkdownPane sourceFileId="stable-md-id" path="docs/guide.md" title="Guide" source={'## 중요한 제목\n\n본문입니다.'} />)
    const heading = screen.getByRole('heading', { name: '중요한 제목' })
    const range = document.createRange()
    range.selectNodeContents(heading)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.mouseUp(screen.getByRole('article', { name: 'Guide' }))

    const action = screen.getByRole('button', { name: '선택 내용을 노트로 끌기' })
    const serialized = dragInternally(action)?.data[MARKDOWN_EXCERPT_DRAG_MIME] ?? ''
    const payload = parseMarkdownExcerptDrag(serialized)
    expect(payload).toMatchObject({
      selection: {
        path: 'docs/guide.md',
        title: 'Guide',
        quote: '중요한 제목',
        format: 'heading-2',
      },
      capture: { sourceFileId: 'stable-md-id' },
    })
    if (payload?.capture === undefined) throw new Error('Markdown 캡처 payload가 없습니다.')
    expect(payload.capture.renderedSnapshot).toContain('<h2')
    expect((payload.capture as unknown as { editable?: boolean }).editable).toBeUndefined()
  })

  it('문서 밖을 누르면 Markdown 선택 작업을 해제한다', () => {
    render(<MarkdownPane title="Guide" source={'# 제목\n\n본문'} />)
    const heading = screen.getByRole('heading', { name: '제목' })
    const range = document.createRange()
    range.selectNodeContents(heading)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseUp(screen.getByRole('article', { name: 'Guide' }))
    expect(screen.queryByRole('button', { name: '선택 내용을 노트로 끌기' })).not.toBeNull()

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('button', { name: '선택 내용을 노트로 끌기' })).toBeNull()
    expect(window.getSelection()?.isCollapsed).toBe(true)
  })

  it('영역 캡처 모드에서 닿은 Markdown 블록을 시각 캡처 payload로 만든다', () => {
    const { container } = render(
      <MarkdownPane
        interactionMode="lasso"
        sourceFileId="stable-md-id"
        path="docs/guide.md"
        title="Guide"
        source={'## 제목\n\n본문입니다.'}
      />,
    )
    const host = container.querySelector('.markdown-pane-host') as HTMLElement
    const article = screen.getByRole('article', { name: 'Guide' })
    const heading = screen.getByRole('heading', { name: '제목' })
    const paragraph = screen.getByText('본문입니다.')
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600, x: 0, y: 0, toJSON: () => ({}) })
    vi.spyOn(article, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600, x: 0, y: 0, toJSON: () => ({}) })
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 20, right: 220, bottom: 60, width: 200, height: 40, x: 20, y: 20, toJSON: () => ({}) })
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 80, right: 260, bottom: 120, width: 240, height: 40, x: 20, y: 80, toJSON: () => ({}) })

    fireEvent.pointerDown(host, { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 280, clientY: 130 })
    fireEvent.pointerUp(window, { clientX: 280, clientY: 130 })

    const action = screen.getByRole('button', { name: '선택 내용을 노트로 끌기' })
    const serialized = dragInternally(action)?.data[MARKDOWN_EXCERPT_DRAG_MIME] ?? ''
    const payload = parseMarkdownExcerptDrag(serialized)
    expect(payload?.selection.quote).toContain('제목')
    expect(payload?.selection.quote).toContain('본문입니다.')
    expect(payload?.capture?.renderedSnapshot).toContain('<h2')
    expect(payload?.capture?.renderedSnapshot).toContain('<p')
  })

  it('선택한 Markdown 번역 결과를 보여주고 원문 캡처와 함께 노트로 보낸다', async () => {
    const onTranslateSelection = vi.fn().mockResolvedValue({
      text: 'Translated heading',
      targetLanguage: 'en',
      model: 'translategemma:4b',
    })
    const onSendTranslatedSelection = vi.fn()
    render(
      <MarkdownPane
        sourceFileId="stable-md-id"
        path="docs/guide.md"
        title="Guide"
        source={'## 중요한 제목\n\n본문입니다.'}
        onTranslateSelection={onTranslateSelection}
        onSendTranslatedSelection={onSendTranslatedSelection}
      />,
    )
    const heading = screen.getByRole('heading', { name: '중요한 제목' })
    const range = document.createRange()
    range.selectNodeContents(heading)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseUp(screen.getByRole('article', { name: 'Guide' }))

    fireEvent.click(screen.getByRole('button', { name: '번역' }))

    expect((await screen.findByLabelText('Markdown 번역 결과')).textContent).toContain('Translated heading')
    fireEvent.click(screen.getByRole('button', { name: '노트에 넣기' }))
    expect(onTranslateSelection).toHaveBeenCalledWith('중요한 제목')
    expect(onSendTranslatedSelection).toHaveBeenCalledWith(
      expect.objectContaining({ selection: expect.objectContaining({ quote: '중요한 제목' }) }),
      expect.objectContaining({ text: 'Translated heading' }),
    )
  })

  it('형광펜 모드에서 선택 범위를 영구 형광펜으로 만들고 클릭하여 삭제한다', () => {
    const onPersistentHighlightCreated = vi.fn()
    const onPersistentHighlightRemoved = vi.fn()
    const { rerender } = render(
      <MarkdownPane
        interactionMode="highlight"
        sourceFileId="stable-md-id"
        path="docs/guide.md"
        title="Guide"
        source={'## 중요한 제목\n\n본문입니다.'}
        onPersistentHighlightCreated={onPersistentHighlightCreated}
        onPersistentHighlightRemoved={onPersistentHighlightRemoved}
      />,
    )
    const heading = screen.getByRole('heading', { name: '중요한 제목' })
    const range = document.createRange()
    range.selectNodeContents(heading)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseUp(screen.getByRole('article', { name: 'Guide' }))
    expect(onPersistentHighlightCreated).toHaveBeenCalledWith(expect.objectContaining({
      sourceFileId: 'stable-md-id',
      selection: expect.objectContaining({ quote: '중요한 제목' }),
    }))

    const created = onPersistentHighlightCreated.mock.calls.at(0)?.at(0)
    if (created === undefined) throw new Error('Markdown 형광펜이 생성되지 않았습니다.')
    const highlight = createPersistentMarkdownHighlight(
      'stable-md-id',
      created.sourceHash,
      created.selection,
    )
    rerender(
      <MarkdownPane
        interactionMode="highlight"
        sourceFileId="stable-md-id"
        path="docs/guide.md"
        title="Guide"
        source={'## 중요한 제목\n\n본문입니다.'}
        persistentHighlights={[highlight]}
        onPersistentHighlightCreated={onPersistentHighlightCreated}
        onPersistentHighlightRemoved={onPersistentHighlightRemoved}
      />,
    )
    const marked = document.querySelector(`[data-markdown-highlight-id="${highlight.id}"]`)
    expect(marked).not.toBeNull()
    fireEvent.click(marked as Element)
    fireEvent.click(screen.getByRole('button', { name: '형광펜 삭제' }))
    expect(onPersistentHighlightRemoved).toHaveBeenCalledWith(highlight.id)
  })
})
