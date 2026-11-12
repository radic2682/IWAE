import { Fragment, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Keyboard, X } from '@phosphor-icons/react'
import { t } from '../i18n'
import { useFocusTrap } from '../ui/useFocusTrap'
import { commandUsages } from './workspaceCommands'
import '../ui/shortcuts.css'
import '../ui/keys-help.css'

/** 접두키 다음 키 한 줄. 지금 접두키는 모두 된다(예전의 「상태」 칸은 모든 줄이 「됨」 이라 없앴다) */
export interface PrefixKeyRow {
  readonly keys: string
  readonly action: string
  /** 명령 이름들. 하나하나가 한 덩어리라 줄이 꺾여도 명령 안에서는 꺾이지 않고 「 · 」 자리에서만 꺾인다 */
  readonly commands: readonly string[]
  /** 명령이 아닌 풀이: 있으면 명령 칸에 이것이 나온다(`:` 는 명령이 아니라 팔레트를 연다) */
  readonly note?: string
}

/** 접두키 다음 키(설계 8.2) */
export const PREFIX_KEY_ROWS: readonly PrefixKeyRow[] = [
  { keys: '% / "', action: '좌우 / 위아래로 나누기', commands: ['split-window -h / -v'] },
  { keys: '← ↑ → ↓ · o', action: '칸 이동 · 다음 칸', commands: ['select-pane -L/-U/-R/-D'] },
  { keys: 'z', action: '이 칸만 크게 / 원래 크기로', commands: ['resize-pane -Z'] },
  { keys: 'x', action: '칸 닫기', commands: ['kill-pane'] },
  { keys: '!', action: '칸을 새 화면으로', commands: ['break-pane'] },
  { keys: '{ }', action: '칸 자리 바꾸기', commands: ['swap-pane -U/-D'] },
  { keys: 'Space', action: '배치 돌리기', commands: ['select-layout'] },
  { keys: 'q', action: '칸 번호 보이기, 숫자로 이동', commands: ['display-panes'] },
  { keys: 'c · , · &', action: '새 화면 · 화면 이름 · 화면 닫기', commands: ['new-window', 'rename-window', 'kill-window'] },
  { keys: 'n p l · 0–9', action: '다음 · 이전 · 마지막 화면 · 번호로', commands: ['next-window', 'previous-window', 'last-window', 'select-window -t N'] },
  { keys: 'f · w', action: '떠 있는 칸 숨기기·보이기 · 번역기', commands: ['toggle-floating', 'display-popup'] },
  { keys: 's', action: '세션 목록', commands: ['choose-session'] },
  { keys: 'd', action: '이 앱 창 떼기', commands: ['detach'] },
  { keys: ':', action: '명령줄', commands: [], note: '명령 팔레트를 「:」 로 엽니다' },
  { keys: '?', action: '키 목록', commands: ['list-keys'] },
]

/** 동작 글: 「 · 」 로 나뉜 토막마다 한 덩어리(줄은 토막 사이에서만 꺾인다). 구분점은 앞 토막 끝에 붙는다 */
function ActionText({ text }: { readonly text: string }) {
  const parts = text.split(' · ')
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part}>
          {index > 0 ? ' ' : ''}
          <span className="keys-help-seg">{index < parts.length - 1 ? `${part} ·` : part}</span>
        </Fragment>
      ))}
    </>
  )
}

/**
 * 키와 명령 목록(접두키 ? · 명령 팔레트의 「키와 명령 보기」). 접두키 다음 키마다 동작과 명령을 보인다.
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
            <p className="keys-help-note">{t('접두키({keys})를 누르고 손을 뗀 뒤 아래 키를 누릅니다. 2초 안에 누르지 않거나 Esc 를 누르면 그만둡니다. 입력기에 막히면 명령 팔레트(Ctrl+K)에 「:」 로 시작해 같은 명령을 치세요.', { keys: prefixText })}</p>
            <table className="keys-help-table">
              <thead>
                <tr><th scope="col">{t('키')}</th><th scope="col">{t('동작')}</th><th scope="col">{t('명령')}</th></tr>
              </thead>
              <tbody>
                {PREFIX_KEY_ROWS.map((row) => (
                  <tr key={row.keys}>
                    <td><kbd className="keycap">{row.keys}</kbd></td>
                    <td><ActionText text={t(row.action)} /></td>
                    {/* 명령은 하나하나 줄이 꺾이지 않는 덩어리다. 꺾이는 곳은 「 · 」 뒤뿐 */}
                    <td className="keys-help-command">
                      {row.commands.length === 0 ? <span className="keys-help-command-note">{t(row.note ?? '')}</span> : row.commands.map((command, index) => (
                        <Fragment key={command}>
                          {index > 0 ? ' ' : ''}
                          <span className="keys-help-item"><code className="keys-help-cmd">{command}</code>{index < row.commands.length - 1 ? <span className="keys-help-sep" aria-hidden="true"> ·</span> : null}</span>
                        </Fragment>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="sko-group keys-help-commands" aria-label={t('명령줄 명령')}>
            <h3>{t('명령줄 명령')}</h3>
            <p className="keys-help-note">{t('「:」 를 누르면 명령 팔레트가 명령 목록과 함께 열립니다(↑ ↓ 로 고르고 Tab 으로 완성, Enter 로 실행, Alt+↑ ↓ 로 기록). 「;」 로 여러 명령을 잇습니다. 예: split-window -h ; open 노트 A')}</p>
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
