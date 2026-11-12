import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
import { explainTranslationError, isTranslationNotConfigured } from '../core/translationErrors'
import { ArrowClockwise, ArrowRight, CaretDown, Copy, Plus, X } from '@phosphor-icons/react'
import { announceAction } from '../app/actionFeedback'
import { t } from '../i18n'
import { guessLanguage, normalizeSelectionText, sameLanguageFallback } from '../core/translationText'
import { TranslationLanguageBar } from './TranslationLanguageBar'
import { clampMoveToViewport, isDragExempt } from './dragExempt'
import { AUTO_SOURCE, TRANSLATION_LANGUAGES, languageLabel, pickSource, pickTarget, setTranslationSource, swapPair, useTranslationSource, type LanguagePair } from './translationPair'
import './translation-card.css'

export { TRANSLATION_LANGUAGES, languageLabel }

/** 번역 설정 화면을 연다(App 이 듣는다) */
export const OPEN_TRANSLATION_SETTINGS_EVENT = 'iwae:open-translation-settings'

export interface TranslationCardResult {
  readonly text: string
  readonly targetLanguage: string
  readonly model: string
}

export type TranslationCardState =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'result'; readonly translation: TranslationCardResult }
  | { readonly status: 'error'; readonly message: string }

/** App 이 알려 주는 번역 설정: 카드의 언어·번역기 칩이 쓴다. 없으면 결과에 딸린 값을 보이고 언어 칩은 설정을 연다 */
export interface TranslationCardSettings {
  readonly targetLanguage: string
  readonly providerLabel: string
  readonly onChangeTargetLanguage: (code: string) => void
}

export const TranslationCardSettingsContext = createContext<TranslationCardSettings | null>(null)

/** 번역에 실제로 쓸 언어: 원문이 이미 설정의 언어면 다른 언어(저장된 설정은 그대로). 설정 정보가 없으면 null */
export function useEffectiveTargetLanguage(original: string): {
  readonly target: string | null
  readonly override: string | undefined
  /** 고른 원문 언어('auto' 이면 자동 감지) */
  readonly source: string
  /** 번역기에 넘길 원문 언어(자동이면 undefined) */
  readonly sourceOverride: string | undefined
} {
  const settings = useContext(TranslationCardSettingsContext)
  const source = useTranslationSource()
  if (settings === null) return { target: null, override: undefined, source: AUTO_SOURCE, sourceOverride: undefined }
  // 원문 언어를 직접 골랐으면 그대로 따른다(같은 언어 대체는 자동 감지일 때만)
  const fallback = source === AUTO_SOURCE ? sameLanguageFallback(normalizeSelectionText(original), settings.targetLanguage) : null
  return { target: fallback ?? settings.targetLanguage, override: fallback ?? undefined, source, sourceOverride: source === AUTO_SOURCE ? undefined : source }
}

/** 단추를 눌러도 포커스를 옮기지 않는다(고른 글이 풀리지 않게). 목록·입력칸은 열려야 하니 제외 */
const keepFocus = (event: SyntheticEvent) => {
  if (event.target instanceof Element && event.target.closest('select, textarea, input') !== null) return
  event.preventDefault()
}

export interface TranslationCardProps {
  readonly original: string
  readonly state: TranslationCardState
  readonly ariaLabel: string
  readonly onClose: () => void
  /** 다시 번역(캐시를 건너뛴다) */
  readonly onRetry: () => void
  /** 대상 언어를 바꾼 뒤 새 언어로 번역하려고 부른다 */
  readonly onRetranslateAfterLanguageChange: () => void
  readonly onSendToNote?: () => void
}

