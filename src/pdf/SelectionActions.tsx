import { useCallback, useEffect, useId, useRef, useState, type SyntheticEvent } from 'react'
import type { PdfExcerptSelection } from '../core/pdfExcerpt'
import { announceAction } from '../app/actionFeedback'
import { publishReaderSelection } from '../app/readerSelectionStore'
import { t } from '../i18n'

import { OPEN_TRANSLATION_SETTINGS_EVENT, TranslationCard, useEffectiveTargetLanguage } from '../ui/TranslationCard'

export { OPEN_TRANSLATION_SETTINGS_EVENT }

/**
 * 작업 단추를 눌러도 포커스를 옮기지 않는다. 글을 고르면 메모 바의 새 메모 칸이 포커스를 갖는데,
 * 단추가 포커스를 가져가면 그 칸이 닫히며 고른 것이 풀려 단추의 click 이 오지 않았다(번역·복사가 안 됨)
 */
const keepFocus = (event: SyntheticEvent) => event.preventDefault()

export interface SelectionActionsProps {
  readonly selection: PdfExcerptSelection
  readonly onCopy: (selection: PdfExcerptSelection) => void
  readonly onSendToCanvas?: (selection: PdfExcerptSelection) => void
  /** 문서·절·쪽을 붙여 복사 */
  readonly onCopyWithSource?: (selection: PdfExcerptSelection) => void
  /** 고른 글자로 문서 검색 화면을 연다 */
  readonly onSearchDocuments?: (selection: PdfExcerptSelection) => void
  readonly onTranslate?: (selection: PdfExcerptSelection, options?: { readonly force?: boolean; readonly targetLanguage?: string; readonly sourceLanguage?: string }) => Promise<PdfSelectionTranslation | null>
  readonly onSendTranslationToCanvas?: (
    selection: PdfExcerptSelection,
    translation: PdfSelectionTranslation,
  ) => void
}

export interface PdfSelectionTranslation {
  readonly text: string
  readonly targetLanguage: string
  readonly model: string
}

type TranslationActionState =
  | { readonly status: 'idle' | 'pending' }
  | { readonly status: 'result'; readonly translation: PdfSelectionTranslation }
  | { readonly status: 'error'; readonly message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SelectionActions({
  selection,
  onCopy,
  onSendToCanvas,
  onCopyWithSource,
  onSearchDocuments,
  onTranslate,
  onSendTranslationToCanvas,
}: SelectionActionsProps) {
  const [translationState, setTranslationState] = useState<TranslationActionState>({ status: 'idle' })
  const requestId = useRef(0)
  const selectionKey = [
    selection.anchor.docId,
    selection.anchor.page,
    selection.anchor.charRange[0],
    selection.anchor.charRange[1],
    selection.crop.x,
    selection.crop.y,
    selection.crop.w,
    selection.crop.h,
  ].join(':')
  const hasText = selection.anchor.quote.trim().length > 0
  const canTranslate = hasText && onTranslate !== undefined
  const isTranslating = translationState.status === 'pending'

  // 떠 있는 번역기의 「선택한 글 넣기」가 읽을 수 있게 고른 글을 알린다
  const readerSelectionId = useId()
  const quote = selection.anchor.quote
  useEffect(() => {
    publishReaderSelection(readerSelectionId, quote)
    return () => publishReaderSelection(readerSelectionId, '')
  }, [readerSelectionId, quote])

  useEffect(() => {
    requestId.current += 1
    setTranslationState({ status: 'idle' })
  }, [selectionKey])

  const closeCard = useCallback(() => {
    requestId.current += 1
    setTranslationState({ status: 'idle' })
  }, [])

  const { override, sourceOverride } = useEffectiveTargetLanguage(selection.anchor.quote)
  const handleTranslate = async (force = false, supersede = false): Promise<void> => {
    if (!canTranslate || (isTranslating && !supersede)) return
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setTranslationState({ status: 'pending' })
    try {
      const options = { ...(force ? { force: true } : {}), ...(override === undefined ? {} : { targetLanguage: override }), ...(sourceOverride === undefined ? {} : { sourceLanguage: sourceOverride }) }
      const translation = await (Object.keys(options).length > 0 ? onTranslate(selection, options) : onTranslate(selection))
      if (translation === null) throw new Error(t('번역 결과를 받지 못했습니다.'))
      if (requestId.current === currentRequest) setTranslationState({ status: 'result', translation })
    } catch (error) {
      if (requestId.current === currentRequest) {
        setTranslationState({ status: 'error', message: errorMessage(error) })
      }
    }
  }

  const translateLabel = isTranslating
    ? t('번역 중…')
    : translationState.status === 'error'
      ? t('번역 다시 시도')
      : t('번역')

  return (
    <div className="selection-action-stack">
      <div className="selection-actions" role="toolbar" aria-label={t('PDF 선택 작업')} onPointerDown={keepFocus} onMouseDown={keepFocus}>
      <button
        type="button"
        className="selection-action selection-action-copy"
        disabled={!hasText}
        onClick={() => {
          onCopy(selection)
          announceAction(t('복사했습니다'))
        }}
      >
        {t('복사')}
      </button>
      {onCopyWithSource === undefined ? null : (
        <button
          type="button"
          className="selection-action selection-action-copy-source"
          disabled={!hasText}
          title={t('출처와 함께 복사')}
          onClick={() => onCopyWithSource(selection)}
        >
          {t('출처 복사')}
        </button>
      )}
      {onSearchDocuments === undefined ? null : (
        <button
          type="button"
          className="selection-action selection-action-docsearch"
          disabled={!hasText}
          title={t('고른 글자로 문서 검색 (Ctrl+Shift+F)')}
          onClick={() => onSearchDocuments(selection)}
        >
          {t('문서 검색')}
        </button>
      )}
      {onSendToCanvas === undefined ? null : (
        <button
          type="button"
          className="selection-action selection-action-send"
          onClick={() => onSendToCanvas(selection)}
        >
          {t('노트로 보내기')}
        </button>
      )}
      <button
        type="button"
        className="selection-action selection-action-translate"
        disabled={!canTranslate || isTranslating}
        onClick={() => void handleTranslate()}
      >
        {translateLabel}
      </button>
      </div>
      {translationState.status === 'idle' ? null : (
        <TranslationCard
          original={selection.anchor.quote}
          state={translationState}
          ariaLabel={t('번역 결과 패널')}
          onClose={closeCard}
          onRetry={() => void handleTranslate(true)}
          onRetranslateAfterLanguageChange={() => void handleTranslate(true, true)}
          {...(onSendTranslationToCanvas === undefined ? {} : { onSendToNote: () => {
            if (translationState.status === 'result') onSendTranslationToCanvas(selection, translationState.translation)
          } })}
        />
      )}
    </div>
  )
}
