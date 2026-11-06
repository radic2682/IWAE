import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowClockwise, Sun } from '@phosphor-icons/react'
import { backgroundOf, withBackground, type PdfBackground, type PdfRotation, type PdfViewPrefs } from '../core/pdfViewPrefs'
import { t } from '../i18n'

const BACKGROUNDS: readonly (readonly [PdfBackground, string])[] = [
  ['normal', '기본'], ['night', '야간'], ['sepia', '양피지'], ['green', '눈 보호'],
]

interface PdfViewMenuProps {
  readonly prefs: PdfViewPrefs
  readonly rotation: PdfRotation
  readonly onPrefsChange: (prefs: PdfViewPrefs) => void
  readonly onRotate: () => void
}

/** PDF 하단 막대의 ☀ — 페이지 배경(기본·야간·양피지·눈 보호)과 회전 */
/**
 * 창은 문서에 직접 띄운다(portal). 하단 막대는 가로 스크롤을 위해 `overflow: hidden` 이고
 * 흐림 효과(backdrop-filter)가 새 쌓임 맥락을 만들어서, 그 안에 두면 창이 잘리거나 PDF
 * 페이지 밑에 깔려 눌리지 않는다.
 */
export function PdfViewMenu({ prefs, rotation, onPrefsChange, onRotate }: PdfViewMenuProps) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ right: number; bottom: number }>({ right: 8, bottom: 56 })
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const toggle = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect !== undefined) setAnchor({ right: Math.max(window.innerWidth - rect.right, 8), bottom: window.innerHeight - rect.top + 8 })
    setOpen((value) => !value)
  }
  return (
    <div className="pdf-view-menu">
      <button
        ref={buttonRef}
        type="button"
        className="bottombar-btn"
        aria-label={t('배경 모드')}
        title={t('배경 모드·회전')}
        aria-expanded={open}
        onClick={toggle}
      >
        <Sun size={16} aria-hidden="true" />
      </button>
      {open ? createPortal(
        <>
          <div className="pdf-view-menu-backdrop" onClick={() => setOpen(false)} />
          <div
            className="pdf-view-menu-panel"
            style={{ right: anchor.right, bottom: anchor.bottom }}
            role="dialog"
            aria-label={t('배경 모드')}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
            }}
          >
            <div className="pdf-view-menu-row pdf-view-menu-backgrounds" role="radiogroup" aria-label={t('배경')}>
              {BACKGROUNDS.map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={backgroundOf(prefs) === value} onClick={() => onPrefsChange(withBackground(prefs, value))}>
                  <span className={`pdf-view-menu-swatch pdf-view-menu-swatch-${value}`} aria-hidden="true" />
                  {t(label)}
                </button>
              ))}
            </div>
            <button type="button" className="pdf-view-menu-item" aria-label={t('시계 방향으로 회전')} onClick={onRotate}>
              <ArrowClockwise size={14} aria-hidden="true" />
              <span>{t('시계 방향으로 회전')}</span>
              <span className="pdf-view-menu-value">{rotation}°</span>
            </button>
            {rotation !== 0 ? <p className="pdf-view-menu-note">{t('회전 중에는 보기 전용입니다')}</p> : null}
          </div>
        </>,
        document.body,
      ) : null}
    </div>
  )
}
