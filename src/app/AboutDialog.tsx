import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import { openExternalUrl } from '../bridge/external'
import { t } from '../i18n'
import '../ui/about-dialog.css'

export const IWAE_REPOSITORY_URL = 'https://github.com/radic2682/IWAE'
/** 만든 사람의 블로그 */
export const AUTHOR_BLOG_URL = 'https://sunhong.dev'

/**
 * 정보 보기. 로고가 두 조각(파란 판 + 고리, 흰 판)으로 날아와 맞물리고, 끝에 원본 로고로 바뀐다.
 * 열 때마다 한 번 재생하고, 움직임 줄이기를 켠 사람에게는 바로 완성된 로고를 보인다.
 */
export function AboutDialog({ version, onClose, onShowHistory }: {
  readonly version: string
  readonly onClose: () => void
  /** 「업데이트 기록」: 설정의 업데이트 기록을 연다. 없으면 링크를 그리지 않는다 */
  readonly onShowHistory?: () => void
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  return createPortal(
    <div
      className="side-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        className="side-dialog about-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('IWAE 정보')}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }}
      >
        <button ref={closeRef} type="button" className="side-dialog-close about-close" aria-label={t('닫기')} onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
        <div className="about-logo" aria-hidden="true">
          <img className="about-logo-piece about-logo-back" src="/about/iwae-logo-back.png" alt="" />
          <img className="about-logo-piece about-logo-front" src="/about/iwae-logo-front.png" alt="" />
          <img className="about-logo-final" src="/iwae-logo.png" alt="" />
        </div>
        <h2 className="about-name">IWAE</h2>
        <p className="about-subtitle">{t('원문과 엮이는 PDF 노트')}</p>
        <p className="about-tagline">Interwoven Writing and Evidence</p>
        <p className="about-version">{t('버전 {version}', { version })}</p>
        {onShowHistory !== undefined ? (
          <button type="button" className="about-link about-history-link" onClick={onShowHistory}>{t('업데이트 기록')}</button>
        ) : null}
        <dl className="about-facts">
          <div><dt>{t('개발')}</dt><dd>radic2682</dd></div>
          <div>
            <dt>{t('블로그')}</dt>
            <dd>
              <button type="button" className="about-link" onClick={() => { void openExternalUrl(AUTHOR_BLOG_URL).catch(() => {}) }}>
                sunhong.dev
              </button>
            </dd>
          </div>
          <div><dt>{t('라이선스')}</dt><dd>MIT</dd></div>
          <div><dt>{t('만든 도구')}</dt><dd>Tauri 2 · React 19 · PDFium</dd></div>
          <div>
            <dt>{t('소스')}</dt>
            <dd>
              <button type="button" className="about-link" onClick={() => { void openExternalUrl(IWAE_REPOSITORY_URL).catch(() => {}) }}>
                github.com/radic2682/IWAE
              </button>
            </dd>
          </div>
        </dl>
      </div>
    </div>,
    document.body,
  )
}
