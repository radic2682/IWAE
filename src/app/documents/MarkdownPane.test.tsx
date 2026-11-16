// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { dragInternally } from '../../test/internalDrag'
import { describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { MARKDOWN_EXCERPT_DRAG_MIME, parseMarkdownExcerptDrag } from '../../core/markdownExcerpt'
import { createPersistentMarkdownHighlight } from '../../core/markdownHighlight'
import { markdownSourceHash } from '../../core/markdownCapture'
import { imageExtensionOf, MarkdownPane } from './MarkdownPane'

describe('MarkdownPane: 텍스트·HTML·XML', () => {
  it('텍스트는 글자 그대로 그리고 # 줄도 제목이 되지 않는다', () => {
    const { container } = render(<MarkdownPane title="log" format="text" path="run.log" source={'# 주석 <b>x</b>\n\n  들여쓴 줄'} />)
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelectorAll('p.flow-text')).toHaveLength(2)
    expect(container.querySelector('.flow-notice')).toBeNull()
  })

  it('HTML 은 읽기용으로 거른 본문을 그린다', () => {
    const { container } = render(<MarkdownPane title="page" format="html" path="page.html" source={'<h1>제목</h1><script>alert(1)</script><p onclick="x()">글</p>'} />)
    expect(screen.getByRole('heading', { name: '제목' })).toBeDefined()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('p')?.getAttribute('onclick')).toBeNull()
  })

  it('XML 은 색칠한 원문으로 그리고, 깨진 XML 은 글자 그대로 보이며 한 줄로 알린다', () => {
    const view = render(<MarkdownPane title="data" format="xml" path="a.xml" source={'<a x="1"><b>글</b></a>'} />)
    expect(view.container.querySelector('pre.flow-xml .xml-attr')?.textContent).toBe('x')
    expect(view.container.querySelector('.flow-notice')).toBeNull()
    view.unmount()
    const broken = render(<MarkdownPane title="data" format="xml" path="b.xml" source={'<a><b></a>'} />)
    expect(broken.container.querySelector('.flow-notice')?.textContent).toBe('XML 형식이 올바르지 않아 글자 그대로 보여 줍니다.')
    expect(broken.container.querySelector('p.flow-text')?.textContent).toBe('<a><b></a>')
  })

  it('텍스트 글을 선택하면 노트로 끌 수 있다(형식과 상관없이 같은 길)', () => {
    render(<MarkdownPane title="memo" format="text" path="memo.txt" sourceFileId="id-1" source={'첫 문단\n\n선택할 글'} />)
    const paragraph = screen.getByText('선택할 글')
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)
    fireEvent.mouseUp(screen.getByRole('article', { name: 'memo' }))
    const serialized = dragInternally(screen.getByRole('button', { name: '선택 내용을 노트로 끌기' }))?.data[MARKDOWN_EXCERPT_DRAG_MIME] ?? ''
    expect(parseMarkdownExcerptDrag(serialized)).toMatchObject({ selection: { path: 'memo.txt', quote: '선택할 글', format: 'paragraph' } })
  })
})

