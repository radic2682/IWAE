import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import type { PersistentPdfHighlight } from './persistentHighlight'
import { cardCropMaxWidth, MARKDOWN_CROP_NATURAL_SCALE } from './regionCropSize'

/** Markdown 종이 폭(MarkdownWriteLayer 의 MARKDOWN_PAPER_WIDTH)과 글 칸 양옆 여백 */
const PAPER_WIDTH = 820
const PAPER_SIDE = 56

/**
 * Markdown 영역 메모의 그림: 잡을 때 남긴 블록들(HTML)을 같은 종이 폭으로 다시 놓고, 끈 네모만큼 잘라 카드 폭에 맞춰 보인다.
 * PDF 의 RegionCrop 과 같은 자리를 맡는다(문서가 안 열려 있어도 보인다). 넓은 칸에서도 크기 상한(regionCropSize)을 넘지 않는다.
 */
export function MarkdownRegionCrop({ highlight }: { readonly highlight: PersistentPdfHighlight }) {
  const rect = highlight.anchor.rects[0]
  const snapshot = highlight.snapshot
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = boxRef.current
    if (element === null) return undefined
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const html = useMemo(() => (snapshot === undefined ? '' : DOMPurify.sanitize(snapshot.html)), [snapshot])
  if (rect === undefined || snapshot === undefined || rect.w <= 0 || rect.h <= 0) return null
  const scale = width > 0 ? width / rect.w : 0
  return (
    <div ref={boxRef} className="markdown-region-crop" style={{ maxWidth: cardCropMaxWidth(rect, MARKDOWN_CROP_NATURAL_SCALE), height: scale > 0 ? rect.h * scale : undefined }}>
      {scale > 0 ? (
        <div
          className="markdown-pane markdown-region-crop-paper"
          style={{ width: PAPER_WIDTH, left: -rect.x * scale, top: (snapshot.top - rect.y) * scale, transform: `scale(${scale})` }}
        >
          <div
            className="markdown-region-crop-body"
            style={{ marginLeft: snapshot.left ?? PAPER_SIDE, width: snapshot.width ?? PAPER_WIDTH - PAPER_SIDE * 2 }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      ) : null}
    </div>
  )
}
