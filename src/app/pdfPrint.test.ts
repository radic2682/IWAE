// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { paperSizeMm, resolveOrientation } from './pdfPrint'

describe('인쇄 용지', () => {
  it('자동 방향은 쪽 모양을 따른다', () => {
    expect(resolveOrientation('auto', [842, 595])).toBe('landscape')
    expect(resolveOrientation('auto', [595, 842])).toBe('portrait')
    expect(resolveOrientation('auto', undefined)).toBe('portrait')
    expect(resolveOrientation('portrait', [842, 595])).toBe('portrait')
  })
  it('가로면 용지 폭·높이를 바꾼다', () => {
    expect(paperSizeMm('A4', 'portrait')).toEqual([210, 297])
    expect(paperSizeMm('A4', 'landscape')).toEqual([297, 210])
  })
})

import { printedPageWithOverlays } from './pdfPrint'
import { createLine, createTextBox } from '../core/pdfOverlays'

describe('인쇄에 PDF 위 편집 넣기', () => {
  it('그림 크기에 맞춘 상자 위에 글 상자·선을 쪽 비율로 얹는다', () => {
    const image = document.createElement('img')
    const text = createTextBox(0, 61.2, 79.2, { text: '검토', size: 12, w: 122.4 })
    const line = createLine(0, { x: 0, y: 0 }, { x: 612, y: 792 }, { arrow: true })
    // 용지 칸 190×277mm, 쪽 612×792pt → 폭에 맞춰 190mm 쪽
    const wrap = printedPageWithOverlays(image, [text, line], [612, 792], 190, 277)
    expect(wrap.style.width).toBe('190mm')
    expect(Number.parseFloat(wrap.style.height)).toBeCloseTo(190 * 792 / 612, 3)
    const printed = wrap.querySelector<HTMLElement>('.iwae-print-text')!
    expect(printed.textContent).toBe('검토')
    expect(printed.style.left).toBe('10%')
    expect(printed.style.top).toBe('10%')
    expect(printed.style.width).toBe('20%')
    expect(Number.parseFloat(printed.style.fontSize)).toBeCloseTo(12 * 190 / 612, 3)
    expect(wrap.querySelector('svg line')).not.toBeNull()
    expect(wrap.querySelector('svg polyline')).not.toBeNull()
  })

  it('쪽이 칸보다 길면 높이에 맞춘다', () => {
    const wrap = printedPageWithOverlays(document.createElement('img'), [createTextBox(0, 0, 0, { text: 'x' })], [612, 792], 190, 100)
    expect(Number.parseFloat(wrap.style.height)).toBeCloseTo(100, 3)
    expect(Number.parseFloat(wrap.style.width)).toBeCloseTo(100 * 612 / 792, 3)
  })
})
