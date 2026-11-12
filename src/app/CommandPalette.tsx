import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileMd, FilePdf, MagnifyingGlass, TerminalWindow } from '@phosphor-icons/react'
import { t } from '../i18n'
import { completeCommandLine, loadCommandHistory, pushCommandHistory, saveCommandHistory, stepCommandHistory, type CompletionContext } from './commandLine'
import { useFocusTrap } from '../ui/useFocusTrap'
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
 * Ctrl+K(Ctrl+Shift+P) 명령 팔레트: 앱의 동작과 Vault 문서를 이름으로 찾아 바로 실행한다.
 * ↑↓ 로 고르고 Enter, Esc 로 닫는다. 검색어가 없으면 동작만, 있으면 문서도 함께 보인다.
 * 「:」 로 시작하면 명령줄이다: 나머지를 `:` 명령줄과 같은 명령으로 실행한다(`: split-window -h ; open 노트 A`).
 * 명령줄에서는 Tab 이 명령 · 화면 이름을 완성하고(후보가 여럿이면 공통 앞부분까지 채우고 후보를 보인다), ↑/↓ 가 최근 50줄 기록을 넘긴다.
 * 아래 상태 줄을 없애면서 `:` 명령줄은 이 팔레트 하나로 합쳤다(접두키 `:` 도 여기로 온다).
 */
export function CommandPalette({ commands, onClose, initialQuery = '', onRunLine, completion }: {
  readonly commands: readonly PaletteCommand[]
  readonly onClose: () => void
  readonly initialQuery?: string
  /** 「:」 로 시작한 줄을 실행한다(워크스페이스 명령 실행기) */
  readonly onRunLine?: (line: string) => void
  /** Tab 완성에 쓸 이름들(화면 · 세션 · 템플릿). 없으면 명령 이름만 완성한다 */
  readonly completion?: CompletionContext
}) {
  const [query, setQuery] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const [candidates, setCandidates] = useState<readonly string[]>([])
  const history = useRef<string[]>(loadCommandHistory())
  const cursor = useRef(history.current.length)
  const draft = useRef('')
  const listRef = useRef<HTMLUListElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // 닫히면 열기 전 자리로 초점이 돌아간다. 명령은 그 뒤에 실행되므로(run) 명령이 초점을 옮기면 그쪽이 이긴다
  useFocusTrap(dialogRef)

  const shown = useMemo(() => {
    if (query.startsWith(':') && onRunLine !== undefined) {
      const line = query.slice(1).trim()
      const label = candidates.length > 1 ? candidates.join('  ') : line === '' ? t('명령을 치세요: 예) split-window -h ; open 노트 A') : t('명령 실행: {line}', { line })
      return [{ id: 'command-line', kind: 'action' as const, label, run: () => { if (line !== '') onRunLine(line) } }]
    }
    const scored = commands.flatMap((command) => {
      if (query.trim() === '' && command.kind !== 'action') return []
      const score = matchCommand(command, query)
      return score === null ? [] : [{ command, score }]
    })
    // 동작이 문서보다 먼저, 그 안에서는 앞에서 맞은 것부터
    scored.sort((a, b) => Number(a.command.kind !== 'action') - Number(b.command.kind !== 'action') || a.score - b.score)
    return scored.slice(0, 60).map(({ command }) => command)
  }, [commands, query, onRunLine, candidates])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (command: PaletteCommand | undefined) => {
    if (command === undefined) return
    // 명령줄은 실행하기로 한 순간 기록에 남는다(팔레트가 닫힌 뒤 실행되기 전에 다시 열어도 ↑ 로 나온다)
    if (command.id === 'command-line' && query.slice(1).trim() !== '') {
      history.current = pushCommandHistory(history.current, query.slice(1).trim())
      saveCommandHistory(history.current)
    }
    onClose()
    // 팔레트가 닫힌 뒤에 실행한다(초점·단축키가 팔레트에 걸리지 않게)
    window.setTimeout(command.run, 0)
  }

  return createPortal(
    <div className="command-palette-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label={t('명령 팔레트')}>
        <div className="command-palette-field">
          <MagnifyingGlass size={16} aria-hidden="true" />
          <input
            autoFocus
            data-prefix-off=""
            aria-label={t('명령 찾기')}
            placeholder={t('명령이나 문서 이름을 치세요')}
            value={query}
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={shown[active] === undefined ? undefined : `command-${shown[active]!.id}`}
            onChange={(event) => {
              setQuery(event.target.value)
              setCandidates([])
              // 글을 고치면 기록을 넘기던 자리를 끝으로 돌리고 고친 글을 새 줄(draft)로 삼는다: 불러온 줄을 고친 뒤 ↓ 로 그 줄을 잃지 않는다
              cursor.current = history.current.length
              draft.current = event.target.value.startsWith(':') ? event.target.value.slice(1) : ''
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              const lineMode = query.startsWith(':') && onRunLine !== undefined
              if (lineMode && event.key === 'Tab') {
                event.preventDefault()
                const result = completeCommandLine(query.slice(1).replace(/^ /u, ''), completion ?? { screenNames: [], templateNames: [] })
                setQuery(`:${result.text}`)
                setCandidates(result.candidates.length > 1 ? result.candidates : [])
                cursor.current = history.current.length
                draft.current = result.text
                return
              }
              if (lineMode && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                event.preventDefault()
                if (cursor.current >= history.current.length) draft.current = query.slice(1)
                const step = stepCommandHistory(history.current, cursor.current, event.key === 'ArrowUp' ? 'up' : 'down', draft.current)
                cursor.current = step.cursor
                setQuery(`:${step.text}`)
                setCandidates([])
                return
              }
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
