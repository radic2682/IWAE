export interface RecognizedTextItem {
  readonly text: string
  readonly score: number
}

export function joinRecognizedText(
  items: readonly RecognizedTextItem[],
  minimumScore = 0.35,
): string {
  return items
    .filter((item) => Number.isFinite(item.score) && item.score >= minimumScore)
    .map((item) => item.text.trim())
    .filter((text) => text !== '')
    .join('\n')
}
