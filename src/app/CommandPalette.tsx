import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileMd, FilePdf, MagnifyingGlass, TerminalWindow } from '@phosphor-icons/react'
import { t } from '../i18n'
import { canonicalCommandName, commandCatalog, type CommandCatalogEntry } from './workspace/workspaceCommands'
import { completeCommandLine, loadCommandHistory, pushCommandHistory, saveCommandHistory, stepCommandHistory, type CompletionContext } from './commandLine'
import { useFocusTrap } from '../ui/useFocusTrap'
import { imeKey } from '../ui/ime'
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
  /** 오른쪽에 흐리게 보이는 한 줄 풀이(명령줄 명령 목록) */
  readonly description?: string
  /** 명령줄 줄: 이 줄을 실행한다(기록에 남고, Tab 은 이 이름을 완성한다) */
  readonly line?: string
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
 * 명령줄의 첫 낱말(명령 이름)을 치는 동안(빈칸이 아직 없다)은 명령 목록이 뜬다: 「:」 만 치면 모든 명령(이름 · 사용법 · 한 줄 풀이)이,
 * 치는 대로 이름 · 줄임말 · 풀이에서 걸러진다. 맞는 것이 없으면 친 줄을 그대로 실행하는 한 줄(「명령 실행: …」)이다.
 *  - Tab: 고른 줄의 명령 이름을 완성한다(`select-window `). 첫 낱말이 끝나면(빈칸 뒤) 인자를 완성한다(화면 · 템플릿 이름 · select-layout 인자; 후보가 여럿이면 공통 앞부분까지 채우고 후보를 보인다).
 *  - Enter: 밝은(고른) 줄을 실행한다 — 늘 그 줄이다(「:」 만 쳤을 때는 ↓ 로 고르기 전에는 고른 줄이 없어 실행하지 않는다). 처음 밝은 줄은 맨 윗줄이고,
 *    친 낱말이 명령의 정식 이름 그대로이면 그 이름의 줄이다(줄임말 `:new` 는 맨 윗줄 — 줄임말이 밝은 줄과 다른 명령을 실행하지 않는다).
 *  - ↑/↓ 우선순위: 명령 목록이 보이는 동안은 고르기가 먼저다. 기록(최근 50줄)을 넘기는 것은 ① Alt+↑/↓ ② 목록이 안 보일 때(빈칸 뒤 · 맞는 명령 없음)
 *    ③ 목록 맨 윗줄(또는 고른 줄이 없을 때)에서 ↑ ④ 기록에서 불러온 줄이 떠 있는 동안이다. ④ 는 불러온 줄에서 ↑/↓ 가 계속 기록을 거닐게 하려는 것이고, 글을 고치면 끝난다.
 * 아래 상태 줄을 없애면서 `:` 명령줄은 이 팔레트 하나로 합쳤다(접두키 `:` 도 여기로 온다).
 */
/** 명령 목록 한 줄의 이름: 사용법에서 괄호 설명만 뗀다(`save-session [이름]  (이름이 없으면 …)`) */
const usageName = (usage: string): string => usage.split('  (')[0]!.trim()

