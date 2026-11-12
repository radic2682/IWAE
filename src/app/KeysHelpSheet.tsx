import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { Keyboard, X } from '@phosphor-icons/react'
import { t } from '../i18n'
import { useFocusTrap } from '../ui/useFocusTrap'
import { commandUsages } from './workspaceCommands'
import '../ui/shortcuts.css'
import '../ui/status-bar.css'

/** 접두키 다음 키 한 줄. status: on 지금 된다 · partial 일부만 된다 · soon 다음 단계에서 된다 */
export interface PrefixKeyRow {
  readonly keys: string
  readonly action: string
  readonly command: string
  readonly status: 'on' | 'partial' | 'soon'
}

/** 접두키 다음 키(설계 8.2) */
export const PREFIX_KEY_ROWS: readonly PrefixKeyRow[] = [
  { keys: '% / "', action: '좌우 / 위아래로 나누기', command: 'split-window -h / -v', status: 'on' },
  { keys: '← ↑ → ↓ · o', action: '칸 이동 · 다음 칸', command: 'select-pane -L/-U/-R/-D', status: 'on' },
  { keys: 'z', action: '이 칸만 크게 / 되돌리기', command: 'resize-pane -Z', status: 'on' },
  { keys: 'x', action: '칸 닫기', command: 'kill-pane', status: 'on' },
  { keys: '!', action: '칸을 새 화면으로', command: 'break-pane', status: 'on' },
  { keys: '{ }', action: '칸 자리 바꾸기', command: 'swap-pane -U/-D', status: 'on' },
  { keys: 'Space', action: '배치 돌리기', command: 'select-layout', status: 'on' },
  { keys: 'q', action: '칸 번호 보이기, 숫자로 이동', command: 'display-panes', status: 'on' },
  { keys: 'c · , · &', action: '새 화면 · 화면 이름 · 화면 닫기', command: 'new-window · rename-window · kill-window', status: 'on' },
  { keys: 'n p l · 0–9', action: '다음 · 이전 · 마지막 화면 · 번호로', command: 'next-window … select-window -t N', status: 'on' },
  { keys: 'f · w', action: '떠 있는 칸 숨기기·보이기 · 떠 있는 번역기', command: 'toggle-floating · display-popup', status: 'on' },
  { keys: 's', action: '세션 목록', command: 'choose-session', status: 'on' },
  { keys: 'd', action: '이 앱 창 떼기', command: 'detach', status: 'on' },
  { keys: ':', action: '명령줄', command: '(상태 줄이 입력칸이 됩니다)', status: 'on' },
  { keys: '?', action: '키 목록', command: 'list-keys', status: 'on' },
]

/**
 * 아래 상태 줄의 「?」: 키와 명령 목록. 접두키 다음 키마다 지금 되는지(됩니다 · 일부만 · 다음 단계)를 표시한다.
 * 접두키 없이 되는 키는 위쪽에 따로 둔다.
 */
export function KeysHelpSheet({ onClose, currentKeys, prefixText = 'Ctrl+B' }: {
  readonly onClose: () => void
  /** 지금 되는 키(동작 이름 → 키 글자) */
  readonly currentKeys: readonly { readonly label: string; readonly keys: string }[]
  /** 지금 접두키 글자(설정에서 바꾼 키) */
  readonly prefixText?: string
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
          <section className="sko-group" aria-label={t('접두키 없이 되는 키')}>
            <h3>{t('접두키 없이 되는 키')}</h3>
            <ul>
              {currentKeys.map((row) => (
                <li key={row.label}><span>{row.label}</span><kbd className="keycap">{row.keys}</kbd></li>
              ))}
            </ul>
          </section>
          <section className="sko-group keys-help-prefix" aria-label={t('접두키 다음 키')}>
            <h3>{t('접두키 다음 키')}</h3>
            <p className="keys-help-note">{t('접두키({keys})를 누르고 손을 뗀 뒤 아래 키를 누릅니다. 2초 안에 누르지 않거나 Esc 를 누르면 그만둡니다. 입력기에 막히면 상태 줄의 「접두키」를 누르세요.', { keys: prefixText })}</p>
            <table className="keys-help-table">
              <thead>
                <tr><th scope="col">{t('키')}</th><th scope="col">{t('동작')}</th><th scope="col">{t('명령')}</th><th scope="col">{t('상태')}</th></tr>
              </thead>
              <tbody>
                {PREFIX_KEY_ROWS.map((row) => (
                  <tr key={row.keys}>
                    <td><kbd className="keycap">{row.keys}</kbd></td>
                    <td>{t(row.action)}</td>
                    <td><code>{row.command}</code></td>
                    <td><span className="keys-help-state" data-state={row.status}>{row.status === 'on' ? t('됩니다') : row.status === 'partial' ? t('일부만') : t('다음 단계')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="sko-group keys-help-commands" aria-label={t('명령줄 명령')}>
            <h3>{t('명령줄 명령')}</h3>
            <p className="keys-help-note">{t('「:」 로 상태 줄에서 치거나 명령 팔레트에 「:」 로 시작해서 칩니다. 「;」 로 여러 명령을 잇습니다. 예: split-window -h ; open 노트 A')}</p>
            <ul className="keys-help-commandlist">
              {commandUsages().map((usage) => <li key={usage}><code>{usage}</code></li>)}
            </ul>
          </section>
        </div>
        <footer className="sko-foot"><span>{t('Esc 로 닫기')}</span></footer>
      </div>
    </div>,
    document.body,
  )
}
