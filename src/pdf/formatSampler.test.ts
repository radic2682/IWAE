import { describe, expect, it } from 'vitest'
import { createTextBox } from '../core/pdfOverlays'
import {
  charIndexUnder, cleanFontName, glyphSizePt, guessOverlayFont, lineNeighbourhood, overlayPatchOf, pickInkColor, sampleInkBandAt, sampledSummary,
  scanSizePt, styleOfTextBox, toolPatchOf, type PixelImage,
} from './formatSampler'

function canvasOf(width: number, height: number, background: [number, number, number]): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) data.set([...background, 255], i * 4)
  return { data, width, height }
}
function fillRect(image: PixelImage, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]): void {
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) image.data.set([...rgb, 255], (y * image.width + x) * 4)
}

describe('글꼴 이름 맞추기', () => {
  it('부분 글꼴 접두와 굵기 꼬리를 걷어 낸다', () => {
    expect(cleanFontName('ABCDEF+Batang')).toBe('Batang')
    expect(cleanFontName('Arial-BoldMT')).toBe('Arial')
    expect(cleanFontName('NanumMyeongjo,Bold')).toBe('NanumMyeongjo')
  })

  it('알려진 한글·영문 글꼴은 id 로', () => {
    expect(guessOverlayFont('ABCDEF+BatangChe', false).font).toBe('batang')
    expect(guessOverlayFont('HYMyeongJo-Medium', false).font).toBe('batang')
    expect(guessOverlayFont('NanumMyeongjo', false).font).toBe('batang')
    expect(guessOverlayFont('함초롬바탕', false).font).toBe('batang')
    expect(guessOverlayFont('Gungsuh', false).font).toBe('gungsuh')
    expect(guessOverlayFont('Gulim', false).font).toBe('gulim')
    expect(guessOverlayFont('Dotum', false).font).toBe('dotum')
    expect(guessOverlayFont('TimesNewRomanPS-BoldMT', false).font).toBe('times')
    expect(guessOverlayFont('ArialMT', false).font).toBe('arial')
    expect(guessOverlayFont('CourierNewPSMT', false).font).toBe('courier')
    expect(guessOverlayFont('MalgunGothic', false).font).toBe('')
  })

  it('모르는 이름: 설치돼 있으면 그 이름, 아니면 바탕체 표시로 바탕 / 기본', () => {
    const installed = (name: string) => name === 'Nanum Gothic'
    expect(guessOverlayFont('NanumGothic', false, installed)).toEqual({ font: 'Nanum Gothic', label: 'Nanum Gothic' })
    expect(guessOverlayFont('SomeUnknownFace', true, () => false).font).toBe('batang')
    expect(guessOverlayFont('SomeUnknownFace', false, () => false).font).toBe('')
    expect(guessOverlayFont('', true).font).toBe('batang')
  })
})

describe('글자 크기 환산', () => {
  it('PDFium 글꼴 크기가 있으면 0.5 단위로, 없으면 상자 높이 / 1.2', () => {
    expect(glyphSizePt(9.52, 11)).toBe(9.5)
    expect(glyphSizePt(null, 12)).toBe(10)
    expect(glyphSizePt(undefined, 11.4)).toBe(9.5)
    expect(glyphSizePt(0, 0)).toBeNull()
  })
  it('스캔 줄 높이 / 0.93', () => {
    expect(scanSizePt(9.3)).toBe(10)
    expect(scanSizePt(0)).toBeNull()
  })
})

