import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowCounterClockwise, Lock, MagnifyingGlass } from '@phosphor-icons/react'
import { t } from '../../i18n'
import {
  GROUP_LABEL, GROUP_ORDER, PREFIX_KEY_ID, SHORTCUT_DEFS, comboText, normalizeCombo, effectiveKeys, eventToCombo, findConflict, isCustomized, isRebindable, isSafeBinding,
  withBinding, withSwap, withoutBinding, type ShortcutDef, type ShortcutOverrides,
} from '../../core/shortcutRegistry'
import { KeyCaps } from '../KeyCaps'
import { setAppPref, useAppPrefs } from '../appPrefs'
import '../../ui/shortcuts.css'

type Notice =
  | { readonly kind: 'conflict'; readonly id: string; readonly combo: string; readonly other: ShortcutDef }
  | { readonly kind: 'info'; readonly text: string }

/** 다른 곳(첫 실행의 「접두키 고르기」 창의 「직접 정하기…」)이 부탁한 키 녹음: 목록이 그려지면 바로 그 줄의 녹음을 연다 */
let pendingRecording: string | null = null
const RECORD_EVENT = 'iwae:record-shortcut'
export function requestShortcutRecording(id: string): void {
  pendingRecording = id
  window.dispatchEvent(new Event(RECORD_EVENT))
}

/** 접두키로 고를 수 있는 키(Ctrl+B 가 기본, tmux 와 같다). 직접 정하기는 위의 키 칸 */
export const PREFIX_PRESETS: readonly string[] = ['Ctrl+B', 'Ctrl+Space', 'Ctrl+A']
export const PREFIX_DEFAULT_PRESET = 'Ctrl+B'

/** 검색어에 맞는가(이름·영어 낱말·키 글자) */
export function matchesShortcutQuery(def: ShortcutDef, query: string, overrides: ShortcutOverrides): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return true
  const keys = effectiveKeys(def, overrides).map((combo) => comboText(combo))
  const haystack = `${t(def.label)} ${def.label} ${def.keywords ?? ''} ${keys.join(' ')}`.toLocaleLowerCase()
  return needle.split(/\s+/u).every((word) => haystack.includes(word))
}

