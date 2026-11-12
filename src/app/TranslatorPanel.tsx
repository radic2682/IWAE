import { useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { ArrowClockwise, Copy, TextAa, Translate } from '@phosphor-icons/react'
import { announceAction } from './actionFeedback'
import { t } from '../i18n'
import { explainTranslationError, isTranslationNotConfigured } from '../core/translationErrors'
import { guessLanguage, normalizeSelectionText } from '../core/translationText'
import { OPEN_TRANSLATION_SETTINGS_EVENT, TranslationCardSettingsContext, useEffectiveTargetLanguage } from '../ui/TranslationCard'
import { TranslationLanguageBar } from '../ui/TranslationLanguageBar'
import { pickSource, pickTarget, setTranslationSource, sourceForNewText, swapPair, type LanguagePair } from '../ui/translationPair'
import { TranslatorContext } from './translatorContext'
import { useReaderSelection } from './readerSelectionStore'
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

/**
 * 번역기 탭의 내용(설계 5): 떠 있는 칸의 탭 하나다. 옮기기 · 크기 · 접기 · 닫기는 떠 있는 칸(머리와 모서리)이 하고,
 * 여기는 언어 줄 · 입력 · 번역 · 결과만 그린다. 예전에는 문서 칸 위에 스스로 떠 있는 창이었다.
 */
export function TranslatorPanel() {
  const service = useContext(TranslatorContext)
  const settings = useContext(TranslationCardSettingsContext)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
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

  return (
    <div
      className="translator-panel"
      role="region"
      aria-label={t('번역기')}
      onKeyDown={onPanelKey}
    >
      <div className="translator-panel-langs">
        {service === null || service.providerLabel === '' ? null : <span className="translator-panel-provider">{service.providerLabel}</span>}
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
  )
}
