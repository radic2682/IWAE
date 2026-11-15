import { RELAYOUT_KINDS } from '../core/layoutTree'
import { canonicalCommandName, commandNames } from './workspace/workspaceCommands'

/**
 * 명령줄(`:`)의 기록과 탭 완성. DOM 을 모르는 순수 함수와 localStorage 읽기·쓰기만 둔다.
 */

export const COMMAND_HISTORY_KEY = 'iwae:command-history:v1'
export const COMMAND_HISTORY_MAX = 50

/** 저장된 기록(오래된 것이 앞). 깨졌으면 빈 목록 */
export function loadCommandHistory(storage: Pick<Storage, 'getItem'> | null = safeStorage()): string[] {
  try {
    const raw = storage?.getItem(COMMAND_HISTORY_KEY)
    if (raw === null || raw === undefined) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((line): line is string => typeof line === 'string' && line.trim() !== '').slice(-COMMAND_HISTORY_MAX) : []
  } catch {
    return []
  }
}

export function saveCommandHistory(history: readonly string[], storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(COMMAND_HISTORY_KEY, JSON.stringify(history.slice(-COMMAND_HISTORY_MAX)))
  } catch { /* 저장 못 해도 이번 실행에서는 쓴다 */ }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** 기록에 한 줄을 더한다: 앞뒤 공백을 떼고, 같은 줄은 맨 뒤로 옮기며, 최근 50줄만 남긴다. 빈 줄은 더하지 않는다 */
export function pushCommandHistory(history: readonly string[], line: string): string[] {
  const text = line.trim()
  if (text === '') return [...history]
  return [...history.filter((entry) => entry !== text), text].slice(-COMMAND_HISTORY_MAX)
}

/**
 * ↑/↓ 로 기록을 넘긴다. cursor 는 history.length(= 새 줄을 쓰는 중)에서 시작한다.
 * 돌려주는 text 는 칸에 넣을 글자, draft 는 새 줄에 쓰던 글자(↓ 로 끝까지 오면 되돌린다).
 */
export function stepCommandHistory(history: readonly string[], cursor: number, direction: 'up' | 'down', draft: string): { readonly cursor: number; readonly text: string } {
  const next = direction === 'up' ? Math.max(cursor - 1, 0) : Math.min(cursor + 1, history.length)
  return { cursor: next, text: next >= history.length ? draft : history[next]! }
}

export interface CompletionContext {
  /** 화면 이름들(번호 순) */
  readonly screenNames: readonly string[]
  /** 세션 이름들(없으면 빈 목록) */
  readonly sessionNames?: readonly string[]
  /** 화면 템플릿 이름들 */
  readonly templateNames: readonly string[]
}

export interface Completion {
  /** 완성한 줄(후보가 없으면 입력 그대로) */
  readonly text: string
  /** 이어질 수 있는 후보들 */
  readonly candidates: readonly string[]
}

function commonPrefix(words: readonly string[]): string {
  let prefix = words[0] ?? ''
  for (const word of words) {
    let at = 0
    while (at < prefix.length && at < word.length && prefix[at]!.toLocaleLowerCase() === word[at]!.toLocaleLowerCase()) at += 1
    prefix = prefix.slice(0, at)
  }
  return prefix
}

interface ScannedWord {
  /** 입력에 쓴 그대로(따옴표 포함) */
  readonly raw: string
  /** 따옴표를 벗긴 낱말 */
  readonly value: string
  /** 따옴표를 열고 아직 닫지 않았으면 그 따옴표 */
  readonly open: '"' | "'" | null
}

/** 따옴표(' ")를 지키며 마지막 `;`(따옴표 밖) 뒤의 낱말들을 읽는다. 마지막 낱말은 쓰는 중일 수 있다 */
function scanLastCommand(input: string): { readonly head: string; readonly lead: string; readonly words: readonly ScannedWord[]; readonly typing: boolean } {
  let headEnd = 0
  let words: ScannedWord[] = []
  let quote: '"' | "'" | null = null
  let start = -1
  let value = ''
  const finish = (end: number) => {
    if (start < 0) return
    words.push({ raw: input.slice(start, end), value, open: quote })
    start = -1
    value = ''
  }
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!
    if (quote !== null) {
      if (char === quote) quote = null
      else value += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; if (start < 0) start = index; continue }
    if (char === ';') { finish(index); words = []; headEnd = index + 1; continue }
    if (/\s/u.test(char)) { finish(index); continue }
    if (start < 0) start = index
    value += char
  }
  const typing = start >= 0
  finish(input.length)
  const segment = input.slice(headEnd)
  return { head: input.slice(0, headEnd), lead: /^\s*/u.exec(segment)![0], words, typing }
}

/**
 * Tab 완성: 줄의 마지막 `;`(따옴표 밖) 뒤에서, 첫 낱말은 명령 이름으로, `-t`/`-s` 뒤나 템플릿·배치·색을 받는 명령의 인자는 그 목록으로 채운다.
 * 후보가 하나면 끝에 빈칸을 붙인다. 여럿이면 공통 앞부분까지만 채우고 후보를 돌려준다. 따옴표 안의 글도 이어서 완성한다.
 */
export function completeCommandLine(input: string, context: CompletionContext): Completion {
  const { head, lead, words, typing } = scanLastCommand(input)
  const last = typing ? words[words.length - 1] : undefined
  const current = last?.value ?? ''
  const open = last?.open ?? null
  const done = typing ? words.slice(0, -1) : words
  const before = done.map((word) => word.value)
  const rebuild = (completed: string, close: boolean) => `${head}${lead}${[...done.map((word) => word.raw), completed].join(' ')}${close ? ' ' : ''}`
  // 이름에 빈칸이 든 후보(「읽기 2」)는 따옴표로 감싼다(이미 연 따옴표가 있으면 그것을 이어 쓴다)
  const spell = (word: string, close: boolean): string => {
    const quote = open ?? (/\s|;/u.test(word) ? '"' : null)
    if (quote === null) return word
    return close ? `${quote}${word}${quote}` : `${quote}${word}`
  }

  let pool: readonly string[] = []
  if (before.length === 0) {
    pool = commandNames()
  } else {
    const command = canonicalCommandName(before[0]!)
    const previous = before[before.length - 1]!
    if (command === 'select-window' && (previous === '-t' || before.length === 1)) pool = context.screenNames
    else if (command === 'join-pane' && previous === '-s') pool = context.screenNames
    else if (command === 'new-window' && previous === '-t') pool = context.templateNames
    else if (command === 'switch-client' && (previous === '-t' || before.length === 1)) pool = context.sessionNames ?? []
    else if (command === 'kill-session' && previous === '-t') pool = context.sessionNames ?? []
    else if (command === 'apply-template' && before.length === 1) pool = context.templateNames
    else if (command === 'select-layout' && before.length === 1) pool = RELAYOUT_KINDS
    else if (command === 'set-channel' && before.length === 1) pool = ['blue', 'green', 'orange', 'none']
  }
  const needle = current.toLocaleLowerCase()
  const candidates = pool.filter((word) => word.toLocaleLowerCase().startsWith(needle))
  if (candidates.length === 0) return { text: input, candidates: [] }
  const text = candidates.length === 1 ? rebuild(spell(candidates[0]!, true), true) : rebuild(spell(commonPrefix(candidates), false), false)
  return { text, candidates }
}