/** 설정 「단축키·마우스」의 단축키 목록: 검색, 눌러서 바꾸기(Esc 취소·Backspace 지움), 충돌 안내와 서로 바꾸기, 기본값으로 */
export function ShortcutSettings() {
  const { shortcuts } = useAppPrefs()
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts
  const triggers = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => {
    const take = () => { if (pendingRecording === null) return; const id = pendingRecording; pendingRecording = null; setNotice(null); setRecording(id) }
    take()
    window.addEventListener(RECORD_EVENT, take)
    return () => window.removeEventListener(RECORD_EVENT, take)
  }, [])

  const commit = (next: ShortcutOverrides) => setAppPref('shortcuts', next)
  const stopRecording = (id: string) => {
    setRecording(null)
    window.setTimeout(() => triggers.current.get(id)?.focus(), 0)
  }

  // 녹음 중에는 모든 키를 이 목록이 가로챈다(앱 단축키·설정 창 Esc 보다 먼저)
  useEffect(() => {
    if (recording === null) return
    const id = recording
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return // 초점 이동은 그대로
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat) return
      const bare = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      if (event.key === 'Escape' && bare) { setNotice(null); stopRecording(id); return }
      if (event.key === 'Backspace' && bare) {
        commit(withBinding(shortcutsRef.current, id, ''))
        setNotice({ kind: 'info', text: t('「{name}」의 키를 지웠습니다', { name: t(SHORTCUT_DEFS.find((def) => def.id === id)?.label ?? id) }) })
        stopRecording(id)
        return
      }
      const combo = eventToCombo(event)
      if (combo === null) return // Ctrl·Shift 만 누른 상태: 더 기다린다
      if (!isSafeBinding(combo)) {
        setNotice({ kind: 'info', text: t('글자 키 하나만으로는 정할 수 없습니다. Ctrl(⌘)이나 Alt와 함께 누르세요.') })
        return
      }
      const other = findConflict(id, combo, shortcutsRef.current)
      if (other !== null) {
        setNotice({ kind: 'conflict', id, combo, other })
        stopRecording(id)
        return
      }
      commit(withBinding(shortcutsRef.current, id, combo))
      setNotice(null)
      stopRecording(id)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

  const visible = useMemo(() => SHORTCUT_DEFS.filter((def) => matchesShortcutQuery(def, query, shortcuts)), [query, shortcuts])
  const anyCustom = Object.keys(shortcuts).length > 0

  return (
    <div className="sk">
      <div className="sk-tools">
        <label className="sk-search">
          <MagnifyingGlass size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={t('단축키 찾기')}
            aria-label={t('단축키 찾기')}
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <button type="button" className="translation-cache-clear" disabled={!anyCustom} onClick={() => { commit({}); setNotice({ kind: 'info', text: t('모든 단축키를 기본값으로 되돌렸습니다') }); setRecording(null) }}>
          {t('모두 기본값으로')}
        </button>
      </div>
      <p className="sk-hint">{t('키 칸을 누른 뒤 새 조합을 누르세요. Esc는 취소, Backspace는 키 지우기입니다.')}</p>
      <div className="sk-notice-slot" role="status" aria-live="polite">
        {notice === null ? null : notice.kind === 'info' ? (
          <p className="sk-notice">{notice.text}</p>
        ) : (
          <div className="sk-notice sk-notice-conflict">
            <span>
              {isRebindable(notice.other)
                ? t('{keys}: 이미 「{name}」에 쓰이는 키입니다.', { keys: comboText(notice.combo), name: t(notice.other.label) })
                : t('{keys}: 편집기 고정 키 「{name}」입니다. 다른 조합을 고르세요.', { keys: comboText(notice.combo), name: t(notice.other.label) })}
            </span>
            {isRebindable(notice.other) ? (
              <button type="button" className="sk-notice-button" onClick={() => {
                commit(withSwap(shortcutsRef.current, notice.id, notice.combo))
                setNotice({ kind: 'info', text: t('두 단축키를 서로 바꿨습니다') })
              }}>{t('서로 바꾸기')}</button>
            ) : null}
            <button type="button" className="sk-notice-button" onClick={() => setNotice(null)}>{t('취소')}</button>
          </div>
        )}
      </div>
      {GROUP_ORDER.map((group) => {
        const defs = visible.filter((def) => def.group === group)
        if (defs.length === 0) return null
        return (
          <section key={group} className="sk-group" aria-label={t(GROUP_LABEL[group])}>
            <h4>{t(GROUP_LABEL[group])}</h4>
            <ul className="sk-list">
              {defs.map((def) => {
                const rebindable = isRebindable(def)
                const keys = effectiveKeys(def, shortcuts)
                const isRecording = recording === def.id
                const name = t(def.label)
                return (
                  <li key={def.id} className="sk-row">
                    <span className="sk-name">{name}</span>
                    {rebindable ? (
                      <>
                        <button
                          type="button"
                          ref={(element) => { if (element === null) triggers.current.delete(def.id); else triggers.current.set(def.id, element) }}
                          className={`sk-keys${isRecording ? ' sk-keys-recording' : ''}`}
                          aria-label={isRecording ? t('{name}: 새 키 조합을 누르세요', { name }) : t('{name}: 현재 {keys}. 눌러서 바꾸기', { name, keys: keys[0] === undefined ? t('없음') : comboText(keys[0]) })}
                          onClick={() => { setNotice(null); setRecording(isRecording ? null : def.id) }}
                          onBlur={() => { if (isRecording) setRecording(null) }}
                        >
                          {isRecording ? <span className="sk-recording-text">{t('키를 누르세요…')}</span> : <KeyCaps combo={keys[0] ?? null} empty={t('없음')} />}
                        </button>
                        <button
                          type="button"
                          className="sk-reset"
                          aria-label={t('{name}: 기본값으로', { name })}
                          title={t('기본값으로')}
                          data-off={isCustomized(def.id, shortcuts) ? undefined : ""}
                          tabIndex={isCustomized(def.id, shortcuts) ? 0 : -1}
                          onClick={() => { commit(withoutBinding(shortcutsRef.current, def.id)); setNotice(null); triggers.current.get(def.id)?.focus() }}
                        >
                          <ArrowCounterClockwise size={13} aria-hidden="true" />
                        </button>
                        {def.id !== PREFIX_KEY_ID ? null : (
                          <div className="sk-presets" role="group" aria-label={t('접두키 고르기')}>
                            {PREFIX_PRESETS.map((preset) => {
                              const normalized = normalizeCombo(preset)
                              const chosen = normalized !== null && keys[0] === normalized
                              return (
                                <Fragment key={preset}>
                                <button
                                  type="button"
                                  className={`sk-preset${chosen ? ' sk-preset-on' : ''}`}
                                  aria-pressed={chosen}
                                  onClick={() => { commit(withBinding(shortcutsRef.current, PREFIX_KEY_ID, preset)); setNotice(null) }}
                                >{preset}</button>
                                {preset === PREFIX_DEFAULT_PRESET ? <span className="sk-preset-default">{t('기본(tmux)')}</span> : null}
                                </Fragment>
                              )
                            })}
                            <span className="sk-preset-note">{t('Ctrl+B를 고르면 글 쓰는 곳에서는 Ctrl+B를 두 번 눌러야 굵게가 됩니다. 입력기가 Ctrl+Space를 쓰면 다른 키를 고르세요.')}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="sk-fixed" title={t('편집기에서 쓰는 키라 바꿀 수 없습니다')}>
                        <span className="sk-keys sk-keys-locked">
                          {keys.slice(0, 2).map((combo, index) => <span key={combo} className="sk-alt">{index > 0 ? <span className="sk-or">{t('또는')}</span> : null}<KeyCaps combo={combo} empty={t('없음')} /></span>)}
                        </span>
                        <Lock size={12} aria-label={t('바꿀 수 없음')} />
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
      {visible.length === 0 ? <p className="sk-empty">{t('맞는 단축키가 없습니다')}</p> : null}
    </div>
  )
}
