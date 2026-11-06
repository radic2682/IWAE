import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import type { PdfExcerptSelection } from '../core/pdfExcerpt'
import { announceAction } from '../app/actionFeedback'
import { t } from '../i18n'

/** 번역 설정 화면을 연다(App 이 듣는다) */
export const OPEN_TRANSLATION_SETTINGS_EVENT = 'iwae:open-translation-settings'

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
  readonly onTranslate?: (selection: PdfExcerptSelection) => Promise<PdfSelectionTranslation | null>
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

  useEffect(() => {
    requestId.current += 1
    setTranslationState({ status: 'idle' })
  }, [selectionKey])

  const handleTranslate = async (): Promise<void> => {
    if (!canTranslate || isTranslating) return
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setTranslationState({ status: 'pending' })
    try {
      const translation = await onTranslate(selection)
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
        onClick={handleTranslate}
      >
        {translateLabel}
      </button>
      </div>
      {translationState.status === 'result' ? (
        <div className="selection-translation-result" role="region" aria-label={t('번역 결과 패널')} onPointerDown={keepFocus} onMouseDown={keepFocus}>
          <p aria-label={t('번역 결과')}>{translationState.translation.text}</p>
          <div className="selection-translation-actions">
            <button
              type="button"
              className="selection-action selection-action-copy-translation"
              onClick={() => {
                void navigator.clipboard?.writeText(translationState.translation.text)
                announceAction(t('번역을 복사했습니다'))
              }}
            >
              {t('번역 복사')}
            </button>
            {onSendTranslationToCanvas === undefined ? null : (
              <button
                type="button"
                className="selection-action selection-action-send-translation"
                onClick={() => onSendTranslationToCanvas(selection, translationState.translation)}
              >
                {t('번역과 함께 블록 추가')}
              </button>
            )}
          </div>
        </div>
      ) : null}
      {translationState.status === 'error' ? (
        <div className="selection-action-status" role="alert" onPointerDown={keepFocus} onMouseDown={keepFocus}>
          <span>{t('번역 실패: {message}', { message: translationState.message })}</span>
          <button
            type="button"
            className="selection-action selection-action-open-settings"
            onClick={() => window.dispatchEvent(new Event(OPEN_TRANSLATION_SETTINGS_EVENT))}
          >
            {t('번역 설정 열기')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
