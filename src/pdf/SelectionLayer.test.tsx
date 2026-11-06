// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Anchor } from '../core/anchor'
import type { PageTextIndex } from '../core/textIndex'
import type { PdfExcerptSelection } from '../core/pdfExcerpt'
import * as visualTextHeight from './visualTextHeight'
import { SelectionLayer, resizedRegion } from './SelectionLayer'

const INDEX: PageTextIndex = {
  text: 'AB\r\nCD',
  chars: [
    { c: 'A', x: 10, y: 10, w: 10, h: 10 },
    { c: 'B', x: 20, y: 10, w: 10, h: 10 },
    { c: '\r', x: 30, y: 10, w: 0, h: 0 },
    { c: '\n', x: 30, y: 10, w: 0, h: 0 },
    { c: 'C', x: 10, y: 30, w: 10, h: 10 },
    { c: 'D', x: 20, y: 30, w: 10, h: 10 },
  ],
}

function mount(options: {
  anchor?: Anchor
  persistentHighlights?: readonly { id: string; anchor: Anchor; color: 'yellow' | 'green' | 'blue' | 'pink' }[]
  passiveHighlights?: readonly { blockId: string; anchor: Anchor }[]
  searchHighlights?: readonly { id: string; rects: Anchor['rects']; active: boolean }[]
  mode?: 'hand' | 'text' | 'lasso' | 'highlight'
  highlightColor?: 'yellow' | 'green' | 'blue' | 'pink'
  onAnchorCreated?: (anchor: Anchor) => void
  onPersistentHighlightCreated?: (highlight: { id: string; anchor: Anchor }) => void
  onPersistentHighlightRemoved?: (highlightId: string) => void
  eraseHighlights?: boolean
  onSelectionChange?: (selection: PdfExcerptSelection | null) => void
  index?: PageTextIndex
  onPersistentHighlightActivate?: (highlightId: string, point: { x: number; y: number }) => void
} = {}) {
  return render(
    <SelectionLayer
      docId="0123456789ab"
      page={2}
      index={options.index ?? INDEX}
      renderScale={2}
      width={80}
      height={100}
      sourceTitle="HTTP Semantics Guide v1.1"
      pageSize={[612, 792]}
      anchor={options.anchor}
      persistentHighlights={options.persistentHighlights}
      passiveHighlights={options.passiveHighlights}
      searchHighlights={options.searchHighlights}
      mode={options.mode}
      highlightColor={options.highlightColor}
      onAnchorCreated={options.onAnchorCreated}
      onPersistentHighlightCreated={options.onPersistentHighlightCreated}
      onPersistentHighlightRemoved={options.onPersistentHighlightRemoved}
      eraseHighlights={options.eraseHighlights}
      onSelectionChange={options.onSelectionChange}
      onPersistentHighlightActivate={options.onPersistentHighlightActivate}
    />,
  )
}

