import { pageImageUrl } from '../../bridge/pdf'
import { isDesktop } from '../../bridge/window'
import type { AnchorRect } from '../../core/anchor'
import type { CanvasDocumentV2 } from '../../core/canvasDocument'
import {
  collectEvidence,
  evidencePageKey,
  readingOrder,
  renderEvidenceHtml,
  type EvidenceDocMeta,
} from '../../core/evidenceExport'
import type { PdfExcerptCrop } from '../../core/pdfExcerpt'
import { dateLocale, t } from '../../i18n'

/** 근거 쪽 그림 폭(px). 읽기에 충분하고 파일이 지나치게 커지지 않는 값이다 */
const PAGE_WIDTH = 1000
/** 쪽을 한 번 받아 오는 폭(px). 발췌는 이 해상도에서 자르고, 쪽 그림은 PAGE_WIDTH 로 줄인다 */
const SOURCE_WIDTH = 1600
const HIGHLIGHT = 'rgba(255, 214, 0, 0.38)'

/** 한 쪽에서 나온 그림들. 발췌 그림은 노드 id 로 찾는다 */
export interface RenderedPage {
  readonly page: string | null
  readonly crops: Readonly<Record<string, string | null>>
}

/** 그림을 그리는 쪽. 브라우저에서는 캔버스, 테스트에서는 가짜다. 쪽마다 한 번 불린다 */
export interface EvidenceRasterizer {
  page(
    url: string,
    pageSize: readonly [number, number],
    crops: Readonly<Record<string, PdfExcerptCrop>>,
    highlights: readonly AnchorRect[],
  ): Promise<RenderedPage>
}

interface BuildOptions {
  readonly title: string
  readonly document: CanvasDocumentV2
  readonly docs: Readonly<Record<string, EvidenceDocMeta>>
  readonly rasterizer: EvidenceRasterizer
  readonly imageUrl?: (docId: string, page: number, width: number) => string
  readonly now?: Date
}

/**
 * 문서를 읽고 그림을 그려 HTML 한 파일로 만든다. 쪽마다 한 번만 받아 발췌와 쪽 그림을 함께
 * 만들고 넘어가서, 인용한 쪽이 많아도 메모리에 쪽 그림이 쌓이지 않는다. 한 쪽이 실패해도 계속한다.
 */
export async function buildEvidenceHtml({
  title,
  document,
  docs,
  rasterizer,
  imageUrl = pageImageUrl,
  now = new Date(),
}: BuildOptions): Promise<string> {
  const crops: Record<string, string | null> = {}
  const pages: Record<string, string | null> = {}
  const excerpts = new Map<string, { size: readonly [number, number], crops: Record<string, PdfExcerptCrop> }>()

  for (const node of document.nodes) {
    const block = node.data.block
    if (block.kind !== 'pdfExcerpt') continue
    const { anchor, pageSize, crop } = block.excerpt.selection
    const key = evidencePageKey(anchor.docId, anchor.page)
    const entry = excerpts.get(key) ?? { size: pageSize, crops: {} }
    entry.crops[node.id] = crop
    excerpts.set(key, entry)
    crops[node.id] = null
  }

  for (const group of collectEvidence(readingOrder(document.nodes))) {
    for (const { page, anchors } of group.pages) {
      const key = evidencePageKey(group.docId, page)
      const entry = excerpts.get(key)
      const rendered = await rasterizer
        .page(
          imageUrl(group.docId, page, SOURCE_WIDTH),
          entry?.size ?? [612, 792],
          entry?.crops ?? {},
          anchors.flatMap((anchor) => anchor.rects),
        )
        .catch(() => null)
      pages[key] = rendered?.page ?? null
      for (const id of Object.keys(entry?.crops ?? {})) crops[id] = rendered?.crops[id] ?? null
    }
  }

  return renderEvidenceHtml({
    title,
    exportedAt: now.toLocaleDateString(dateLocale(), { year: 'numeric', month: 'long', day: 'numeric' }),
    nodes: document.nodes,
    edges: document.edges,
    crops,
    pages,
    docs,
  })
}

/**
 * 캔버스로 그리는 실제 그리개. 쪽 그림은 iwae:// 에서 받아 비트맵으로 만든다 — fetch 로 받은
 * 그림은 캔버스를 오염시키지 않아서 data URL 로 꺼낼 수 있다. 다 그리면 비트맵을 바로 놓아준다.
 */
export function createCanvasRasterizer(fetchImage: typeof fetch = fetch): EvidenceRasterizer {
  const canvasOf = (width: number, height: number) => {
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width))
    canvas.height = Math.max(1, Math.round(height))
    const context = canvas.getContext('2d')
    if (context === null) throw new Error(t('그림을 그릴 수 없습니다.'))
    return { canvas, context }
  }

  return {
    async page(url, pageSize, crops, highlights) {
      const response = await fetchImage(url)
      if (!response.ok) throw new Error(t('쪽 그림을 받지 못했습니다: {status}', { status: response.status }))
      const bitmap = await createImageBitmap(await response.blob())
      try {
        const sourceScale = bitmap.width / pageSize[0]
        const rendered: Record<string, string | null> = {}
        for (const [id, crop] of Object.entries(crops)) {
          const { canvas, context } = canvasOf(crop.w * sourceScale, crop.h * sourceScale)
          context.drawImage(bitmap, crop.x * sourceScale, crop.y * sourceScale, crop.w * sourceScale, crop.h * sourceScale, 0, 0, canvas.width, canvas.height)
          rendered[id] = canvas.toDataURL('image/png')
        }
        const width = Math.min(PAGE_WIDTH, bitmap.width)
        const { canvas, context } = canvasOf(width, (bitmap.height * width) / bitmap.width)
        context.fillStyle = '#fff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const scale = canvas.width / pageSize[0]
        context.fillStyle = HIGHLIGHT
        for (const rect of highlights) context.fillRect(rect.x * scale, rect.y * scale, rect.w * scale, rect.h * scale)
        return { page: canvas.toDataURL('image/jpeg', 0.82), crops: rendered }
      } finally {
        bitmap.close()
      }
    },
  }
}

/**
 * HTML 을 저장한다. 데스크톱에서는 저장 위치를 묻고 그 경로를 돌려준다(취소하면 null).
 * 브라우저 미리보기에서는 내려받기로 처리한다.
 */
export async function saveHtmlFile(suggestedName: string, html: string): Promise<string | null> {
  if (!isDesktop()) {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
    const link = window.document.createElement('a')
    link.href = url
    link.download = suggestedName
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return suggestedName
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: suggestedName, filters: [{ name: 'HTML', extensions: ['html'] }] })
  if (path === null) return null
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(path, html)
  return path
}