export function TranslationCard({ original, state, ariaLabel, onClose, onRetry, onRetranslateAfterLanguageChange, onSendToNote }: TranslationCardProps) {
  const settings = useContext(TranslationCardSettingsContext)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [moved, setMoved] = useState<{ readonly x: number; readonly y: number } | null>(null)
  const dragRef = useRef<{ readonly startX: number; readonly startY: number; readonly baseX: number; readonly baseY: number; readonly rect: DOMRect } | null>(null)
  const [shift, setShift] = useState<{ readonly x: number; readonly up: boolean }>({ x: 0, up: false })
  const pendingLanguageChange = useRef(false)
  const retranslateRef = useRef(onRetranslateAfterLanguageChange)
  retranslateRef.current = onRetranslateAfterLanguageChange
  const normalizedOriginal = normalizeSelectionText(original)
  const effective = useEffectiveTargetLanguage(original)
  const sourceChoice = effective.source
  const target = effective.target ?? (state.status === 'result' ? state.translation.targetLanguage : '')
  const providerLabel = settings?.providerLabel ?? (state.status === 'result' ? state.translation.model : '')
  const detected = guessLanguage(normalizedOriginal)
  const pending = state.status === 'pending'

  // Esc · 바깥 누르기로 닫는다(카드를 연 작업 줄을 누르는 것은 바깥이 아니다)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    const onPointer = (event: PointerEvent) => {
      const card = cardRef.current
      if (card === null || !(event.target instanceof Node)) return
      if (card.contains(event.target) || card.parentElement?.contains(event.target) === true) return
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [onClose])

  // 언어를 바꾸면 App 이 새 언어·캐시 열쇠를 반영한 뒤(effect 가 다 돈 뒤) 다시 번역한다
  useEffect(() => {
    if (!pendingLanguageChange.current) return undefined
    pendingLanguageChange.current = false
    const timer = window.setTimeout(() => retranslateRef.current(), 0)
    return () => window.clearTimeout(timer)
  }, [settings?.targetLanguage, sourceChoice])

  // 화면 밖으로 나가지 않게: 오른쪽이 넘치면 왼쪽으로 밀고, 아래가 넘치면 작업 줄 위로 올린다
  useLayoutEffect(() => {
    const card = cardRef.current
    // 끌어 옮긴 뒤에는 자동으로 밀지 않는다(옮긴 자리가 곧 자리)
    if (card === null || moved !== null) return
    const rect = card.getBoundingClientRect()
    if (rect.width === 0) return
    const baseLeft = rect.left - shift.x
    let x = Math.min(0, window.innerWidth - 8 - (baseLeft + rect.width))
    if (baseLeft + x < 8) x = 8 - baseLeft
    const up = shift.up || (rect.bottom > window.innerHeight - 8 && rect.top - rect.height > 8)
    if (Math.abs(x - shift.x) > 0.5 || up !== shift.up) setShift({ x, up })
  }, [state.status, shift.x, shift.up, original, moved])

  const resultText = state.status === 'result' ? state.translation.text : ''
  const copy = (text: string, message: string) => {
    void navigator.clipboard?.writeText(text)
    announceAction(message)
  }
  // 원문·번역 언어를 바꾸면 새 쌍으로 다시 번역한다(번역 언어는 번역 설정에, 원문 언어는 따로 기억한다)
  const applyPair = (pair: LanguagePair) => {
    if (settings === null) return
    const sourceChanged = pair.source !== sourceChoice
    const targetChanged = pair.target !== settings.targetLanguage
    if (!sourceChanged && !targetChanged) return
    pendingLanguageChange.current = true
    if (sourceChanged) setTranslationSource(pair.source)
    if (targetChanged) settings.onChangeTargetLanguage(pair.target)
  }
  const swap = () => {
    const pair = swapPair(sourceChoice, target, detected)
    if (pair !== null) applyPair(pair)
  }

  // 머리 줄을 잡고 끌어 옮긴다(단추·목록·글은 제외). 화면 밖으로는 나가지 않는다
  const onHeaderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const card = cardRef.current
    if (event.button !== 0 || card === null || isDragExempt(event.target)) return
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: moved?.x ?? shift.x,
      baseY: moved?.y ?? 0,
      rect: card.getBoundingClientRect(),
    }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 포인터를 잡지 못해도 끌기는 된다 */ }
  }
  const onHeaderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag === null) return
    const { dx, dy } = clampMoveToViewport(drag.rect, event.clientX - drag.startX, event.clientY - drag.startY)
    setMoved({ x: drag.baseX + dx, y: drag.baseY + dy })
  }
  const onHeaderPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return
    dragRef.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 이미 놓였다 */ }
  }

  const style: CSSProperties = {
    transform: moved !== null ? `translate(${moved.x}px, ${moved.y}px)` : shift.x === 0 ? undefined : `translateX(${shift.x}px)`,
    ...(shift.up ? { top: 'auto', bottom: 'calc(100% + 6px)' } : {}),
  }

  return (
    <div
      ref={cardRef}
      className="translation-card"
      role="region"
      aria-label={ariaLabel}
      style={style}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
    >
      <div
        className="translation-card-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerEnd}
        onPointerCancel={onHeaderPointerEnd}
      >
        {settings === null ? (
          <button
            type="button"
            className="translation-card-chip translation-card-lang"
            aria-label={t('번역 언어')}
            title={t('번역 설정 열기')}
            onClick={() => window.dispatchEvent(new Event(OPEN_TRANSLATION_SETTINGS_EVENT))}
          >
            <span>{detected === null ? t('원문') : languageLabel(detected)}</span>
            <ArrowRight size={12} aria-hidden="true" />
            <span>{target === '' ? '…' : languageLabel(target)}</span>
            <CaretDown size={10} weight="bold" aria-hidden="true" />
          </button>
        ) : (
          <TranslationLanguageBar
            source={sourceChoice}
            target={target}
            detected={detected}
            disabled={pending}
            onSourceChange={(code) => applyPair(pickSource({ source: sourceChoice, target }, code))}
            onTargetChange={(code) => applyPair(pickTarget({ source: sourceChoice, target }, code))}
            onSwap={swap}
          />
        )}
        <span className="translation-card-spacer" />
        {providerLabel === '' ? null : <span className="translation-card-provider" title={t('번역기')}>{providerLabel}</span>}
        <button type="button" className="translation-card-close" aria-label={t('닫기')} onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="translation-card-body">
        <p className="translation-card-original" title={normalizedOriginal}>{normalizedOriginal}</p>
        {state.status === 'result' ? (
          <p className="translation-card-translation" aria-label={t('번역 결과')}>{state.translation.text}</p>
        ) : null}
        {pending ? <p className="translation-card-pending" role="status">{t('번역 중…')}</p> : null}
        {state.status === 'error' ? (
          isTranslationNotConfigured(state.message)
            ? <p className="translation-card-error translation-card-setup" role="alert">{t('번역기를 아직 설정하지 않았습니다. 설정에서 번역기(키 없이 쓰는 Google 번역 포함)를 고르세요.')}</p>
            : <p className="translation-card-error" role="alert">{t('번역 실패: {message}', { message: friendlyCardError(state.message) })}</p>
        ) : null}
      </div>

      <div className="translation-card-footer">
        {state.status === 'error' ? (
          <button type="button" className={`translation-card-button${isTranslationNotConfigured(state.message) ? ' translation-card-primary' : ''}`} onClick={() => window.dispatchEvent(new Event(OPEN_TRANSLATION_SETTINGS_EVENT))}>
            {t('번역 설정 열기')}
          </button>
        ) : (
          <button type="button" className="translation-card-button" disabled={state.status !== 'result'} onClick={() => copy(resultText, t('번역을 복사했습니다'))}>
            <Copy size={13} aria-hidden="true" />
            {t('복사')}
          </button>
        )}
        {onSendToNote === undefined || state.status !== 'result' ? null : (
          <button type="button" className="translation-card-button translation-card-primary" onClick={onSendToNote}>
            <Plus size={13} weight="bold" aria-hidden="true" />
            {t('노트에 넣기')}
          </button>
        )}
        <button type="button" className="translation-card-button" disabled={pending} onClick={onRetry}>
          <ArrowClockwise size={13} aria-hidden="true" />
          {t('다시')}
        </button>
        <span className="translation-card-spacer" />
        {state.status === 'result' ? (
          <button
            type="button"
            className="translation-card-button"
            onClick={() => copy(`${normalizedOriginal}\n\n${resultText}`, t('원문과 함께 복사했습니다'))}
          >
            {t('원문과 함께 복사')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** 키·한도·지역 문제는 고칠 곳을 알려 주고, 나머지는 받은 메시지를 그대로 보인다 */
function friendlyCardError(message: string): string {
  const explained = explainTranslationError(message, /ollama/iu.test(message))
  return explained.kind === 'key' || explained.kind === 'quota' || explained.kind === 'region' ? explained.text : message
}