describe('SelectionLayer', () => {
  it('형광펜 모드에서도 텍스트 범위를 긁는 I-beam 커서를 사용한다', () => {
    const view = mount({ mode: 'highlight' })
    expect(view.getByTestId('selection-layer').style.cursor).toBe('text')
  })

  it('영구 형광펜 지우개는 클릭한 항목만 제거한다', () => {
    const onPersistentHighlightRemoved = vi.fn()
    const highlight = {
      id: 'highlight-a',
      anchor: {
        docId: '0123456789ab', page: 2, coordSpace: 'pdfium-page' as const,
        rects: [{ x: 10, y: 10, w: 20, h: 10 }], charRange: [0, 2] as const,
        quote: 'AB', prefix: '', suffix: '\r\nCD',
      },
      color: 'yellow' as const,
    }
    const view = mount({
      mode: 'highlight',
      eraseHighlights: true,
      persistentHighlights: [highlight],
      onPersistentHighlightRemoved,
    })
    const layer = view.getByTestId('selection-layer')

    fireEvent.pointerDown(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })

    expect(onPersistentHighlightRemoved).toHaveBeenCalledWith('highlight-a')
  })

  it('형광펜 모드의 텍스트 드래그는 일반 앵커 대신 영구 형광펜을 생성한다', () => {
    const onAnchorCreated = vi.fn()
    const onPersistentHighlightCreated = vi.fn()
    const view = mount({ mode: 'highlight', highlightColor: 'pink', onAnchorCreated, onPersistentHighlightCreated })
    const layer = view.getByTestId('selection-layer')

    fireEvent.pointerDown(layer, { clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 58, clientY: 78, pointerId: 1 })
    fireEvent.pointerUp(layer, { clientX: 58, clientY: 78, pointerId: 1 })

    expect(onPersistentHighlightCreated).toHaveBeenCalledTimes(1)
    expect(onPersistentHighlightCreated.mock.calls[0]?.[0]).toMatchObject({
      id: expect.any(String),
      color: 'pink',
      anchor: {
        docId: '0123456789ab',
        page: 2,
        quote: 'AB\r\nCD',
        charRange: [0, 6],
      },
    })
    expect(onAnchorCreated).not.toHaveBeenCalled()
  })

  it('전달된 영구 형광펜은 현재 선택과 별도로 모두 렌더한다', () => {
    const first: Anchor = {
      docId: '0123456789ab', page: 2, coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 20, h: 10 }], charRange: [0, 2], quote: 'AB', prefix: '', suffix: '\r\nCD',
    }
    const second: Anchor = {
      ...first,
      rects: [{ x: 10, y: 30, w: 20, h: 10 }], charRange: [4, 6], quote: 'CD', prefix: 'AB\r\n', suffix: '',
    }
    const view = mount({
      persistentHighlights: [
        { id: 'highlight-a', anchor: first, color: 'green' },
        { id: 'highlight-b', anchor: second, color: 'blue' },
      ],
    })

    expect(view.container.querySelectorAll('.selection-persistent-highlight')).toHaveLength(2)
    expect(view.container.querySelector('[data-persistent-highlight="highlight-a"]')).not.toBeNull()
    expect(view.container.querySelector('[data-persistent-highlight="highlight-b"]')).not.toBeNull()
    expect(view.container.querySelector('[data-persistent-highlight="highlight-a"]')?.getAttribute('data-highlight-color')).toBe('green')
    expect(view.container.querySelector('[data-persistent-highlight="highlight-b"]')?.getAttribute('data-highlight-color')).toBe('blue')
  })

  it('드래그 중 선택 범위를 줄별 사각형으로 그리고 pointerup 에 앵커를 올린다', () => {
    const onAnchorCreated = vi.fn()
    const view = mount({ onAnchorCreated })
    const layer = view.getByTestId('selection-layer')

    fireEvent.pointerDown(layer, { clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 58, clientY: 78, pointerId: 1 })

    // 두 줄이지만 한 도형으로 칠한다(겹친 곳이 두 번 물들지 않게)
    const marks = view.container.querySelectorAll('.selection-highlight')
    expect(marks).toHaveLength(1)
    expect(marks[0]?.tagName.toLowerCase()).toBe('path')
    expect(marks[0]?.getAttribute('d')?.match(/Z/g)).toHaveLength(2)

    fireEvent.pointerUp(layer, { clientX: 58, clientY: 78, pointerId: 1 })
    expect(onAnchorCreated).toHaveBeenCalledTimes(1)
    expect(onAnchorCreated.mock.calls[0]?.[0]).toMatchObject({
      docId: '0123456789ab',
      page: 2,
      quote: 'AB\r\nCD',
      charRange: [0, 6],
    })
  })

  it('선택 영역 밖을 누르면 임시 선택과 작업 패널을 해제한다', () => {
    const onSelectionChange = vi.fn()
    const view = mount({ onSelectionChange })
    const layer = view.getByTestId('selection-layer')

    fireEvent.pointerDown(layer, { clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 58, clientY: 22, pointerId: 1 })
    fireEvent.pointerUp(layer, { clientX: 58, clientY: 22, pointerId: 1 })
    expect(view.queryByRole('toolbar', { name: 'PDF 선택 작업' })).not.toBeNull()

    fireEvent.pointerDown(document.body)

    expect(view.queryByRole('toolbar', { name: 'PDF 선택 작업' })).toBeNull()
    expect(onSelectionChange).toHaveBeenLastCalledWith(null)
  })

  it('저장된 앵커를 받으면 다시 마운트되어도 하이라이트를 복원한다', () => {
    const anchor: Anchor = {
      docId: '0123456789ab',
      page: 2,
      coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 20, h: 10 }],
      charRange: [0, 2],
      quote: 'AB',
      prefix: '',
      suffix: '\r\nCD',
    }
    const view = mount({ anchor })
    expect(view.container.querySelectorAll('.selection-highlight')).toHaveLength(1)
  })

  it('같은 페이지의 여러 블록 원문을 독립된 표시로 모두 렌더한다', () => {
    const first: Anchor = {
      docId: '0123456789ab',
      page: 2,
      coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 20, h: 10 }],
      charRange: [0, 2],
      quote: 'AB',
      prefix: '',
      suffix: '\r\nCD',
    }
    const second: Anchor = {
      ...first,
      rects: [{ x: 10, y: 30, w: 20, h: 10 }],
      charRange: [4, 6],
      quote: 'CD',
      prefix: 'AB\r\n',
      suffix: '',
    }
    const view = mount({
      passiveHighlights: [
        { blockId: 'block-a', anchor: first },
        { blockId: 'block-b', anchor: second },
      ],
    })

    expect(view.container.querySelectorAll('.source-highlight')).toHaveLength(2)
    expect(view.container.querySelector('[data-pdf-source-target="block-a"]')).not.toBeNull()
    expect(view.container.querySelector('[data-pdf-source-target="block-b"]')).not.toBeNull()
  })

  it('현재 선택을 해제해도 블록 원문 표시는 남는다', () => {
    const anchor: Anchor = {
      docId: '0123456789ab',
      page: 2,
      coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 20, h: 10 }],
      charRange: [0, 2],
      quote: 'AB',
      prefix: '',
      suffix: '\r\nCD',
    }
    const view = mount({ passiveHighlights: [{ blockId: 'block-a', anchor }] })
    const layer = view.getByTestId('selection-layer')

    fireEvent.pointerDown(layer, { clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerUp(layer, { clientX: 58, clientY: 78, pointerId: 1 })
    fireEvent.pointerDown(layer, { clientX: 76, clientY: 96, pointerId: 2 })
    fireEvent.pointerUp(layer, { clientX: 76, clientY: 96, pointerId: 2 })

    expect(view.container.querySelector('.selection-highlight')).toBeNull()
    expect(view.container.querySelector('[data-pdf-source-target="block-a"]')).not.toBeNull()
  })

  it('검색 강조와 출처 강조를 서로 다른 레이어로 동시에 그린다', () => {
    const anchor: Anchor = {
      docId: '0123456789ab',
      page: 2,
      coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 20, h: 10 }],
      charRange: [0, 2],
      quote: 'AB',
      prefix: '',
      suffix: '\r\nCD',
    }
    const view = mount({
      passiveHighlights: [{ blockId: 'block-a', anchor }],
      searchHighlights: [{ id: 'match-a', rects: [{ x: 10, y: 30, w: 20, h: 10 }], active: true }],
    })
    expect(view.container.querySelectorAll('.selection-source-highlight')).toHaveLength(1)
    expect(view.container.querySelectorAll('.selection-search-highlight')).toHaveLength(1)
    expect(view.container.querySelector('.selection-search-highlight-active')).not.toBeNull()
  })

  it('검색·형광펜 마크 레이어를 텍스트 선택 레이어보다 먼저 렌더한다', () => {
    const anchor: Anchor = {
      docId: '0123456789ab', page: 2, coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 20, h: 10 }], charRange: [0, 2], quote: 'AB', prefix: '', suffix: '\r\nCD',
    }
    const view = mount({
      persistentHighlights: [{ id: 'highlight-a', anchor, color: 'yellow' }],
      searchHighlights: [{ id: 'match-a', rects: anchor.rects, active: false }],
    })
    const marks = view.container.querySelector('.selection-mark-layer')
    const selection = view.getByTestId('selection-layer')
    if (marks === null) throw new Error('마크 레이어가 없다')

    expect(marks.querySelector('.selection-search-highlight')).not.toBeNull()
    expect(marks.querySelector('.selection-persistent-highlight')).not.toBeNull()
    expect(marks.compareDocumentPosition(selection) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(selection.classList.contains('selection-interaction-layer')).toBe(true)
  })

  it('드래그 선택 마크도 텍스트 상호작용 레이어 뒤에 렌더한다', () => {
    const view = mount()
    const interaction = view.getByTestId('selection-layer')

    fireEvent.pointerDown(interaction, { clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerMove(interaction, { clientX: 58, clientY: 78, pointerId: 1 })

    const marks = view.container.querySelector('.selection-mark-layer')
    expect(marks?.querySelectorAll('.selection-highlight')).toHaveLength(1)
    expect(interaction.querySelector('.selection-highlight')).toBeNull()
  })

  it('Alt 드래그는 이번 마일스톤에서 선택하지 않는다', () => {
    const onAnchorCreated = vi.fn()
    const view = mount({ onAnchorCreated })
    const layer = view.getByTestId('selection-layer')

    fireEvent.pointerDown(layer, { clientX: 22, clientY: 22, pointerId: 1, altKey: true })
    fireEvent.pointerMove(layer, { clientX: 58, clientY: 78, pointerId: 1, altKey: true })
    fireEvent.pointerUp(layer, { clientX: 58, clientY: 78, pointerId: 1, altKey: true })

    expect(view.container.querySelectorAll('.selection-highlight')).toHaveLength(0)
    expect(onAnchorCreated).not.toHaveBeenCalled()
  })

  it('페이지 밖으로 나가도 pointerup 을 받도록 드래그 포인터를 캡처한다', () => {
    const view = mount()
    const layer = view.getByTestId('selection-layer')
    const capture = vi.fn()
    const release = vi.fn()
    Object.defineProperty(layer, 'setPointerCapture', { value: capture })
    Object.defineProperty(layer, 'releasePointerCapture', { value: release })

    fireEvent.pointerDown(layer, { clientX: 22, clientY: 22, pointerId: 7 })
    expect(capture).toHaveBeenCalledWith(7)

    fireEvent.pointerUp(layer, { clientX: 58, clientY: 78, pointerId: 7 })
    expect(release).toHaveBeenCalledWith(7)
  })

  it('우클릭만 하면 기본 컨텍스트 메뉴를 허용한다', () => {
    const view = mount()
    const layer = view.getByTestId('selection-layer')

    fireEvent.pointerDown(layer, { button: 2, buttons: 2, clientX: 18, clientY: 24, pointerId: 4 })
    fireEvent.pointerUp(layer, { button: 2, clientX: 18, clientY: 24, pointerId: 4 })

    expect(fireEvent.contextMenu(layer)).toBe(true)
  })

  it('우클릭 끌기는 고르지 않는다(앱의 마우스 제스처 몫)', () => {
    const onSelectionChange = vi.fn()
    const view = mount({ onSelectionChange })
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { button: 2, buttons: 2, clientX: 18, clientY: 24, pointerId: 4 })
    fireEvent.pointerMove(layer, { button: 2, buttons: 2, clientX: 62, clientY: 84, pointerId: 4 })
    fireEvent.pointerUp(layer, { button: 2, clientX: 62, clientY: 84, pointerId: 4 })
    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(view.container.querySelector('.selection-region')).toBeNull()
  })

  it('올가미 모드의 좌클릭 드래그는 사각형 영역을 선택한다', () => {
    const onSelectionChange = vi.fn()
    const view = mount({ mode: 'lasso', onSelectionChange })
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { button: 0, buttons: 1, clientX: 18, clientY: 24, pointerId: 5 })
    fireEvent.pointerMove(layer, { button: 0, buttons: 1, clientX: 62, clientY: 84, pointerId: 5 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 62, clientY: 84, pointerId: 5 })
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'region' }))
  })

  it('글 모드에서도 Ctrl+끌기는 표·그림 영역을 고른다', () => {
    const onSelectionChange = vi.fn()
    const view = mount({ mode: 'text', onSelectionChange })
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { button: 0, buttons: 1, ctrlKey: true, clientX: 18, clientY: 24, pointerId: 6 })
    fireEvent.pointerMove(layer, { button: 0, buttons: 1, ctrlKey: true, clientX: 62, clientY: 84, pointerId: 6 })
    fireEvent.pointerUp(layer, { button: 0, ctrlKey: true, clientX: 62, clientY: 84, pointerId: 6 })
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'region' }))
  })

  it('텍스트 레이어가 없는 PDF도 영역 선택 후 추정한 글줄 높이를 전달한다', () => {
    const estimate = vi.spyOn(visualTextHeight, 'estimateSelectionTextHeight').mockReturnValue(9)
    try {
      const onSelectionChange = vi.fn()
      const view = mount({ index: { text: '', chars: [] }, onSelectionChange })
      const layer = view.getByTestId('selection-layer')
      expect(layer.style.cursor).toBe('crosshair')
      fireEvent.pointerDown(layer, { button: 0, clientX: 18, clientY: 24, pointerId: 5 })
      fireEvent.pointerUp(layer, { button: 0, clientX: 62, clientY: 84, pointerId: 5 })
      expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({
        mode: 'region', visualTextHeight: 9,
      }))
    } finally {
      estimate.mockRestore()
    }
  })

  it('고른 자리에 노트로 끄는 손잡이를 두지 않는다(고르면 바로 노트에 들어간다)', () => {
    const view = mount()
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerUp(layer, { clientX: 58, clientY: 78, pointerId: 1 })
    expect(view.container.querySelector('.selection-highlight')).not.toBeNull()
    expect(view.container.querySelector('.selection-drag-target')).toBeNull()
  })

  it('손을 뗀 선택이 같은 자리의 형광펜으로 칠해지면 선택 색을 겹쳐 칠하지 않는다', () => {
    const onSelectionChange = vi.fn()
    const view = mount({ onSelectionChange })
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerUp(layer, { clientX: 58, clientY: 78, pointerId: 1 })
    const selection = onSelectionChange.mock.calls.at(-1)?.[0] as PdfExcerptSelection
    expect(view.container.querySelector('.selection-highlight')).not.toBeNull()
    view.rerender(
      <SelectionLayer
        docId="0123456789ab"
        page={2}
        index={INDEX}
        renderScale={2}
        width={80}
        height={100}
        sourceTitle="HTTP Semantics Guide v1.1"
        pageSize={[612, 792]}
        onSelectionChange={onSelectionChange}
        persistentHighlights={[{ id: 'draft', docId: '0123456789ab', anchor: selection.anchor, color: 'yellow', kind: 'text', createdAt: '' } as never]}
      />,
    )
    expect(view.container.querySelector('.selection-highlight')).toBeNull()
    expect(view.container.querySelector('[data-persistent-highlight="draft"]')).not.toBeNull()
  })

  it('선택 밖의 빈 영역을 클릭하면 현재 선택을 해제한다', () => {
    const onSelectionChange = vi.fn()
    const view = mount({ onSelectionChange })
    const layer = view.getByTestId('selection-layer')

    fireEvent.pointerDown(layer, { clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerUp(layer, { clientX: 58, clientY: 78, pointerId: 1 })
    expect(view.container.querySelector('.selection-highlight')).not.toBeNull()

    fireEvent.pointerDown(layer, { clientX: 76, clientY: 96, pointerId: 2 })
    fireEvent.pointerUp(layer, { clientX: 76, clientY: 96, pointerId: 2 })

    expect(onSelectionChange).toHaveBeenLastCalledWith(null)
    expect(view.container.querySelector('.selection-highlight')).toBeNull()
  })

  it('외부에서 새 원문 위치가 오면 사용자가 지운 선택 대신 새 강조를 표시한다', () => {
    const first: Anchor = {
      docId: '0123456789ab',
      page: 2,
      coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 10, w: 20, h: 10 }],
      charRange: [0, 2],
      quote: 'AB',
      prefix: '',
      suffix: '\r\nCD',
    }
    const second: Anchor = {
      ...first,
      rects: [{ x: 10, y: 30, w: 20, h: 10 }],
      charRange: [4, 6],
      quote: 'CD',
      prefix: 'AB\r\n',
      suffix: '',
    }
    const view = mount({ anchor: first })
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { clientX: 76, clientY: 96, pointerId: 2 })
    fireEvent.pointerUp(layer, { clientX: 76, clientY: 96, pointerId: 2 })
    expect(view.container.querySelector('.selection-highlight')).toBeNull()

    view.rerender(
      <SelectionLayer
        docId="0123456789ab"
        page={2}
        index={INDEX}
        renderScale={2}
        width={80}
        height={100}
        sourceTitle="HTTP Semantics Guide v1.1"
        pageSize={[612, 792]}
        anchor={second}
      />,
    )

    expect(view.container.querySelector('.selection-highlight')).not.toBeNull()
  })
})

