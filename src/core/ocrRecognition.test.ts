import { describe, expect, it } from 'vitest'
import { joinRecognizedText } from './ocrRecognition'

describe('OCR 검색 본문 정제', () => {
  it('빈 줄과 신뢰도가 낮은 결과를 제외하고 읽기 순서대로 합친다', () => {
    expect(joinRecognizedText([
      { text: '  first line  ', score: 0.92 },
      { text: 'noise', score: 0.12 },
      { text: '   ', score: 0.99 },
      { text: 'second line', score: 0.81 },
    ])).toBe('first line\nsecond line')
  })
})
