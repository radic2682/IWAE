import type { PageTextIndex } from '../../core/textIndex'

// vi.mock 의 공장에서 불러도 index.ts 를 끌어오지 않도록 따로 둔 쪽 글 가짜

/** 시험용 PDF 쪽 글: docId → 쪽마다 글 */
export const fakePages = new Map<string, string[]>()

export function setFakePdf(docId: string, pages: string[]): void {
  fakePages.set(docId, pages)
}

const CHAR_W = 6
const CHAR_H = 10
const LINE = 60

/** 글을 줄바꿈(60자)해 글자마다 상자를 준다. 줄은 12pt 간격 */
export function fakeIndex(text: string): PageTextIndex {
  return {
    text,
    chars: [...text].map((c, i) => ({ c, x: 20 + (i % LINE) * CHAR_W, y: 20 + Math.floor(i / LINE) * 12, w: c === '\n' ? 0 : CHAR_W, h: CHAR_H })),
  }
}

export function fakePageTextIndex(docId: string, page: number): Promise<PageTextIndex> {
  const text = fakePages.get(docId)?.[page]
  return text === undefined ? Promise.reject(new Error('page text unavailable')) : Promise.resolve(fakeIndex(text))
}
