import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Keyboard, X } from '@phosphor-icons/react'
import { t } from '../../i18n'
import { GROUP_LABEL, GROUP_ORDER, SHORTCUT_DEFS, effectiveKeys } from '../../core/shortcutRegistry'
import { useFocusTrap } from '../../ui/useFocusTrap'
import { KeyCaps } from '../KeyCaps'
import { matchesShortcutQuery } from './ShortcutSettings'
import { useAppPrefs } from '../appPrefs'
import '../../ui/shortcuts.css'

/**
 * 「단축키 보기」: 지금 걸려 있는 단축키를 한눈에(설정에서 바꾼 키 반영). Ctrl+/ 로 열고 Esc 로 닫는다.
 * 초점은 상자 안에 갇혔다가 닫으면 열기 전 자리로 돌아간다. 바꾸는 곳은 설정 「단축키·마우스」.
 */
export function ShortcutOverlay({ onClose, onOpenSettings }: { readonly onClose: () => void; readonly onOpenSettings: () => void }) {
  const { shortcuts } = useAppPrefs()
  const [query, setQuery] = useState('')
  const dialog = useRef<HTMLDivElement | null>(null)
  useFocusTrap(dialog)
  const visible = useMemo(() => SHORTCUT_DEFS.filter((def) => matchesShortcutQuery(def, query, shortcuts)), [query, shortcuts])

  return createPortal(
    <div className="sko-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div
        ref={dialog}
        className="sko"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sko-title"
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
          <h2 id="sko-title">{t('단축키 보기')}</h2>
          <input
            type="search"
            className="sko-search"
            value={query}
            placeholder={t('단축키 찾기')}
            aria-label={t('단축키 찾기')}
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <button type="button" className="sko-close" aria-label={t('닫기')} onClick={onClose}><X size={16} weight="bold" aria-hidden="true" /></button>
        </header>
        <div className="sko-body">
          {GROUP_ORDER.map((group) => {
            const defs = visible.filter((def) => def.group === group)
            if (defs.length === 0) return null
            return (
              <section key={group} className="sko-group" aria-label={t(GROUP_LABEL[group])}>
                <h3>{t(GROUP_LABEL[group])}</h3>
                <ul>
                  {defs.map((def) => {
                    const keys = effectiveKeys(def, shortcuts)
                    return (
                      <li key={def.id}>
                        <span>{t(def.label)}</span>
                        <KeyCaps combo={keys[0] ?? null} empty={t('없음')} />
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
          {visible.length === 0 ? <p className="sk-empty">{t('맞는 단축키가 없습니다')}</p> : null}
        </div>
        <footer className="sko-foot">
          <span>{t('Esc로 닫기')}</span>
          <button type="button" className="translation-cache-clear" onClick={() => { onClose(); onOpenSettings() }}>{t('설정에서 바꾸기')}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
