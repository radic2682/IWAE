import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileMd, FilePdf, MagnifyingGlass, TerminalWindow } from '@phosphor-icons/react'
import { t } from '../i18n'
import '../ui/command-palette.css'

export interface PaletteCommand {
  readonly id: string
  readonly label: string
  /** 오른쪽에 보이는 단축키 */
  readonly shortcut?: string
  /** 명령(동작)인가 문서 열기인가 */
  readonly kind: 'action' | 'pdf' | 'markdown'
  /** 찾을 때 함께 보는 말(영어 이름 등) */
  readonly keywords?: string
  readonly run: () => void
}

/** 낱말 순서대로 다 들어 있으면 맞다(「노트 새」도 「새 노트」를 찾는다). 앞에서 맞을수록 위로 */
export function matchCommand(command: PaletteCommand, query: string): number | null {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return 0
  const haystack = `${command.label} ${command.keywords ?? ''}`.toLocaleLowerCase()
  const words = needle.split(/\s+/u)
  if (!words.every((word) => haystack.includes(word))) return null
  const at = haystack.indexOf(words[0]!)
  return at === 0 ? 0 : 1 + at
}

/**
 * Ctrl+Shift+P 명령 팔레트: 앱의 동작과 Vault 문서를 이름으로 찾아 바로 실행한다.
 * ↑↓ 로 고르고 Enter, Esc 로 닫는다. 검색어가 없으면 동작만, 있으면 문서도 함께 보인다.
 */
export function CommandPalette({ commands, onClose }: {
  readonly commands: readonly PaletteCommand[]
  readonly onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)

  const shown = useMemo(() => {
    const scored = commands.flatMap((command) => {
      if (query.trim() === '' && command.kind !== 'action') return []
      const score = matchCommand(command, query)
      return score === null ? [] : [{ command, score }]
    })
    // 동작이 문서보다 먼저, 그 안에서는 앞에서 맞은 것부터
    scored.sort((a, b) => Number(a.command.kind !== 'action') - Number(b.command.kind !== 'action') || a.score - b.score)
    return scored.slice(0, 60).map(({ command }) => command)
  }, [commands, query])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (command: PaletteCommand | undefined) => {
    if (command === undefined) return
    onClose()
    // 팔레트가 닫힌 뒤에 실행한다(초점·단축키가 팔레트에 걸리지 않게)
    window.setTimeout(command.run, 0)
  }

  return createPortal(
    <div className="command-palette-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label={t('명령 팔레트')}>
        <div className="command-palette-field">
          <MagnifyingGlass size={16} aria-hidden="true" />
          <input
            autoFocus
            aria-label={t('명령 찾기')}
            placeholder={t('명령이나 문서 이름을 치세요')}
            value={query}
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={shown[active] === undefined ? undefined : `command-${shown[active]!.id}`}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
              else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, shown.length - 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }
              else if (event.key === 'Enter') { event.preventDefault(); run(shown[active]) }
            }}
          />
        </div>
        {shown.length === 0 ? (
          <p className="command-palette-empty">{t('맞는 명령이 없습니다')}</p>
        ) : (
          <ul ref={listRef} id="command-palette-list" className="command-palette-list" role="listbox" aria-label={t('명령')}>
            {shown.map((command, index) => (
              <li
                key={command.id}
                id={`command-${command.id}`}
                role="option"
                aria-selected={index === active}
                className={`command-palette-item${index === active ? ' command-palette-item-active' : ''}`}
                onPointerMove={() => setActive(index)}
                onClick={() => run(command)}
              >
                {command.kind === 'pdf' ? <FilePdf size={15} aria-hidden="true" /> : command.kind === 'markdown' ? <FileMd size={15} aria-hidden="true" /> : <TerminalWindow size={15} aria-hidden="true" />}
                <span className="command-palette-label">{command.label}</span>
                {command.shortcut === undefined ? null : <kbd className="command-palette-kbd">{command.shortcut}</kbd>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  )
}
