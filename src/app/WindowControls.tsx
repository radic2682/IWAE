import { t } from '../i18n'
import { useEffect, useState } from 'react'
import { closeWindow, minimizeWindow, toggleMaximizeWindow, watchMaximized } from '../bridge/window'
import { isMacPlatform } from '../core/platform'

interface WindowControlsProps {
  onCloseWindow?: () => void
}

/* 창 단추는 앱의 다른 단추처럼 둥근 칩으로 그린다. 아이콘은 1px 선으로 직접 그려
   글꼴 아이콘보다 가늘고 또렷하게 — Windows 창 단추의 모양(─ □ ⧉ ✕)을 따른다. */
export function WindowControls({ onCloseWindow = closeWindow }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    // 맥은 확대 단추를 시스템이 그리므로 창 크기를 지켜볼 필요가 없다
    if (isMacPlatform()) return
    let dispose: (() => void) | undefined
    let alive = true
    // 구독 해제는 한 번만, 실패해도 조용히. Tauri 는 이미 풀린(예: 화면을 다시 불러온 뒤) 구독을 또 풀면 예외를 던진다
    const stopOnce = (stop: () => void) => {
      try { stop() } catch { /* 이미 풀린 구독 */ }
    }
    void watchMaximized((value) => {
      if (alive) setMaximized(value)
    }).then((stop) => {
      if (alive) dispose = stop
      else stopOnce(stop)
    }, () => undefined)
    return () => {
      alive = false
      if (dispose !== undefined) stopOnce(dispose)
      dispose = undefined
    }
  }, [])

  // 맥은 왼쪽 위의 시스템 신호등 단추(닫기·최소화·확대)를 쓴다. 오른쪽에는 앱 단추만 남긴다
  if (isMacPlatform()) {
    return <div className="wincontrols wincontrols-mac" />
  }

  return (
    <div className="wincontrols">
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
