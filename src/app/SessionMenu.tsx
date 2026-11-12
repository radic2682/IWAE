import { useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowSquareOut, Check, FloppyDisk, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { PopupMenu } from './PopupMenu'
import { relativeTimeText, validateSessionName, type SessionSummary } from '../core/sessionNames'
import { clientCountText } from '../core/clients'
import { t } from '../i18n'

/** 세션 메뉴가 부르는 것들(App 이 useVault 의 sessionOps 에 잇는다). 결과의 ok 가 false 면 message 를 입력칸 아래에 보인다 */
export interface SessionMenuActions {
  readonly list: () => Promise<readonly SessionSummary[]>
  readonly onSwitch: (name: string) => Promise<{ readonly ok: boolean; readonly message: string }>
  readonly onNew: (name: string) => Promise<{ readonly ok: boolean; readonly message: string }>
  readonly onSaveAs: (name: string) => Promise<{ readonly ok: boolean; readonly message: string }>
  readonly onRename: (name: string) => Promise<{ readonly ok: boolean; readonly message: string }>
  /** 지금 세션을 지운다(확인 창은 바깥에서 띄운다) */
  readonly onDelete: () => void
  /** 지금 세션에 붙는 새 앱 창을 연다(new-client) */
  readonly onNewClient: () => void
}

/** 세션 줄 오른쪽 글: 「화면 2개 · 앱 창 2개 · 지금」 또는 「화면 3개 · 5분 전」 */
export function rowHint(row: SessionSummary, isCurrent: boolean, now: number): string {
  const parts = [t('화면 {n}개', { n: row.screenCount })]
  if ((row.attached ?? 0) > 0) parts.push(clientCountText(row.attached ?? 0))
  if (isCurrent) parts.push(t('지금'))
  else if (row.lastUsedAt !== null) parts.push(relativeTimeText(row.lastUsedAt, now))
  return parts.join(' · ')
}

type Mode = { readonly kind: 'list' } | { readonly kind: 'name'; readonly action: 'new' | 'saveAs' | 'rename' }

/**
 * 맨 위 줄 「<이름> ▾」 와 접두키 `s` 가 여는 세션 메뉴(설계 6): 세션 목록(화면 수 · 마지막으로 쓴 때) · 새 세션 · 다른 이름으로 저장 ·
 * 이름 바꾸기 · 삭제 · 앱 창으로 띄우기. 이름을 받는 동작은 메뉴 안의 입력칸으로 한다.
 */
export function SessionMenu({ current, left, top, anchorRef, actions, onClose }: {
  readonly current: string
  readonly left: number
  readonly top: number
  readonly anchorRef: RefObject<HTMLElement | null>
  readonly actions: SessionMenuActions
  readonly onClose: (restoreFocus: boolean) => void
}) {
  const [rows, setRows] = useState<readonly SessionSummary[] | null>(null)
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [value, setValue] = useState('')
  const [problem, setProblem] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  const [now] = useState(() => Date.now())
  useEffect(() => {
    let alive = true
    void actions.list().then((next) => { if (alive) setRows(next) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열릴 때 한 번
  }, [])
  useEffect(() => { if (mode.kind === 'name') input.current?.focus() }, [mode])
  const names = (rows ?? []).map((row) => row.name)
  const canDelete = names.length > 1

  const begin = (action: 'new' | 'saveAs' | 'rename') => {
    setProblem('')
    setValue(action === 'rename' ? current : action === 'saveAs' ? `${current} ${t('복사')}` : '')
    setMode({ kind: 'name', action })
  }
  const submit = async () => {
    if (mode.kind !== 'name') return
    const checked = validateSessionName(value, names, mode.action === 'rename' ? current : undefined)
    if (!checked.ok) { setProblem(checked.reason); return }
    const run = mode.action === 'new' ? actions.onNew : mode.action === 'saveAs' ? actions.onSaveAs : actions.onRename
    const result = await run(checked.name)
    if (result.ok) onClose(true)
    else setProblem(result.message)
  }

  return (
    <PopupMenu label={t('세션')} left={left} top={top} anchorRef={anchorRef} onClose={onClose}>
      {mode.kind === 'name' ? (
        <div className="session-menu-name">
          <div className="popup-menu-head" aria-hidden="true">{mode.action === 'new' ? t('새 세션') : mode.action === 'saveAs' ? t('다른 이름으로 저장') : t('이름 바꾸기')}</div>
          <input
            ref={input}
            className="session-menu-input"
            aria-label={t('세션 이름')}
            aria-invalid={problem !== ''}
            data-prefix-off=""
            spellCheck={false}
            autoComplete="off"
            value={value}
            placeholder={t('세션 이름')}
            onChange={(event) => { setValue(event.target.value); setProblem('') }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') { event.preventDefault(); void submit() }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMode({ kind: 'list' }) }
              // 메뉴의 화살표 이동이 입력칸 안의 커서 이동을 가로채지 않게
              if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') event.stopPropagation()
            }}
          />
          {problem === '' ? null : <div className="session-menu-problem" role="alert">{problem}</div>}
          <div className="session-menu-name-actions">
            <button type="button" role="menuitem" onClick={() => setMode({ kind: 'list' })}><span>{t('취소')}</span></button>
            <button type="button" role="menuitem" onClick={() => void submit()}><span>{t('확인')}</span></button>
          </div>
        </div>
      ) : (
        <>
          <div className="popup-menu-head" aria-hidden="true">{t('세션')}</div>
          {rows === null ? <div className="popup-menu-head" aria-hidden="true">{t('불러오는 중…')}</div> : rows.map((row) => (
            <button key={row.name} type="button" role="menuitem" aria-current={row.name === current ? 'true' : undefined} onClick={() => {
              if (row.name === current) { onClose(true); return }
              void actions.onSwitch(row.name).then((result) => { if (result.ok) onClose(true); else setProblem(result.message) })
            }}>
              {row.name === current ? <Check size={15} aria-hidden="true" /> : <span aria-hidden="true" style={{ flex: '0 0 15px' }} />}
              <span>{row.name}</span>
              <kbd className="session-menu-hint">{rowHint(row, row.name === current, now)}</kbd>
            </button>
          ))}
          {problem === '' ? null : <div className="session-menu-problem" role="alert">{problem}</div>}
          <div className="pane-tab-context-sep" role="separator" />
          <button type="button" role="menuitem" onClick={() => begin('new')}><Plus size={15} aria-hidden="true" /><span>{t('새 세션')}</span></button>
          <button type="button" role="menuitem" onClick={() => begin('saveAs')}><FloppyDisk size={15} aria-hidden="true" /><span>{t('다른 이름으로 저장')}</span><kbd className="session-menu-hint">save-session</kbd></button>
          <button type="button" role="menuitem" onClick={() => begin('rename')}><PencilSimple size={15} aria-hidden="true" /><span>{t('이름 바꾸기')}</span><kbd className="session-menu-hint">rename-session</kbd></button>
          <button type="button" role="menuitem" disabled={!canDelete} title={canDelete ? undefined : t('마지막 세션은 지울 수 없습니다')} onClick={() => { onClose(false); actions.onDelete() }}>
            <Trash size={15} aria-hidden="true" /><span>{t('삭제')}</span><kbd className="session-menu-hint">kill-session</kbd>
          </button>
          <div className="pane-tab-context-sep" role="separator" />
          <button type="button" role="menuitem" onClick={() => { onClose(false); actions.onNewClient() }}>
            <ArrowSquareOut size={15} aria-hidden="true" /><span>{t('앱 창으로 띄우기')}</span><kbd className="session-menu-hint">new-client</kbd>
          </button>
        </>
      )}
    </PopupMenu>
  )
}
