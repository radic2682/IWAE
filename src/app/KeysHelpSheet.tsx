import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Keyboard, X } from '@phosphor-icons/react'
import { t } from '../i18n'
import { useFocusTrap } from '../ui/useFocusTrap'
import '../ui/shortcuts.css'
import '../ui/status-bar.css'

/** 접두키 다음 키(설계 8.2). 접두키 자체는 다음 단계에서 켜진다 */
export const PREFIX_KEY_ROWS: readonly { readonly keys: string; readonly action: string; readonly command: string }[] = [
  { keys: '% / "', action: '좌우 / 위아래로 나누기', command: 'split-window -h / -v' },
  { keys: '← ↑ → ↓ · o', action: '칸 이동 · 다음 칸', command: 'select-pane -L/-U/-R/-D' },
  { keys: 'z', action: '이 칸만 크게 / 되돌리기', command: 'resize-pane -Z' },
  { keys: 'x', action: '칸 닫기', command: 'kill-pane' },
  { keys: '!', action: '칸을 새 화면으로', command: 'break-pane' },
  { keys: '{ }', action: '칸 자리 바꾸기', command: 'swap-pane -U/-D' },
  { keys: 'Space', action: '배치 돌리기', command: 'select-layout' },
  { keys: 'q', action: '칸 번호 보이기, 숫자로 이동', command: 'display-panes' },
  { keys: 'c · , · &', action: '새 화면 · 화면 이름 · 화면 닫기', command: 'new-window · rename-window · kill-window' },
  { keys: 'n p l · 0–9', action: '다음 · 이전 · 마지막 화면 · 번호로', command: 'next-window … select-window -t N' },
  { keys: 'f · w', action: '떠 있는 칸 숨기기·보이기 · 떠 있는 번역기', command: 'toggle-floating · display-popup' },
  { keys: 's · d', action: '세션 목록 · 이 앱 창 떼기', command: 'choose-session · detach' },
  { keys: ': · ?', action: '명령줄 · 키 목록', command: 'list-keys' },
]

/**
 * 아래 상태 줄의 「?」: 키와 명령 목록. 접두키 다음 키는 아직 동작하지 않아 「다음 단계」로 표시한다.
 * 지금 되는 키는 위쪽에 따로 둔다.
 */
export function KeysHelpSheet({ onClose, currentKeys }: {
  readonly onClose: () => void
  /** 지금 되는 키(동작 이름 → 키 글자) */
  readonly currentKeys: readonly { readonly label: string; readonly keys: string }[]
}) {
  const dialog = useRef<HTMLDivElement | null>(null)
  useFocusTrap(dialog)
  return createPortal(
    <div className="sko-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div
        ref={dialog}
        className="sko keys-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keys-help-title"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          onClose()
        }}
      >
        <header className="sko-head">
          <Keyboard size={18} aria-hidden="true" />
          <h2 id="keys-help-title">{t('키와 명령')}</h2>
          <button type="button" className="sko-close" aria-label={t('닫기')} onClick={onClose}><X size={16} weight="bold" aria-hidden="true" /></button>
        </header>
        <div className="sko-body">
          <section className="sko-group" aria-label={t('지금 되는 키')}>
            <h3>{t('지금 되는 키')}</h3>
            <ul>
              {currentKeys.map((row) => (
                <li key={row.label}><span>{row.label}</span><kbd className="keycap">{row.keys}</kbd></li>
              ))}
            </ul>
          </section>
          <section className="sko-group keys-help-prefix" aria-label={t('접두키 다음 키')}>
            <h3>{t('접두키 다음 키')}<span className="keys-help-soon">{t('다음 단계')}</span></h3>
            <p className="keys-help-note">{t('접두키(기본 Ctrl+Space)를 누르고 손을 뗀 뒤 아래 키를 누릅니다. 아직 켜지지 않았습니다.')}</p>
            <table className="keys-help-table">
              <thead>
                <tr><th scope="col">{t('키')}</th><th scope="col">{t('동작')}</th><th scope="col">{t('명령')}</th></tr>
              </thead>
              <tbody>
                {PREFIX_KEY_ROWS.map((row) => (
                  <tr key={row.keys}>
                    <td><kbd className="keycap">{row.keys}</kbd></td>
                    <td>{t(row.action)}</td>
                    <td><code>{row.command}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <footer className="sko-foot"><span>{t('Esc 로 닫기')}</span></footer>
      </div>
    </div>,
    document.body,
  )
}
