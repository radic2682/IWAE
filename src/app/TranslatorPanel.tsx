import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowClockwise, Copy, TextAa, Translate, X } from '@phosphor-icons/react'
import { announceAction } from './actionFeedback'
import { t } from '../i18n'
import { explainTranslationError, isTranslationNotConfigured } from '../core/translationErrors'
import { guessLanguage, normalizeSelectionText } from '../core/translationText'
import { OPEN_TRANSLATION_SETTINGS_EVENT, TranslationCardSettingsContext, useEffectiveTargetLanguage } from '../ui/TranslationCard'
import { TranslationLanguageBar } from '../ui/TranslationLanguageBar'
import { pickSource, pickTarget, setTranslationSource, sourceForNewText, swapPair, type LanguagePair } from '../ui/translationPair'
import { isDragExempt } from '../ui/dragExempt'
import { TranslatorContext } from './translatorContext'
import { useReaderSelection } from './readerSelectionStore'
import { PANEL_MIN_HEIGHT, PANEL_MIN_WIDTH, placePanel, updateTranslatorWindow, useTranslatorWindow, type PanelBox } from './translatorPanelState'
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

/** 상단바 높이(--bar-h): 번역기는 이 아래에만 놓인다 */
const TOPBAR_H = 36

interface Gesture {
  readonly mode: 'move' | 'resize'
  readonly startX: number
  readonly startY: number
  readonly box: PanelBox
}

/**
 * 번역기: 앱 창 전체에 떠 있는 창이다. 칸이나 탭에 붙지 않아서 창 안 어디로든 옮길 수 있고(상단바 아래 · 창 가장자리 안쪽),
 * 머리 줄을 잡고 끌어 옮기고 오른쪽 아래 모서리로 크기를 바꾼다. 열림 · 자리 · 크기는 창 하나에 하나만 기억한다.
 * 도구줄의 번역기 단추(와 접두키 w · display-popup)가 열고 닫는다. 닫혀 있으면 아무것도 그리지 않는다.
 */
export function TranslatorPanel() {
  const stored = useTranslatorWindow()
  if (!stored.open) return null
  return createPortal(<TranslatorWindow stored={stored} />, document.body)
}

function TranslatorWindow({ stored }: { readonly stored: ReturnType<typeof useTranslatorWindow> }) {
  const service = useContext(TranslatorContext)
  const settings = useContext(TranslationCardSettingsContext)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  // 앱 창 크기(창을 줄여도 번역기는 창 안에 머문다)
  const [bounds, setBounds] = useState<{ readonly width: number; readonly height: number }>(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useLayoutEffect(() => {
    const measure = () => setBounds((current) => (current.width === window.innerWidth && current.height === window.innerHeight ? current : { width: window.innerWidth, height: window.innerHeight }))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  const [draft, setDraft] = useState<PanelBox | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const placed = placePanel(draft ?? stored, { ...bounds, top: TOPBAR_H })
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

  // fresh: 사람이 번역을 눌렀다(언어를 바꿔 다시 번역하는 것이 아님). 기억한 원문 언어가 글과 다르면 자동 감지로 돌린다
  const translateNow = useCallback(async (text: string, fresh = false) => {
    const body = normalizeSelectionText(text)
    if (service === null || body === '' || effective.target === null) return
    const current = requestId.current + 1
    requestId.current = current
    setResult({ status: 'pending' })
    try {
      const translated = await service.translate(body, fresh ? sourceForNewText(body, effective.sourceOverride) : effective.sourceOverride, effective.target)
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
  // 방향 바꾸기: 보통 번역기처럼 번역 결과를 입력으로 옮기고 거꾸로 번역한다(결과가 없으면 언어만 바꾼다)
  const swap = () => {
    const pair = swapPair(sourceChoice, target, detected)
    if (pair === null) return
    if (result.status === 'result' && result.text.trim() !== '') {
      setInput(result.text)
      inputValueRef.current = result.text
    }
    applyPair(pair)
  }

  const onInputKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (!pending) void translateNow(input, true)
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

  // 닫히면 진행 중인 요청 결과는 버린다
  useEffect(() => () => { requestId.current += 1 }, [])

  const notConfigured = (result.status === 'error' && isTranslationNotConfigured(result.message)) || service === null

  // 머리 줄 끌기 · 오른쪽 아래 모서리 크기 바꾸기. 창 밖으로는 나가지 않는다
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
    const area = { ...bounds, top: TOPBAR_H }
    if (g.mode === 'move') {
      setDraft(placePanel({ x: g.box.x + dx, y: g.box.y + dy, w: g.box.w, h: g.box.h }, area))
    } else {
      const w = Math.min(Math.max(g.box.w + dx, PANEL_MIN_WIDTH), bounds.width - g.box.x - 6)
      const h = Math.min(Math.max(g.box.h + dy, PANEL_MIN_HEIGHT), bounds.height - g.box.y - 6)
      setDraft(placePanel({ x: g.box.x, y: g.box.y, w, h }, area))
    }
  }
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (gesture.current === null) return
    gesture.current = null
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* 이미 놓였다 */ }
    if (draft !== null) updateTranslatorWindow({ x: draft.x, y: draft.y, w: draft.w, h: draft.h })
    setDraft(null)
  }

  return (
    <div
      className="translator-window"
      role="dialog"
      aria-modal="false"
      aria-label={t('번역기')}
      style={{ left: placed.x, top: placed.y, width: placed.w, height: placed.h }}
      onKeyDown={onPanelKey}
    >
      <div
        className="translator-window-head"
        onPointerDown={begin('move')}
        onPointerMove={drag}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <Translate size={16} aria-hidden="true" />
        <span className="translator-window-title">{t('번역기')}</span>
        <span className="translator-panel-spacer" />
        {service === null || service.providerLabel === '' ? null : <span className="translator-panel-provider">{service.providerLabel}</span>}
        <button type="button" className="translator-window-close" aria-label={t('번역기 닫기')} title={t('닫기')} onClick={() => updateTranslatorWindow({ open: false })}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    <div
      className="translator-panel"
      role="region"
      aria-label={t('번역기')}
    >
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
          onClick={() => void translateNow(input, true)}
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
        {notConfigured && result.status !== 'error' ? (
          <p className="translator-panel-error" role="alert">{t('번역기를 아직 설정하지 않았습니다. 설정에서 번역기(키 없이 쓰는 Google 번역 포함)를 고르세요.')}</p>
        ) : null}
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
          <button type="button" className="translator-panel-button" disabled={input.trim() === ''} onClick={() => void translateNow(input, true)}>
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
    </div>
      <div
        className="translator-window-resize"
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
