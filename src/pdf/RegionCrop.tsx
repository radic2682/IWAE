import { pageImageUrl } from '../bridge/pdf'
import type { PersistentPdfHighlight } from './persistentHighlight'
import { t } from '../i18n'

/** 영역 메모(표·그림)의 원문을 폭에 맞춰 잘라 보인다 */
export function RegionCrop({ highlight, pageSize, maxWidth, fill = false }: {
  readonly highlight: PersistentPdfHighlight
  readonly pageSize: readonly [number, number]
  /** 그릴 폭(px). fill 이면 그림 해상도를 정하는 데만 쓴다 */
  readonly maxWidth: number
  /** 담는 칸의 폭에 꽉 맞춘다(좌우 맞춤). 높이는 그 비율대로 */
  readonly fill?: boolean
}) {
  const rect = highlight.anchor.rects[0]
  if (rect === undefined) return null
  const ratio = typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1
  if (fill && rect.w > 0 && rect.h > 0) {
    const pixels = Math.round(pageSize[0] * (maxWidth / rect.w) * ratio)
    return (
      <div className="pdf-memo-list-crop region-crop-fill" style={{ width: '100%', aspectRatio: `${rect.w} / ${rect.h}` }}>
        <img
          src={pageImageUrl(highlight.anchor.docId, highlight.anchor.page, pixels)}
          alt={t('고른 표·그림')}
          draggable={false}
          style={{
            width: `${(pageSize[0] / rect.w) * 100}%`,
            height: `${(pageSize[1] / rect.h) * 100}%`,
            left: `${(-rect.x / rect.w) * 100}%`,
            top: `${(-rect.y / rect.h) * 100}%`,
          }}
        />
      </div>
    )
  }
  const scale = Math.min(maxWidth / rect.w, 2)
  return (
    <div className="pdf-memo-list-crop" style={{ width: `${rect.w * scale}px`, height: `${rect.h * scale}px` }}>
      <img
        src={pageImageUrl(highlight.anchor.docId, highlight.anchor.page, Math.round(pageSize[0] * scale * ratio))}
        alt={t('고른 표·그림')}
        draggable={false}
        style={{ width: `${pageSize[0] * scale}px`, height: `${pageSize[1] * scale}px`, left: `${-rect.x * scale}px`, top: `${-rect.y * scale}px` }}
      />
    </div>
  )
}
