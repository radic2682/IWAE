import { Robot } from '@phosphor-icons/react'
import { useEffect } from 'react'
import { coalesceHighlightRects, type Anchor } from '../core/anchor'
import { t } from '../i18n'
import '../ui/ai-pointer.css'

/**
 * 바깥 AI 가 "여기"라고 가리킨 자리. 저장되지 않는 임시 표시라서 형광펜·선택(draft)과 따로 둔다.
 * 실행 취소·Vault 파일과 무관하고, 지워지기 전까지(Esc·쪽 클릭·다른 곳을 가리킴·문서 닫기) 남는다.
 */
export interface AiPointer {
  readonly id: string
  readonly docId: string
  /** 0-기반(Anchor.page 와 같다) */
  readonly page: number
  readonly anchor: Anchor
  /** AI 가 함께 보낸 말(없으면 인용문을 말풍선으로 보인다) */
  readonly message?: string
}

interface AiPointerLayerProps {
  readonly pointer: AiPointer
  readonly renderScale: number
}

/** 이 쪽에 그리는 AI 가리킴: 줄마다 점선 테두리 + 옅은 바탕, 첫 네모 왼쪽 위에 「AI」 칩 */
export function AiPointerLayer({ pointer, renderScale }: AiPointerLayerProps) {
  const rects = coalesceHighlightRects(pointer.anchor.rects)
  if (rects.length === 0) return null
  const tip = (pointer.message ?? '').trim() || pointer.anchor.quote.trim() || t('AI가 가리키는 곳')
  return (
    <div className="ai-pointer-layer" data-ai-pointer={pointer.id}>
      {rects.map((rect, index) => (
        <div
          key={index}
          className="ai-pointer-rect"
          data-ai-pointer-rect=""
          style={{
            left: `${rect.x * renderScale - 2}px`,
            top: `${rect.y * renderScale - 2}px`,
            width: `${rect.w * renderScale + 4}px`,
            height: `${rect.h * renderScale + 4}px`,
          }}
        >
          {index === 0 ? (
            <span className="ai-pointer-chip" role="img" aria-label={t('AI가 가리키는 곳')} title={tip}>
              <Robot size={11} weight="bold" aria-hidden="true" />
              <span>AI</span>
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
}

/**
 * AI 가리킴을 지우는 입력: Esc(글 입력 중이 아닐 때), PDF 쪽 영역 클릭.
 * 켜져 있을 때만 듣는다. 쪽이 화면 밖이어도 지워지도록 쪽마다가 아니라 창 하나에서 듣는다.
 */
export function useAiPointerDismiss(active: boolean, onDismiss: (() => void) | undefined) {
  useEffect(() => {
    if (!active || onDismiss === undefined) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (isEditableTarget(event.target)) return
      onDismiss()
    }
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.pdf-page-slot') !== null) onDismiss()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [active, onDismiss])
}
