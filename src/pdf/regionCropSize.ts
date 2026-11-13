/**
 * 노트 메모 카드 안의 영역 그림(표·그림) 크기 상한.
 * 카드 폭에 맞춰 그리되, 칸을 넓혀도 그림이 끝없이 커지지 않게 막는다(사용자 보고 2026-11-13: 「노트를 좌우로 넓히면 그림이 엄청 커진다」).
 * - 폭은 CARD_CROP_MAX_WIDTH 를 넘지 않는다(좁은 칸의 카드 폭과 비슷한 크기).
 * - 원래 크기의 naturalScale 배를 넘지 않는다(작은 영역을 억지로 키우지 않는다).
 * - 높이가 CARD_CROP_MAX_HEIGHT 를 넘지 않게 폭을 줄인다(세로로 긴 그림).
 * 확대 보기는 이 상한을 쓰지 않는다.
 */
export const CARD_CROP_MAX_WIDTH = 480
export const CARD_CROP_MAX_HEIGHT = 560

export function cardCropMaxWidth(rect: { readonly w: number; readonly h: number }, naturalScale: number): number {
  if (!(rect.w > 0) || !(rect.h > 0)) return CARD_CROP_MAX_WIDTH
  return Math.round(Math.min(CARD_CROP_MAX_WIDTH, rect.w * naturalScale, (CARD_CROP_MAX_HEIGHT * rect.w) / rect.h))
}

/** PDF 영역(pt): 100% 보기는 pt × 96/72 px. 그보다 조금 큰 1.5 배까지 */
export const PDF_CROP_NATURAL_SCALE = 1.5
/** Markdown 영역(종이 px): 읽을 때와 같은 크기까지 */
export const MARKDOWN_CROP_NATURAL_SCALE = 1
