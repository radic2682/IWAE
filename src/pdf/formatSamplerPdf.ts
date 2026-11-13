import { pageImageUrl, pageTextIndex, pdfCharStyle } from '../bridge/pdf'
import { announceAction } from '../app/actionFeedback'
import type { OverlayPatch, PdfOverlay } from '../core/pdfOverlays'
import { t } from '../i18n'
import type { SamplePick } from './PdfOverlayLayer'
import type { ToolStyle } from './overlayToolStore'
import {
  charIndexUnder, overlayPatchOf, sampledSummary, styleOfTextBox, toolPatchOf, glyphSizePt, guessOverlayFont, isFontInstalled, lineNeighbourhood, pickInkColor, sampleInkBandAt, scanSizePt,
  type PixelImage, type SampledStyle,
} from './formatSampler'

/** 쪽의 한 네모(쪽 좌표 pt)를 쪽 그림에서 잘라 픽셀로. scale = 그림 픽셀 / pt */
async function regionPixels(docId: string, page: number, pageSize: readonly [number, number], rect: { x: number; y: number; w: number; h: number }): Promise<{ image: PixelImage; scale: number; left: number; top: number } | null> {
  if (pageSize[0] <= 0 || rect.w <= 0 || rect.h <= 0) return null
  try {
    const width = Math.min(2400, Math.round(pageSize[0] * 3))
    const response = await fetch(pageImageUrl(docId, page, width))
    if (!response.ok) return null
    const bitmap = await createImageBitmap(await response.blob())
    const scale = bitmap.width / pageSize[0]
    const left = Math.max(0, rect.x)
    const top = Math.max(0, rect.y)
    const w = Math.max(1, Math.round(Math.min(rect.w, pageSize[0] - left) * scale))
    const h = Math.max(1, Math.round(Math.min(rect.h, pageSize[1] - top) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, w, h)
    context.drawImage(bitmap, left * scale, top * scale, w, h, 0, 0, w, h)
    bitmap.close()
    const data = context.getImageData(0, 0, w, h)
    return { image: { data: data.data, width: w, height: h }, scale, left, top }
  } catch {
    return null
  }
}

/**
 * PDF 쪽의 한 점(쪽 좌표)에서 글꼴·크기·색을 읽는다.
 * 글자 층이 있고 점 아래에 글자가 있으면 PDFium 글꼴 정보, 아니면(스캔) 쪽 그림에서 글자 줄 높이를 잰다. 못 읽으면 null.
 */
export async function samplePdfPoint(docId: string, page: number, pageSize: readonly [number, number], point: { x: number; y: number }): Promise<SampledStyle | null> {
  const index = await pageTextIndex(docId, page).catch(() => null)
  const at = index === null ? null : charIndexUnder(index, point)
  if (index !== null && at !== null) {
    const box = index.chars[at]!
    const style = await pdfCharStyle(docId, page, at)
    const size = glyphSizePt(style?.size, box.h)
    const guess = style === null ? null : guessOverlayFont(style.fontName, style.serif, isFontInstalled)
    const area = lineNeighbourhood(index, at)
    const pixels = area === null ? null : await regionPixels(docId, page, pageSize, area)
    const color = pixels === null ? null : pickInkColor(pixels.image)
    if (size === null && color === null && guess === null) return null
    return {
      source: 'text',
      ...(size === null ? {} : { size }),
      ...(color === null ? {} : { color }),
      ...(guess === null ? {} : { font: guess.font }),
      ...(style?.bold === true ? { bold: true } : style === null ? {} : { bold: false }),
    }
  }
  // 글자 층이 없는 곳(스캔): 눌린 자리 둘레를 잘라 글자 줄 높이와 색을 잰다
  const window = { x: point.x - 70, y: point.y - 26, w: 140, h: 52 }
  const pixels = await regionPixels(docId, page, pageSize, window)
  if (pixels === null) return null
  const band = sampleInkBandAt(pixels.image, (point.y - pixels.top) * pixels.scale)
  if (band === null) return null
  const size = scanSizePt(band.bandHeight / pixels.scale)
  if (size === null) return null
  return { source: 'scan', size, ...(band.color === null ? {} : { color: band.color }) }
}

export interface SampleContext {
  /** PDF 쪽이면 문서 정보(Markdown 위에는 없다: 글 상자에서만 가져온다) */
  readonly pdf?: { readonly docId: string; readonly pageSizes: readonly (readonly [number, number])[] }
  /** 지금 고른 덮개 */
  readonly selected: PdfOverlay | null
  readonly onUpdateSelected: (patch: OverlayPatch) => void
  /** 새로 만들 글 상자의 서식 */
  readonly patchToolStyle: (patch: Partial<ToolStyle>) => void
}

/**
 * 눌린 곳에서 서식을 읽어 고른 글 상자(한 번의 되돌리기)에, 없으면 새 글 상자의 서식에 건다.
 * 결과를 짧은 안내로 알린다. 읽을 수 없으면 아무것도 바꾸지 않는다.
 */
export async function applySamplePick(pick: SamplePick, context: SampleContext): Promise<void> {
  let sampled: SampledStyle | null = null
  if (pick.kind === 'box') {
    sampled = styleOfTextBox(pick.box)
  } else if (context.pdf === undefined) {
    announceAction(t('글 상자를 눌러 서식을 가져옵니다'))
    return
  } else {
    const size = context.pdf.pageSizes[pick.page]
    sampled = size === undefined ? null : await samplePdfPoint(context.pdf.docId, pick.page, size, pick.point)
  }
  if (sampled === null) {
    announceAction(t('글자를 찾지 못했습니다. 글자 위를 누르세요'))
    return
  }
  if (context.selected?.kind === 'text') context.onUpdateSelected(overlayPatchOf(sampled))
  else context.patchToolStyle(toolPatchOf(sampled))
  announceAction(sampledSummary(sampled))
}
