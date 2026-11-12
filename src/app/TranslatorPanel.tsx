import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
import { ArrowClockwise, Copy, TextAa, Translate, X } from '@phosphor-icons/react'
import { announceAction } from './actionFeedback'
import { t } from '../i18n'
import { explainTranslationError, isTranslationNotConfigured } from '../core/translationErrors'
import { guessLanguage, normalizeSelectionText } from '../core/translationText'
import { OPEN_TRANSLATION_SETTINGS_EVENT, TranslationCardSettingsContext, useEffectiveTargetLanguage } from '../ui/TranslationCard'
import { TranslationLanguageBar } from '../ui/TranslationLanguageBar'
import { isDragExempt } from '../ui/dragExempt'
import { pickSource, pickTarget, setTranslationSource, swapPair, type LanguagePair } from '../ui/translationPair'
import { TranslatorContext } from './translatorContext'
import { useReaderSelection } from './readerSelectionStore'
import {
  PANEL_MARGIN,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  placePanel,
  updateTranslatorPanel,
  useTranslatorPanelState,
  type PanelBox,
  type TranslatorPanelKind,
} from './translatorPanelState'
import '../ui/translator-panel.css'

type ResultState =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'result'; readonly text: string; readonly model: string }
  | { readonly status: 'error'; readonly message: string }

/** 단추를 눌러도 문서에서 고른 글이 풀리지 않게 한다 */
const keepSelection = (event: SyntheticEvent) => event.preventDefault()

function friendlyError(message: string): string {
  const explained = explainTranslationError(message, /ollama/iu.test(message))
  return explained.kind === 'key' || explained.kind === 'quota' || explained.kind === 'region' ? explained.text : message
}

interface Gesture {
  readonly mode: 'move' | 'resize'
  readonly startX: number
  readonly startY: number
  readonly box: PanelBox
}

/**
 * 문서 칸 위에 떠 있는 번역기: 닫을 때까지 열려 있다. 머리 줄을 잡고 끌어 옮기고, 오른쪽 아래 모서리로 크기를 바꾼다.
 * 열림·자리·크기는 문서 종류(PDF · Markdown)마다 기억한다. 도구줄 단추가 열고 닫는다.
 */
