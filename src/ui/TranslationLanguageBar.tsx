import { ArrowsLeftRight } from '@phosphor-icons/react'
import { t } from '../i18n'
import { AUTO_SOURCE, TRANSLATION_LANGUAGES } from './translationPair'
import './translation-language-bar.css'

export interface TranslationLanguageBarProps {
  /** 'auto' 또는 언어 코드 */
  readonly source: string
  readonly target: string
  /** 글자로 어림한 원문 언어(없으면 null). 자동일 때 맞바꿈이 쓴다 */
  readonly detected: string | null
  readonly disabled?: boolean
  readonly onSourceChange: (code: string) => void
  readonly onTargetChange: (code: string) => void
  readonly onSwap: () => void
}

/** [원문 ▾] ⇄ [번역 ▾]: 번역 카드와 번역기가 함께 쓴다 */
export function TranslationLanguageBar({ source, target, detected, disabled = false, onSourceChange, onTargetChange, onSwap }: TranslationLanguageBarProps) {
  const swapBlocked = source === AUTO_SOURCE && (detected === null || detected === target)
  const swapTitle = swapBlocked ? t('원문 언어를 어림할 수 없어 바꿀 수 없습니다. 원문 언어를 직접 고르세요.') : t('원문과 번역 언어 바꾸기')
  return (
    <div className="translation-lang-bar" role="group" aria-label={t('번역 언어')} data-no-drag>
      <select
        className="translation-lang-select"
        aria-label={t('원문 언어')}
        value={source}
        disabled={disabled}
        onChange={(event) => onSourceChange(event.target.value)}
      >
        <option value={AUTO_SOURCE}>{t('자동 감지')}</option>
        {TRANSLATION_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
      </select>
      <button
        type="button"
        className="translation-lang-swap"
        aria-label={t('원문과 번역 언어 바꾸기')}
        title={swapTitle}
        disabled={disabled || swapBlocked}
        onClick={onSwap}
      >
        <ArrowsLeftRight size={14} aria-hidden="true" />
      </button>
      <select
        className="translation-lang-select"
        aria-label={t('번역할 언어')}
        value={target}
        disabled={disabled}
        onChange={(event) => onTargetChange(event.target.value)}
      >
        {TRANSLATION_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
      </select>
    </div>
  )
}