const fsMock = vi.hoisted(() => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-fs', () => fsMock)

describe('MarkdownPane 그림 읽기', () => {
  it('보통 상대 그림만 읽고 UNC·뿌리 밖 경로는 읽지 않는다', async () => {
    fsMock.stat.mockResolvedValue({ size: 4 })
    fsMock.readFile.mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
    URL.createObjectURL = vi.fn(() => 'blob:x')
    const bs = String.fromCharCode(92)
    const source = ['<img src="ok-1.png">', `<img src="/${bs}${bs}host${bs}x.png">`, `<img src="${bs}${bs}host${bs}x.png">`, '<img src="../../../x.png">', `<img src="C:${bs}x.png">`].join(String.fromCharCode(10))
    const { container } = render(<MarkdownPane title="d" path="docs/a.md" vaultRoot="C:/Vault" source={source} />)
    await waitFor(() => expect(container.querySelector('img[src="blob:x"]')).not.toBeNull())
    expect(fsMock.readFile).toHaveBeenCalledTimes(1)
    expect(fsMock.readFile).toHaveBeenCalledWith('C:/Vault/docs/ok-1.png')
  })

  it('20MB 를 넘는 그림은 읽지 않는다', async () => {
    fsMock.readFile.mockClear()
    fsMock.stat.mockResolvedValue({ size: 21 * 1024 * 1024 })
    render(<MarkdownPane title="d" path="docs/b.md" vaultRoot="C:/Vault" source={'<img src="big-2.png">'} />)
    await waitFor(() => expect(fsMock.stat).toHaveBeenCalled())
    expect(fsMock.readFile).not.toHaveBeenCalled()
  })
})

describe('imageExtensionOf', () => {
  it('실제 확장자를 소문자로 돌려준다', () => {
    expect(imageExtensionOf('C:/a/b.PNG')).toBe('png')
    expect(imageExtensionOf('a/b.c/img.svg')).toBe('svg')
    expect(imageExtensionOf('a.b\\c')).toBe('')
    expect(imageExtensionOf('noext')).toBe('')
  })
})

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

  it('keeps a highlight after the file is edited or moved', () => {
    const selection = { path: 'old/guide.md', title: 'Guide', quote: '본문입니다.', prefix: '', suffix: '', startOffset: 7, endOffset: 13, format: 'paragraph' as const }
    const highlight = createPersistentMarkdownHighlight('stable-md-id', 'stale-hash', selection)
    render(
      <MarkdownPane
        sourceFileId="stable-md-id"
        path="new/guide.md"
        title="Guide"
        source={'새 줄\r\n\r\n## 중요한 제목\r\n\r\n본문입니다.\r\n'}
        persistentHighlights={[highlight]}
      />,
    )
    const marked = document.querySelector(`[data-markdown-highlight-id="${highlight.id}"]`)
    expect(marked?.textContent).toBe('본문입니다.')
  })

  it('relative PDF links open the document and unsupported links show a notice', () => {
    const onOpenDocument = vi.fn()
    const notices: string[] = []
    const listen = (event: Event) => notices.push((event as CustomEvent<string>).detail)
    window.addEventListener('iwae:action-feedback', listen)
    const { container } = render(<MarkdownPane title="a" path="docs/a.md" source={'[논문](paper.pdf) [밖](//host/x) [그림](pic.png)'} onOpenDocument={onOpenDocument} />)
    const links = container.querySelectorAll('a')
    fireEvent.click(links[0]!)
    expect(onOpenDocument).toHaveBeenCalledWith('docs/paper.pdf', null)
    fireEvent.click(links[1]!)
    fireEvent.click(links[2]!)
    window.removeEventListener('iwae:action-feedback', listen)
    expect(notices).toEqual(['열 수 없는 링크입니다', '열 수 없는 링크입니다'])
  })

  it('문서 안의 상대 링크는 같은 Vault 의 txt·html·xml·md 를 열고(#조각 포함), Vault 밖으로 나가는 링크는 거절한다', () => {
    const onOpenDocument = vi.fn()
    const notices: string[] = []
    const listen = (event: Event) => notices.push((event as CustomEvent<string>).detail)
    window.addEventListener('iwae:action-feedback', listen)
    const source = [
      '[a](notes.txt) [b](sub/page.html#top) [c](../data.xml) [d](other.MD#x) [e](../../escape.txt) [f](archive.zip)',
    ].join('')
    const { container } = render(<MarkdownPane title="a" path="docs/a.md" source={source} onOpenDocument={onOpenDocument} />)
    const links = [...container.querySelectorAll('a')]
    for (const link of links) fireEvent.click(link)
    window.removeEventListener('iwae:action-feedback', listen)
    expect(onOpenDocument.mock.calls).toEqual([
      ['docs/notes.txt', null],
      ['docs/sub/page.html', 'top'],
      ['data.xml', null],
      ['docs/other.MD', 'x'],
    ])
    expect(notices).toEqual(['열 수 없는 링크입니다', '열 수 없는 링크입니다'])
  })

  it('HTML 문서 안의 링크도 같은 길로 txt·xml 을 연다', () => {
    const onOpenDocument = vi.fn()
    const { container } = render(<MarkdownPane title="a" path="docs/a.html" source={'<p><a href="log.txt">로그</a> <a href="cfg.xml#n">설정</a></p>'} onOpenDocument={onOpenDocument} />)
    for (const link of container.querySelectorAll('a')) fireEvent.click(link)
    expect(onOpenDocument.mock.calls).toEqual([['docs/log.txt', null], ['docs/cfg.xml', 'n']])
  })
})

describe('MarkdownPane 검색어 반영', () => {
  it('처음 값은 바로, 바뀐 값은 150ms 뒤에 칠하고 비우면 바로 지운다', async () => {
    const view = render(<MarkdownPane title="s" source={'alpha beta alpha'} searchQuery="alpha" />)
    expect(view.container.querySelectorAll('mark.markdown-search-hit')).toHaveLength(2)
    view.rerender(<MarkdownPane title="s" source={'alpha beta alpha'} searchQuery="beta" />)
    expect(view.container.querySelectorAll('mark.markdown-search-hit')).toHaveLength(2)
    await waitFor(() => expect(view.container.querySelectorAll('mark.markdown-search-hit')).toHaveLength(1))
    view.rerender(<MarkdownPane title="s" source={'alpha beta alpha'} searchQuery="" />)
    await waitFor(() => expect(view.container.querySelectorAll('mark.markdown-search-hit')).toHaveLength(0))
  })
})

