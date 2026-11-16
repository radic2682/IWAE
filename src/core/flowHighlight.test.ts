import { describe, expect, it } from 'vitest'
import { createPersistentPdfHighlight } from '../pdf/persistentHighlight'
import { createFlowHighlight, flowAnchor } from './flowHighlight'

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
