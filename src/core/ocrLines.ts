/** OCR 가 돌려준 한 줄. 꼭짓점은 렌더한 그림의 픽셀 좌표다 */
export interface OcrLineItem {
  readonly text: string
  readonly poly: readonly (readonly [number, number])[]
}

/** 검색 가능한 PDF 에 깔 한 줄. 페이지 points, 왼쪽 위 원점 */
export interface SearchableLine {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * OCR 줄 꼭짓점을 페이지 좌표의 상자로 바꾼다. `scale` 은 그림 1픽셀이 몇 points 인지다
 * (페이지 폭 ÷ 렌더 폭). 글자가 없거나 넓이가 없는 줄은 버린다.
 */
export function ocrItemsToLines(items: readonly OcrLineItem[], scale: number): SearchableLine[] {
  const lines: SearchableLine[] = []
  for (const item of items) {
    const text = item.text.trim()
    if (text === '' || item.poly.length === 0) continue
    const xs = item.poly.map(([x]) => x)
    const ys = item.poly.map(([, y]) => y)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    const width = Math.max(...xs) - left
    const height = Math.max(...ys) - top
    if (width <= 0 || height <= 0) continue
    lines.push({ text, x: left * scale, y: top * scale, w: width * scale, h: height * scale })
  }
  return lines
}