describe('SelectionLayer — 형광펜 열기', () => {
  const highlight = {
    id: 'highlight-a',
    anchor: {
      docId: '0123456789ab', page: 2, coordSpace: 'pdfium-page' as const,
      rects: [{ x: 10, y: 10, w: 20, h: 10 }], charRange: [0, 2] as const,
      quote: 'AB', prefix: '', suffix: '\r\nCD',
    },
    color: 'yellow' as const,
  }

  it('텍스트 모드에서 형광펜을 클릭하면 그 형광펜을 연다', () => {
    const onPersistentHighlightActivate = vi.fn()
    const view = mount({ mode: 'text', persistentHighlights: [highlight], onPersistentHighlightActivate })
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
    expect(onPersistentHighlightActivate).toHaveBeenCalledWith('highlight-a', { x: 30, y: 30 })
  })

  it('형광펜이 없는 자리를 클릭하거나 끌어서 고르면 열지 않는다', () => {
    const onPersistentHighlightActivate = vi.fn()
    const view = mount({ mode: 'text', persistentHighlights: [highlight], onPersistentHighlightActivate })
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { button: 0, clientX: 150, clientY: 190, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 150, clientY: 190, pointerId: 1 })
    fireEvent.pointerDown(layer, { button: 0, clientX: 22, clientY: 22, pointerId: 2 })
    fireEvent.pointerMove(layer, { clientX: 58, clientY: 78, pointerId: 2 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 58, clientY: 78, pointerId: 2 })
    expect(onPersistentHighlightActivate).not.toHaveBeenCalled()
  })

  it('형광펜 위에서 눌러 끌면 메모를 열지 않고 글자를 고른다', () => {
    const onPersistentHighlightActivate = vi.fn()
    const onSelectionChange = vi.fn()
    const view = mount({ mode: 'text', persistentHighlights: [highlight], onPersistentHighlightActivate, onSelectionChange })
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 58, clientY: 78, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 58, clientY: 78, pointerId: 1 })
    expect(onPersistentHighlightActivate).not.toHaveBeenCalled()
    expect(onSelectionChange).toHaveBeenLastCalledWith(expect.objectContaining({ anchor: expect.objectContaining({ charRange: [0, 6] }) }))
  })

  it('새 형광펜에 만든 시각과 출처를 적는다', () => {
    const onPersistentHighlightCreated = vi.fn()
    const view = mount({ mode: 'highlight', onPersistentHighlightCreated })
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 58, clientY: 78, pointerId: 1 })
    fireEvent.pointerUp(layer, { clientX: 58, clientY: 78, pointerId: 1 })
    expect(onPersistentHighlightCreated).toHaveBeenCalledWith(expect.objectContaining({
      source: 'iwae',
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    }))
  })
})