describe('색 고르기', () => {
  it('흰 바탕의 남색 글자 -> 남색(번진 가장자리는 뺀다)', () => {
    const image = canvasOf(60, 30, [255, 255, 255])
    fillRect(image, 10, 8, 50, 20, [30, 40, 110])
    fillRect(image, 9, 8, 10, 20, [200, 205, 230])
    expect(pickInkColor(image)).toBe('#1e286e')
  })
  it('어두운 바탕의 밝은 글자도 바탕과 다른 쪽을 고른다', () => {
    const image = canvasOf(60, 30, [20, 20, 20])
    fillRect(image, 10, 8, 50, 20, [240, 240, 120])
    expect(pickInkColor(image)).toBe('#f0f078')
  })
  it('글자가 없으면 null', () => {
    expect(pickInkColor(canvasOf(40, 20, [255, 255, 255]))).toBeNull()
  })
  it('스캔: 눌린 높이에 걸친 글자 줄의 높이와 색', () => {
    const image = canvasOf(120, 60, [250, 250, 245])
    fillRect(image, 8, 22, 110, 34, [20, 20, 20])
    fillRect(image, 8, 48, 110, 52, [180, 0, 0])
    const band = sampleInkBandAt(image, 28)
    expect(band).toMatchObject({ bandHeight: 12, color: '#141414' })
    expect(sampleInkBandAt(image, 10)?.bandHeight).toBe(12)
    expect(sampleInkBandAt(canvasOf(120, 60, [255, 255, 255]), 30)).toBeNull()
  })
})

describe('PDF 글자 찾기', () => {
  const chars = [
    { c: '가', x: 10, y: 20, w: 10, h: 12 },
    { c: '나', x: 20, y: 20, w: 10, h: 12 },
    { c: ' ', x: 30, y: 20, w: 5, h: 12 },
    { c: '다', x: 35, y: 20, w: 10, h: 12 },
    { c: '라', x: 10, y: 60, w: 10, h: 12 },
  ]
  const index = { text: '가나 다라', chars }
  it('점을 품은 글자(없으면 2pt 안의 가장 가까운 글자), 공백은 건너뛴다', () => {
    expect(charIndexUnder(index, { x: 25, y: 26 })).toBe(1)
    expect(charIndexUnder(index, { x: 31, y: 26 })).toBe(1)
    expect(charIndexUnder(index, { x: 100, y: 100 })).toBeNull()
  })
  it('같은 줄의 이웃 글자를 합친 네모(다른 줄은 빼고)', () => {
    expect(lineNeighbourhood(index, 1)).toEqual({ x: 10, y: 20, w: 35, h: 12 })
  })
})

describe('서식 적용', () => {
  it('글 상자 -> 전체 서식, 고른 상자·도구 서식 패치로', () => {
    const box = createTextBox(0, 0, 0, { text: 'x', size: 9.5, color: '#336699', bold: true, fill: '#ffeecc', border: true, borderColor: '#112233', font: 'times' })
    const sampled = styleOfTextBox(box)
    expect(overlayPatchOf(sampled)).toEqual({ size: 9.5, color: '#336699', bold: true, font: 'times', fill: '#ffeecc', border: true, borderColor: '#112233' })
    expect(toolPatchOf(sampled)).toEqual({ textSize: 9.5, color: '#336699', bold: true, textFont: 'times', textFill: '#ffeecc', border: true, textBorderColor: '#112233' })
    expect(sampledSummary(sampled)).toBe('서식을 가져왔습니다 (9.5 pt · Times New Roman)')
  })
  it('바탕·테두리 없는 상자를 읽으면 그것들을 지운다', () => {
    const plain = styleOfTextBox(createTextBox(0, 0, 0, { text: 'x' }))
    expect(overlayPatchOf(plain)).toMatchObject({ bold: undefined, font: undefined, fill: undefined, border: undefined, borderColor: undefined })
    expect(toolPatchOf(plain)).toMatchObject({ textFont: '', textFill: 'none', border: false, textBorderColor: '' })
  })
  it('PDF 글자에서 읽은 것은 읽은 칸만 건다', () => {
    const sampled = { source: 'text' as const, size: 11, color: '#222222', font: 'batang' }
    expect(overlayPatchOf(sampled)).toEqual({ size: 11, color: '#222222', font: 'batang' })
    expect(sampledSummary(sampled)).toBe('서식을 가져왔습니다 (11 pt · 바탕(명조))')
  })
})
