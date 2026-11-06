import { describe, expect, it } from 'vitest'
import {
  addOverlay, createInk, inkPath, createLine, createTextBox, isMeaningfulLine, parsePdfOverlays, remapOverlayPages, removeOverlay, snapLineEnd, updateOverlay,
} from './pdfOverlays'

describe('PDF 덮개(글 상자·선)', () => {
  it('더하고 고치고 지운다. 문서의 마지막 덮개를 지우면 문서 항목도 사라진다', () => {
    const text = createTextBox(0, 10, 20, { text: '검토 필요' })
    const line = createLine(0, { x: 0, y: 0 }, { x: 50, y: 0 }, { arrow: true })
    let all = addOverlay(addOverlay({}, 'doc', text), 'doc', line)
    expect(all.doc).toHaveLength(2)
    all = updateOverlay(all, 'doc', text.id, { text: '고침', size: 18 })
    expect((all.doc![0] as { text: string }).text).toBe('고침')
    all = removeOverlay(all, 'doc', text.id)
    expect(removeOverlay(all, 'doc', 'none')).toBe(all)
    expect(removeOverlay(all, 'doc', line.id)).toEqual({})
  })

  it('선 그리기: 짧은 선은 만들지 않고, Shift 면 45° 단위로 맞춘다', () => {
    expect(isMeaningfulLine({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false)
    expect(isMeaningfulLine({ x: 0, y: 0 }, { x: 30, y: 0 })).toBe(true)
    const snapped = snapLineEnd({ x: 0, y: 0 }, { x: 100, y: 7 })
    expect(snapped.x).toBeCloseTo(100.2, 0)
    expect(snapped.y).toBeCloseTo(0, 5)
    const diagonal = snapLineEnd({ x: 0, y: 0 }, { x: 50, y: 44 })
    expect(Math.abs(diagonal.x - diagonal.y)).toBeLessThan(1e-6)
  })

  it('쪽을 옮기면 덮개도 같이 옮기고, 없어진 쪽의 덮개는 뺀다', () => {
    const a = createTextBox(0, 0, 0, { text: 'a' })
    const b = createTextBox(2, 0, 0, { text: 'b' })
    const all = addOverlay(addOverlay({}, 'doc', a), 'doc', b)
    const moved = remapOverlayPages(all, 'doc', new Map([[0, 3]]))
    expect(moved.doc!.map((item) => item.page)).toEqual([3])
    expect(remapOverlayPages(all, 'doc', new Map())).toEqual({})
  })

  it('저장 파일을 읽을 때 나쁜 항목은 버리고 값은 범위로 자른다', () => {
    const file = parsePdfOverlays({
      version: 1,
      overlays: {
        d: [
          { id: '1', kind: 'text', page: 0, x: 1, y: 2, w: 5, text: 'ok', size: 500, color: '#123456' },
          { id: '2', kind: 'line', page: 1, x1: 0, y1: 0, x2: 9, y2: 9, color: '#1a73e8', width: 99 },
          { id: '3', kind: 'text', page: -1, x: 1, y: 2, text: 'neg' },
          { id: '1', kind: 'text', page: 0, x: 1, y: 2, text: 'dup' },
          { id: '4', kind: 'blob' },
        ],
        e: 'nope',
      },
    })
    expect(Object.keys(file.overlays)).toEqual(['d'])
    const [text, line] = file.overlays.d!
    expect(text).toMatchObject({ w: 40, size: 96, color: '#d9363e' })
    expect(line).toMatchObject({ width: 20, color: '#1a73e8' })
    expect(file.overlays.d).toHaveLength(2)
  })
})

describe('펜 획', () => {
  it('가까운 점은 줄이고 끝점은 남기며, 저장했다 읽어도 같다', () => {
    const ink = createInk(2, [[0, 0], [0.2, 0.1], [5, 5], [5.3, 5.1]], { width: 3 })
    expect(ink.kind).toBe('ink')
    expect(ink.points).toEqual([[0, 0], [5, 5], [5.3, 5.1]])
    const parsed = parsePdfOverlays({ overlays: { d: [ink] } })
    expect(parsed.overlays.d?.[0]).toEqual(ink)
    expect(inkPath([[1, 2], [3, 4]])).toBe('M 1 2 L 3 4')
  })
  it('점이 없는 획은 버린다', () => {
    expect(parsePdfOverlays({ overlays: { d: [{ id: 'x', kind: 'ink', page: 0, points: [], color: '#111111', width: 2 }] } }).overlays.d).toBeUndefined()
  })
})