describe('SelectionLayer — 형광펜 깜빡임', () => {
  it('주석 패널에서 고른 형광펜에만 깜빡임 표시를 붙인다', () => {
    const make = (id: string, x: number) => ({
      id,
      color: 'yellow' as const,
      anchor: {
        docId: '0123456789ab', page: 2, coordSpace: 'pdfium-page' as const,
        rects: [{ x, y: 10, w: 10, h: 10 }], charRange: [0, 1] as const, quote: 'A', prefix: '', suffix: '',
      },
    })
    const view = render(
      <SelectionLayer
        docId="0123456789ab" page={2} index={INDEX} renderScale={2} width={80} height={100}
        sourceTitle="t" pageSize={[612, 792]}
        persistentHighlights={[make('a', 10), make('b', 40)]}
        flashHighlightId="b"
      />,
    )
    expect(view.container.querySelector('[data-persistent-highlight="b"]')?.classList.contains('selection-highlight-flash')).toBe(true)
    expect(view.container.querySelector('[data-persistent-highlight="a"]')?.classList.contains('selection-highlight-flash')).toBe(false)
  })
})

describe('SelectionLayer — 손 도구·Ctrl+C', () => {
  it('손 도구: 글자 없는 곳을 누르면 고르지 않고 화면 옮기기로 넘긴다(기본 동작을 막지 않는다)', () => {
    const onAnchorCreated = vi.fn()
    const view = mount({ mode: 'hand', onAnchorCreated })
    const layer = view.getByTestId('selection-layer')
    const down = fireEvent.pointerDown(layer, { button: 0, clientX: 150, clientY: 180, pointerId: 1 })
    expect(down).toBe(true)
    fireEvent.pointerMove(layer, { clientX: 150, clientY: 120, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 150, clientY: 120, pointerId: 1 })
    expect(onAnchorCreated).not.toHaveBeenCalled()
    expect(view.queryByRole('toolbar', { name: 'PDF 선택 작업' })).toBeNull()
    expect(layer.style.cursor).toBe('grab')
  })

  it('손 도구: 글자 위에서 끌면 텍스트 도구처럼 글을 고른다', () => {
    const onAnchorCreated = vi.fn()
    const view = mount({ mode: 'hand', onAnchorCreated })
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerMove(layer, { clientX: 22, clientY: 22 })
    expect(layer.style.cursor).toBe('text')
    fireEvent.pointerDown(layer, { button: 0, clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 58, clientY: 22, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 58, clientY: 22, pointerId: 1 })
    expect(onAnchorCreated).toHaveBeenCalledWith(expect.objectContaining({ quote: 'AB' }))
    expect(view.queryByRole('toolbar', { name: 'PDF 선택 작업' })).not.toBeNull()
  })

  it('고른 글이 있으면 다른 칸에 포커스가 있어도 Ctrl+C 로 그 글을 복사한다', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const view = mount()
    const layer = view.getByTestId('selection-layer')
    fireEvent.pointerDown(layer, { button: 0, clientX: 22, clientY: 22, pointerId: 1 })
    fireEvent.pointerMove(layer, { clientX: 58, clientY: 22, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 58, clientY: 22, pointerId: 1 })
    // 메모 칸처럼 글을 쓰는 칸이 포커스를 가져가 있다(그 칸 안에서 고른 글은 없다)
    const editor = document.createElement('div')
    editor.contentEditable = 'true'
    document.body.append(editor)
    editor.focus()
    fireEvent.keyDown(editor, { key: 'c', ctrlKey: true })
    expect(writeText).toHaveBeenCalledWith('AB')
    editor.remove()
  })
})

describe('resizedRegion', () => {
  const start = { x: 100, y: 100, w: 50, h: 40 }
  const edges = (value: Partial<Record<'left' | 'right' | 'top' | 'bottom', boolean>>) => ({ left: false, right: false, top: false, bottom: false, ...value })
  it('잡은 변만 옮긴다', () => {
    expect(resizedRegion(start, edges({ right: true, bottom: true }), 10, 20, [600, 800])).toEqual({ x: 100, y: 100, w: 60, h: 60 })
    expect(resizedRegion(start, edges({ left: true }), -30, 99, [600, 800])).toEqual({ x: 70, y: 100, w: 80, h: 40 })
  })
  it('쪽 밖으로 나가거나 뒤집히지 않는다', () => {
    expect(resizedRegion(start, edges({ left: true }), 500, 0, [600, 800]).w).toBe(8)
    expect(resizedRegion(start, edges({ top: true }), -500, 0, [600, 800]).y).toBe(100)
    expect(resizedRegion(start, edges({ top: true }), 0, -500, [600, 800]).y).toBe(0)
  })
})
