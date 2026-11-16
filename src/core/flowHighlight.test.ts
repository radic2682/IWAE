import { describe, expect, it } from 'vitest'
import { createPersistentPdfHighlight } from '../pdf/persistentHighlight'
import { createFlowHighlight, flowAnchor, verifiedFlowHighlights, type FlowAnchorParts } from './flowHighlight'

const rects = [{ x: 1, y: 2, w: 3, h: 4 }]

describe('flowAnchor', () => {
  it('쪽 0 의 종이 좌표 자리를 만들고 앞뒤 글은 비워 둔다', () => {
    expect(flowAnchor('docs/a.md', { rects, charRange: [3, 9], quote: '본문' })).toEqual({
      docId: 'docs/a.md',
      page: 0,
      coordSpace: 'pdfium-page',
      rects,
      charRange: [3, 9],
      quote: '본문',
      prefix: '',
      suffix: '',
    })
  })

  it('앞뒤 글을 주면 그대로 담고, 글 범위는 복사해 담는다', () => {
    const range = [1, 2] as const
    const anchor = flowAnchor('d', { rects, charRange: range, quote: 'q', prefix: 'p', suffix: 's' })
    expect(anchor.prefix).toBe('p')
    expect(anchor.suffix).toBe('s')
    expect(anchor.charRange).not.toBe(range)
  })
})

describe('createFlowHighlight', () => {
  it('손으로 지은 형광펜과 같은 모양이고, 만든 때·출처를 채운다', () => {
    const parts = { rects, charRange: [3, 9] as const, quote: '본문' }
    const made = createFlowHighlight('docs/a.md', parts, 'yellow')
    const manual = createPersistentPdfHighlight(flowAnchor('docs/a.md', parts), 'yellow', { createdAt: made.createdAt, source: 'iwae' })
    expect(made).toEqual(manual)
    expect(made.source).toBe('iwae')
    expect(Number.isNaN(Date.parse(made.createdAt ?? ''))).toBe(false)
    expect(made.id).toBe('docs/a.md:0:3:9')
  })

  it('영역 메모 같은 덧붙임을 받고, 직접 준 만든 때는 덮어쓰지 않는다', () => {
    const made = createFlowHighlight('d', { rects, charRange: [0, 5], quote: 'q' }, 'green', { kind: 'region', createdAt: '2026-01-01T00:00:00.000Z' })
    expect(made.kind).toBe('region')
    expect(made.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(made.id).toBe('d:0:region:1:2:3:4')
  })
})

describe('verifiedFlowHighlights', () => {
  const text = '메뉴 메뉴\nSee Important body and more'
  const make = (quote: string, start: number, extra: Partial<FlowAnchorParts> = {}, extras: { kind?: 'region' } = {}) => createFlowHighlight(
    'doc.md',
    { rects: [], charRange: [start, start + quote.length], quote, prefix: 'See ', suffix: ' body', ...extra },
    'yellow',
    extras,
  )

  it('자리의 글이 인용문과 맞으면 같은 목록을 그대로 돌려준다(다시 찾지 않는다)', () => {
    const ok = make('Important', text.indexOf('Important'))
    const list = [ok]
    expect(verifiedFlowHighlights(text, list)).toBe(list)
  })

  it('그리는 방식이 바뀌어 자리가 밀렸으면 인용문으로 새 자리를 찾아 넣는다(원본 객체는 그대로)', () => {
    const stale = make('Important', 4)
    const [moved] = verifiedFlowHighlights(text, [stale])
    expect(moved?.anchor.charRange).toEqual([text.indexOf('Important'), text.indexOf('Important') + 9])
    expect(moved?.id).toBe(stale.id)
    expect(stale.anchor.charRange).toEqual([4, 13])
  })

  it('인용문을 못 찾으면 목록에서 뺀다. 영역 메모와 인용문 없는 항목은 그대로 둔다', () => {
    const gone = make('사라진 글', 3, { prefix: '', suffix: '' })
    const region = make('', 0, {}, { kind: 'region' })
    const ok = make('Important', text.indexOf('Important'))
    expect(verifiedFlowHighlights(text, [gone, region, ok])).toEqual([region, ok])
  })

  it('공백·줄바꿈이 달라도 맞는 글로 본다', () => {
    const spaced = make('Important\nbody', text.indexOf('Important'), { prefix: '', suffix: '' })
    const wide = make('Important body', text.indexOf('Important'))
    const list = [wide]
    expect(verifiedFlowHighlights(text, list)).toBe(list)
    expect(verifiedFlowHighlights(text, [spaced])).toHaveLength(1)
  })
})