describe('MarkdownPane 막힌 그림 자리표시', () => {
  it('바깥 그림은 요청 없이 자리표시가 되고, 읽지 못한 로컬 그림도 같은 자리표시가 된다', async () => {
    fsMock.stat.mockRejectedValue(new Error('missing'))
    const { container } = render(<MarkdownPane title="p" path="docs/c.md" vaultRoot="C:/Vault" source={'<img src="https://tracker.example/p.png" alt="추적">\n\n<img src="gone-3.png" alt="없는 그림">'} />)
    await waitFor(() => expect(container.querySelectorAll('.md-image-blocked')).toHaveLength(2))
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('tracker.example')
    expect(container.querySelector('.md-image-blocked')?.getAttribute('data-label')).toBe('그림을 불러오지 않았습니다 · 추적')
  })
})

describe('MarkdownPane 저장된 형광펜 자리 검증', () => {
  const source = '첫 문단\n\n찾을 world 글'
  const quote = 'world'
  const selection = (startOffset: number) => ({ path: 'a.md', title: 'a', quote, prefix: '찾을 ', suffix: ' 글', startOffset, endOffset: startOffset + quote.length, format: 'paragraph' as const })

  it('해시가 같아도 자리가 밀렸으면 원래 글에 칠한다', () => {
    const hash = markdownSourceHash(source)
    const stale = createPersistentMarkdownHighlight('id-v', hash, selection(0))
    const { container } = render(<MarkdownPane title="a" path="a.md" sourceFileId="id-v" source={source} persistentHighlights={[stale]} />)
    const marked = container.querySelector(`[data-markdown-highlight-id="${stale.id}"]`)
    expect(marked?.textContent).toBe('world')
  })

  it('원문이 바뀌어(해시가 다르다) 인용문을 못 찾으면 칠하지 않는다', () => {
    const lost = createPersistentMarkdownHighlight('id-v', 'stale-hash', { ...selection(0), quote: '없는 글', prefix: '', suffix: '', endOffset: 4 })
    const { container } = render(<MarkdownPane title="a" path="a.md" sourceFileId="id-v" source={source} persistentHighlights={[lost]} />)
    expect(container.querySelector('[data-markdown-highlight-id]')).toBeNull()
  })

  it('자리가 맞으면 그 자리에 칠한다', () => {
    const hash = markdownSourceHash(source)
    const start = '첫 문단\n찾을 '.length
    const good = createPersistentMarkdownHighlight('id-v', hash, selection(start))
    const { container } = render(<MarkdownPane title="a" path="a.md" sourceFileId="id-v" source={source} persistentHighlights={[good]} />)
    expect(container.querySelector(`[data-markdown-highlight-id="${good.id}"]`)?.textContent).toBe('world')
  })
})

describe('MarkdownPane: 접힌 <details> 글이 든 옛 형광펜', () => {
  it('인용문에 접힌 글이 빠져 있어도(해시가 같다) 저장된 자리에 칠한다', () => {
    const source = '<details><summary>요약</summary>숨은 본문</details>\n\n끝 글'
    const hash = markdownSourceHash(source)
    const selection = { path: 'a.md', title: 'a', quote: '요약 끝 글', prefix: '', suffix: '', startOffset: 0, endOffset: 12, format: 'paragraph' as const }
    const highlight = createPersistentMarkdownHighlight('id-d', hash, selection)
    const { container } = render(<MarkdownPane title="a" path="a.md" sourceFileId="id-d" source={source} persistentHighlights={[highlight]} />)
    expect(container.querySelector(`[data-markdown-highlight-id="${highlight.id}"]`)).not.toBeNull()
  })
})

describe('MarkdownPane 자리표시 언어', () => {
  it('UI 언어를 바꾸면 막힌 그림 자리표시 문구도 바뀐다', async () => {
    const { act } = await import('@testing-library/react')
    const { getLocale, setLocale } = await import('../../i18n')
    const before = getLocale()
    try {
      act(() => setLocale('ko'))
      const { container } = render(<MarkdownPane title="p" path="a.md" source={'<img src="https://x.example/a.png" alt="그림">'} />)
      expect(container.querySelector('.md-image-blocked')?.getAttribute('data-label')).toBe('그림을 불러오지 않았습니다 · 그림')
      act(() => setLocale('en'))
      expect(container.querySelector('.md-image-blocked')?.getAttribute('data-label')).toBe('Image not loaded · 그림')
    } finally {
      act(() => setLocale(before))
    }
  })
})