/** 이름 · 줄임말 · 풀이에서 낱말이 맞는가(작을수록 앞): 이름 앞부분 · 줄임말 앞부분 · 이름 안 · 줄임말 안 · 풀이 안 */
export function matchCatalogEntry(entry: CommandCatalogEntry, word: string): number | null {
  const needle = word.trim().toLocaleLowerCase()
  if (needle === '') return 0
  const name = entry.name.toLocaleLowerCase()
  const aliases = entry.aliases.map((alias) => alias.toLocaleLowerCase())
  if (name.startsWith(needle)) return 0
  if (aliases.some((alias) => alias.startsWith(needle))) return 1
  if (name.includes(needle)) return 2
  if (aliases.some((alias) => alias.includes(needle))) return 3
  if (entry.summary.toLocaleLowerCase().includes(needle) || t(entry.summary).toLocaleLowerCase().includes(needle)) return 4
  return null
}

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
  // 「:」 만 쳤을 때는 고른 줄이 없다(-1): ↓ 로 고르기 전에 Enter 가 첫 명령을 실행하지 않게
  const [active, setActive] = useState(initialQuery === ':' ? -1 : 0)
  const [candidates, setCandidates] = useState<readonly string[]>([])
  const history = useRef<string[]>(loadCommandHistory())
  const cursor = useRef(history.current.length)
  const draft = useRef('')
  const listRef = useRef<HTMLUListElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // 닫히면 열기 전 자리로 초점이 돌아간다. 명령은 그 뒤에 실행되므로(run) 명령이 초점을 옮기면 그쪽이 이긴다
  useFocusTrap(dialogRef)

  const lineMode = query.startsWith(':') && onRunLine !== undefined
  // 첫 낱말(명령 이름)을 치는 중인가: 「:」 뒤에 빈칸이 아직 없다
  const typingName = lineMode && !/\s/u.test(query.slice(1).replace(/^\s+/u, ''))
  const catalog = useMemo(() => commandCatalog(), [])
  const shown = useMemo<readonly PaletteCommand[]>(() => {
    if (query.startsWith(':') && onRunLine !== undefined) {
      const line = query.slice(1).trim()
      if (typingName) {
        const rows = catalog
          .flatMap((entry, order) => { const score = matchCatalogEntry(entry, line); return score === null ? [] : [{ entry, score, order }] })
          .sort((a, b) => a.score - b.score || a.order - b.order)
        if (rows.length > 0) {
          return rows.map(({ entry }) => ({
            id: `line-${entry.name}`,
            kind: 'action' as const,
            label: usageName(entry.usage),
            description: t(entry.summary),
            line: entry.name,
            run: () => onRunLine(entry.name),
          }))
        }
      }
      const label = candidates.length > 1 ? candidates.join('  ') : t('명령 실행: {line}', { line })
      return [{ id: 'command-line', kind: 'action' as const, label, line, run: () => { if (line !== '') onRunLine(line) } }]
    }
    const scored = commands.flatMap((command) => {
      if (query.trim() === '' && command.kind !== 'action') return []
      const score = matchCommand(command, query)
      return score === null ? [] : [{ command, score }]
    })
    // 동작이 문서보다 먼저, 그 안에서는 앞에서 맞은 것부터
    scored.sort((a, b) => Number(a.command.kind !== 'action') - Number(b.command.kind !== 'action') || a.score - b.score)
    return scored.slice(0, 60).map(({ command }) => command)
  }, [commands, query, onRunLine, candidates, typingName, catalog])

  // 처음 고른 줄: 「:」 만이면 없음. 친 낱말이 명령의 정식 이름 그대로(줄임말이 아니다)이면 그 이름의 줄, 아니면 맨 윗줄.
  // Enter 는 늘 고른(밝은) 줄을 실행한다 — 줄임말(`:new`)이 밝은 줄(new-window)과 다른 명령(new-session)을 실행하는 일이 없다
  useEffect(() => {
    if (query === ':') { setActive(-1); return }
    const word = typingName ? query.slice(1).trim() : ''
    const exact = word !== '' && canonicalCommandName(word) === word ? shown.findIndex((command) => command.line === word && command.id !== 'command-line') : -1
    setActive(exact >= 0 ? exact : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 글이 바뀔 때만 다시 고른다(shown 은 같은 글에서 파생)
  }, [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (command: PaletteCommand | undefined) => {
    if (command === undefined) return
    // 명령줄은 실행하기로 한 순간 기록에 남는다(팔레트가 닫힌 뒤 실행되기 전에 다시 열어도 ↑ 로 나온다)
    if (command.line !== undefined && command.line !== '') {
      history.current = pushCommandHistory(history.current, command.line)
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
            placeholder={t('명령이나 문서 이름을 입력하세요')}
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
              if (imeKey(event)) return
              if (lineMode && event.key === 'Tab') {
                event.preventDefault()
                // 명령 이름을 치는 중이고 목록이 있으면 고른 줄의 이름을 완성한다
                const picked = typingName ? shown[active] : undefined
                if (picked?.line !== undefined && picked.id !== 'command-line') {
                  setQuery(`:${picked.line} `)
                  setCandidates([])
                  cursor.current = history.current.length
                  draft.current = `${picked.line} `
                  return
                }
                const result = completeCommandLine(query.slice(1).replace(/^ /u, ''), completion ?? { screenNames: [], templateNames: [] })
                setQuery(`:${result.text}`)
                setCandidates(result.candidates.length > 1 ? result.candidates : [])
                cursor.current = history.current.length
                draft.current = result.text
                return
              }
              // 목록이 보이는 동안(명령 이름을 치는 중) ↑/↓ 는 고르기다. 기록으로 가는 경우: Alt+↑/↓ · 목록이 없을 때 · 맨 윗줄에서 ↑ · 기록에서 불러온 줄이 떠 있을 때
              const listShown = typingName && shown.some((command) => command.id !== 'command-line')
              const recalled = cursor.current < history.current.length
              if (lineMode && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && (event.altKey || !listShown || recalled || (event.key === 'ArrowUp' && active <= 0))) {
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
              else if (event.key === 'Enter') {
                event.preventDefault()
                run(shown[active])
              }
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
                className={`command-palette-item${index === active ? ' command-palette-item-active' : ''}${command.description === undefined ? '' : ' command-palette-item-described'}`}
                onPointerMove={() => setActive(index)}
                onClick={() => run(command)}
              >
                {command.kind === 'pdf' ? <FilePdf size={15} aria-hidden="true" /> : command.kind === 'markdown' ? <FileMd size={15} aria-hidden="true" /> : <TerminalWindow size={15} aria-hidden="true" />}
                <span className="command-palette-label">{command.label}</span>
                {command.description === undefined ? null : <span className="command-palette-desc">{command.description}</span>}
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