export function TranslatorPanel({ kind }: { readonly kind: TranslatorPanelKind }) {
  const service = useContext(TranslatorContext)
  const settings = useContext(TranslationCardSettingsContext)
  const stored = useTranslatorPanelState(kind)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [bounds, setBounds] = useState<{ readonly width: number; readonly height: number }>({ width: 0, height: 0 })
  const [draft, setDraft] = useState<PanelBox | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const [input, setInput] = useState('')
  const [result, setResult] = useState<ResultState>({ status: 'idle' })
  const requestId = useRef(0)
  const pendingLanguageChange = useRef(false)
  const selection = useReaderSelection()
  const effective = useEffectiveTargetLanguage(input)
  const sourceChoice = effective.source
  const target = effective.target ?? ''
  const detected = guessLanguage(normalizeSelectionText(input))
  const pending = result.status === 'pending'

  // 문서 칸(부모) 크기를 따라간다: 칸이 줄어도 번역기는 칸 안에 머문다
  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement
    if (parent == null) return undefined
    const measure = () => setBounds({ width: parent.clientWidth, height: parent.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  const placed = placePanel(draft ?? stored, bounds)

  const translateNow = useCallback(async (text: string) => {
    const body = normalizeSelectionText(text)
    if (service === null || body === '' || effective.target === null) return
    const current = requestId.current + 1
    requestId.current = current
    setResult({ status: 'pending' })
    try {
      const translated = await service.translate(body, effective.sourceOverride, effective.target)
      if (requestId.current !== current) return
      setResult(translated === null
        ? { status: 'error', message: t('번역 결과를 받지 못했습니다.') }
        : { status: 'result', text: translated.text, model: translated.model })
    } catch (error) {
      if (requestId.current !== current) return
      setResult({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [service, effective.target, effective.sourceOverride])
  const translateRef = useRef(translateNow)
  translateRef.current = translateNow
  const inputValueRef = useRef(input)
  inputValueRef.current = input

  // 언어를 바꾸면 새 쌍(설정·원문 언어가 반영된 뒤)으로 지금 글을 다시 번역한다
  useEffect(() => {
    if (!pendingLanguageChange.current) return undefined
    pendingLanguageChange.current = false
    const timer = window.setTimeout(() => { void translateRef.current(inputValueRef.current) }, 0)
    return () => window.clearTimeout(timer)
  }, [settings?.targetLanguage, sourceChoice])

  const applyPair = (pair: LanguagePair) => {
    if (settings === null) return
    const sourceChanged = pair.source !== sourceChoice
    const targetChanged = pair.target !== settings.targetLanguage
    if (!sourceChanged && !targetChanged) return
    // 번역한 적이 있는 글만 다시 번역한다(빈 입력을 괜히 보내지 않는다)
    pendingLanguageChange.current = result.status !== 'idle' && input.trim() !== ''
    if (sourceChanged) setTranslationSource(pair.source)
    if (targetChanged) settings.onChangeTargetLanguage(pair.target)
  }
  const swap = () => {
    const pair = swapPair(sourceChoice, target, detected)
    if (pair !== null) applyPair(pair)
  }

  const onInputKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (!pending) void translateNow(input)
    }
  }
  // 고정된 창이라 Esc 는 닫지 않고 글쓰기 칸에서 포커스만 뺀다
  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  const copy = () => {
    if (result.status !== 'result') return
    void navigator.clipboard?.writeText(result.text)
    announceAction(t('번역을 복사했습니다'))
  }
  const insertSelection = () => {
    setInput(normalizeSelectionText(selection))
    setResult({ status: 'idle' })
    requestId.current += 1
    inputRef.current?.focus()
  }

  // 머리 줄 끌기 · 오른쪽 아래 모서리 크기 바꾸기. 칸 밖으로는 나가지 않는다
  const begin = (mode: Gesture['mode']) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (mode === 'move' && isDragExempt(event.target))) return
    event.preventDefault()
    gesture.current = { mode, startX: event.clientX, startY: event.clientY, box: placed }
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* 포인터를 잡지 못해도 끌기는 된다 */ }
  }
  const drag = (event: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (g === null) return
    const dx = event.clientX - g.startX
    const dy = event.clientY - g.startY
    if (g.mode === 'move') {
      setDraft(placePanel({ x: g.box.x + dx, y: g.box.y + dy, w: g.box.w, h: g.box.h }, bounds))
    } else {
      const w = Math.min(Math.max(g.box.w + dx, PANEL_MIN_WIDTH), bounds.width - PANEL_MARGIN - g.box.x)
      const h = Math.min(Math.max(g.box.h + dy, PANEL_MIN_HEIGHT), bounds.height - PANEL_MARGIN - g.box.y)
      setDraft(placePanel({ x: g.box.x, y: g.box.y, w, h }, bounds))
    }
  }
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (gesture.current === null) return
    gesture.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 이미 놓였다 */ }
    if (draft !== null) updateTranslatorPanel(kind, { x: draft.x, y: draft.y, w: draft.w, h: draft.h })
    setDraft(null)
  }

  // 닫히면 진행 중인 요청 결과는 버린다
  useEffect(() => () => { requestId.current += 1 }, [])

  const notConfigured = result.status === 'error' && isTranslationNotConfigured(result.message)

  return (
    <div
      ref={rootRef}
      className="translator-panel"
      role="dialog"
      aria-modal="false"
      aria-label={t('번역기')}
      style={{ left: placed.x, top: placed.y, width: placed.w, height: placed.h }}
      onKeyDown={onPanelKey}
    >
      <div
        className="translator-panel-header"
        onPointerDown={begin('move')}
        onPointerMove={drag}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <Translate size={15} aria-hidden="true" />
        <span className="translator-panel-title">{t('번역기')}</span>
        <span className="translator-panel-spacer" />
        {service === null || service.providerLabel === '' ? null : <span className="translator-panel-provider">{service.providerLabel}</span>}
        <button type="button" className="translator-panel-close" aria-label={t('번역기 닫기')} title={t('닫기')} onClick={() => updateTranslatorPanel(kind, { open: false })}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="translator-panel-langs">
        <TranslationLanguageBar
          source={sourceChoice}
          target={target}
          detected={detected}
          disabled={pending || settings === null}
          onSourceChange={(code) => applyPair(pickSource({ source: sourceChoice, target }, code))}
          onTargetChange={(code) => applyPair(pickTarget({ source: sourceChoice, target }, code))}
          onSwap={swap}
        />
        {selection.trim() === '' ? null : (
          <button
            type="button"
            className="translator-panel-button translator-panel-insert"
            title={t('문서에서 고른 글을 입력칸에 넣습니다')}
            onPointerDown={keepSelection}
            onMouseDown={keepSelection}
            onClick={insertSelection}
          >
            <TextAa size={13} aria-hidden="true" />
            {t('선택한 글 넣기')}
          </button>
        )}
      </div>

      <textarea
        ref={inputRef}
        className="translator-panel-input"
        aria-label={t('번역할 글')}
        placeholder={t('번역할 글을 쓰거나 붙여 넣으세요')}
        value={input}
        spellCheck={false}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={onInputKey}
      />

      <div className="translator-panel-actions">
        <button
          type="button"
          className="translator-panel-button translator-panel-primary"
          disabled={pending || input.trim() === ''}
          title={t('번역 (Ctrl+Enter)')}
          onClick={() => void translateNow(input)}
        >
          <Translate size={13} aria-hidden="true" />
          {t('번역')}
        </button>
        <span className="translator-panel-hint">Ctrl+Enter</span>
      </div>

      <div className="translator-panel-result" aria-live="polite">
        {result.status === 'result' ? (
          <p className="translator-panel-translation" aria-label={t('번역 결과')}>{result.text}</p>
        ) : null}
        {pending ? <p className="translator-panel-status" role="status">{t('번역 중…')}</p> : null}
        {result.status === 'error' ? (
          notConfigured
            ? <p className="translator-panel-error" role="alert">{t('번역기를 아직 설정하지 않았습니다. 설정에서 번역기(키 없이 쓰는 Google 번역 포함)를 고르세요.')}</p>
            : <p className="translator-panel-error" role="alert">{t('번역 실패: {message}', { message: friendlyError(result.message) })}</p>
        ) : null}
      </div>

      <div className="translator-panel-footer">
        {result.status === 'error' ? (
          <button type="button" className={`translator-panel-button${notConfigured ? ' translator-panel-primary' : ''}`} onClick={() => window.dispatchEvent(new Event(OPEN_TRANSLATION_SETTINGS_EVENT))}>
            {t('번역 설정 열기')}
          </button>
        ) : null}
        {result.status === 'error' ? (
          <button type="button" className="translator-panel-button" disabled={input.trim() === ''} onClick={() => void translateNow(input)}>
            <ArrowClockwise size={13} aria-hidden="true" />
            {t('다시')}
          </button>
        ) : null}
        <span className="translator-panel-spacer" />
        <button type="button" className="translator-panel-button" disabled={result.status !== 'result'} onClick={copy}>
          <Copy size={13} aria-hidden="true" />
          {t('복사')}
        </button>
      </div>

      <div
        className="translator-panel-resize"
        role="separator"
        aria-label={t('번역기 크기 바꾸기')}
        onPointerDown={begin('resize')}
        onPointerMove={drag}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  )
}
