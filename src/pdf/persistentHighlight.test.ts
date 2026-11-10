import { describe, expect, it } from 'vitest'
import type { Anchor } from '../core/anchor'
import {
  createPersistentPdfHighlight,
  parsePersistentPdfHighlights,
  persistentPdfHighlightFile,
  removePersistentPdfHighlight,
  updatePersistentPdfHighlight,
} from './persistentHighlight'

const anchor: Anchor = {
  docId: '0123456789ab',
  page: 1,
  coordSpace: 'pdfium-page',
  rects: [{ x: 10, y: 20, w: 80, h: 12 }],
  charRange: [5, 12],
  quote: 'persist',
  prefix: '',
  suffix: '',
}

describe('persistentHighlight', () => {
  it('선택한 형광펜 색상을 파일에 저장하고 복원한다', () => {
    const highlight = createPersistentPdfHighlight(anchor, 'pink')
    expect(highlight.color).toBe('pink')
    expect(parsePersistentPdfHighlights(persistentPdfHighlightFile([highlight]))).toEqual([highlight])
  })

  it('기존 색상 없는 v1 항목은 노란색으로 호환한다', () => {
    const legacy = createPersistentPdfHighlight(anchor)
    const parsed = parsePersistentPdfHighlights({
      version: 1,
      highlights: [{ id: legacy.id, anchor }],
    })
    expect(parsed[0]?.color).toBe('yellow')
  })

  it('목록에 없는 색(지웠거나 다른 PC 에서 만든 색)의 id 도 파일에 그대로 남는다', () => {
    const highlight = createPersistentPdfHighlight(anchor, 'c_gone42')
    expect(parsePersistentPdfHighlights(persistentPdfHighlightFile([highlight]))[0]?.color).toBe('c_gone42')
  })

  it('식별자로 영구 형광펜 하나만 제거한다', () => {
    const first = createPersistentPdfHighlight(anchor)
    const second = createPersistentPdfHighlight({ ...anchor, charRange: [20, 30], quote: 'second' }, 'blue')

    expect(removePersistentPdfHighlight([first, second], first.id)).toEqual([second])
  })
})

describe('persistentHighlight — 메모와 출처', () => {
  it('메모·만든 시각·출처를 저장하고 복원한다', () => {
    const highlight = createPersistentPdfHighlight(anchor, 'green', { note: '핵심 정의', createdAt: '2026-10-02T00:00:00.000Z', source: 'imported' })
    const restored = parsePersistentPdfHighlights(persistentPdfHighlightFile([highlight]))
    expect(restored[0]).toMatchObject({ color: 'green', note: '핵심 정의', createdAt: '2026-10-02T00:00:00.000Z', source: 'imported' })
  })

  it('쪽을 옮겨 앵커와 id 의 쪽이 달라져도 파일을 읽는다', () => {
    const highlight = createPersistentPdfHighlight({ ...anchor, page: 5 })
    const moved = { ...highlight, anchor: { ...highlight.anchor, page: 2 } }
    const restored = parsePersistentPdfHighlights({ version: 1, highlights: [moved, createPersistentPdfHighlight(anchor)] })
    expect(restored.map(({ id }) => id)).toEqual([highlight.id, createPersistentPdfHighlight(anchor).id])
    expect(restored[0]?.anchor.page).toBe(2)
  })

  it('메모가 없던 예전 항목도 그대로 읽는다', () => {
    const restored = parsePersistentPdfHighlights({ version: 1, highlights: [createPersistentPdfHighlight(anchor)] })
    expect(restored[0]?.note).toBeUndefined()
  })

  it('잘못된 메모·출처 값은 버리고 항목은 살린다', () => {
    const highlight = { ...createPersistentPdfHighlight(anchor), note: 42, source: 'evil', createdAt: 7 }
    const restored = parsePersistentPdfHighlights({ version: 1, highlights: [highlight] })
    expect(restored).toHaveLength(1)
    expect(restored[0]).not.toHaveProperty('note')
    expect(restored[0]).not.toHaveProperty('source')
  })

  it('색과 메모를 고치고, 4,000자를 넘는 메모는 자른다', () => {
    const highlight = createPersistentPdfHighlight(anchor)
    expect(updatePersistentPdfHighlight(highlight, { color: 'pink' })).toMatchObject({ id: highlight.id, color: 'pink' })
    expect(updatePersistentPdfHighlight(highlight, { note: 'x'.repeat(5000) }).note).toHaveLength(4000)
    expect(updatePersistentPdfHighlight(highlight, { note: '   ' })).not.toHaveProperty('note')
  })
})

describe('persistentHighlight — Markdown 영역 메모의 모습', () => {
  it('영역 메모의 모습(HTML·자리)은 저장했다 읽어도, 메모를 고쳐도 남는다', async () => {
    const { createPersistentPdfHighlight, parsePersistentPdfHighlights, persistentPdfHighlightFile, updatePersistentPdfHighlight } = await import('./persistentHighlight')
    const anchor: Anchor = { docId: 'a.md', page: 0, coordSpace: 'pdfium-page', rects: [{ x: 50, y: 400, w: 300, h: 140 }], charRange: [10, 80], quote: '표', prefix: '', suffix: '' }
    const snapshot = { html: '<table><tr><td>칸</td></tr></table>', top: 410, left: 120, width: 700 }
    const made = createPersistentPdfHighlight(anchor, 'yellow', { kind: 'region', snapshot })
    expect(made.snapshot).toEqual(snapshot)
    const [read] = parsePersistentPdfHighlights(JSON.parse(JSON.stringify(persistentPdfHighlightFile([made]))))
    expect(read?.snapshot).toEqual(snapshot)
    expect(updatePersistentPdfHighlight(made, { note: '설명' }).snapshot).toEqual(snapshot)
    // 글자 메모에는 붙지 않는다
    expect(createPersistentPdfHighlight(anchor, 'yellow', { snapshot }).snapshot).toBeUndefined()
  })
})
