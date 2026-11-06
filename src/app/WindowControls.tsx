import { t } from '../i18n'
import { useEffect, useState, type ReactNode } from 'react'
import { closeWindow, minimizeWindow, toggleMaximizeWindow, watchMaximized } from '../bridge/window'

interface WindowControlsProps {
  onCloseWindow?: () => void
  /** 창 단추 왼쪽에 붙일 앱 단추(예: 메모 바 열기·닫기) */
  leading?: ReactNode
}

/* 창 단추는 앱의 다른 단추처럼 둥근 칩으로 그린다. 아이콘은 1px 선으로 직접 그려
   글꼴 아이콘보다 가늘고 또렷하게 — Windows 창 단추의 모양(─ □ ⧉ ✕)을 따른다. */
export function WindowControls({ onCloseWindow = closeWindow, leading }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let dispose: (() => void) | undefined
    let alive = true
    void watchMaximized((value) => {
      if (alive) setMaximized(value)
    }).then((stop) => {
      if (alive) dispose = stop
      else stop()
    })
    return () => {
      alive = false
      dispose?.()
    }
  }, [])

  return (
    <div className="wincontrols">
      {leading}
      <button type="button" className="winbtn" aria-label={t('최소화')} onClick={minimizeWindow}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5.5h8" />
        </svg>
      </button>
      <button
        type="button"
        className="winbtn"
        aria-label={maximized ? t('이전 크기로') : t('최대화')}
        onClick={toggleMaximizeWindow}
      >
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1" y="3" width="6" height="6" rx="1.2" />
            <path d="M3 3V2.2C3 1.5 3.5 1 4.2 1H7.8C8.5 1 9 1.5 9 2.2V5.8C9 6.5 8.5 7 7.8 7H7" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1.4" />
          </svg>
        )}
      </button>
      <button type="button" className="winbtn winbtn-close" aria-label={t('닫기')} onClick={onCloseWindow}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.8 1.8l6.4 6.4M8.2 1.8L1.8 8.2" />
        </svg>
      </button>
    </div>
  )
}
