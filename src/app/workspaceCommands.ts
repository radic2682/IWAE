import {
  leaves, MAX_PANES, parseRelayoutKind, RELAYOUT_KINDS, layoutRects, removeLeaf, splitLeaf, splitRefusal, swapLeaves,
  type RelayoutKind, type SplitDir, type SplitRefusal,
} from '../core/layoutTree'
import { t } from '../i18n'
import { blankScreen, activeScreenOf, addScreen, breakPane, closeScreen, lastScreenOf, renameScreen, setZoomed, stepScreen, switchScreen, withActiveWorkspace, workspaceOf, type Screen, type ScreensState } from './screens'
import { closePaneTree, type PaneSizer } from './tabDock'
import { selectLayout, splitPane } from './paneLayoutOps'
import { tabsOf } from './tabs'
import { channelOf, pruneChannels, withChannel, type PaneChannel } from './workspaceChannels'
import type { LayoutPresetId, ScreenTemplateId } from './layoutPresets'

/**
 * `:` 명령줄과 접두키가 같이 쓰는 명령(설계 8.3). 이 파일은 DOM·React 를 모른다:
 *  - 줄을 읽는 파서(`parseCommandLine`: 줄임말 · `;` · 옵션 · 따옴표),
 *  - 보는 화면의 칸·화면에 닿는 순수 동작(`WorkspaceModel` → 새 `WorkspaceModel`),
 *  - 문서 열기·템플릿처럼 앱이 해야 하는 일은 `CommandHost` 의 손잡이로 넘긴다.
 */

// ── 모델 ──────────────────────────────────────────────────────────────────────

/** 명령이 읽고 바꾸는 장면: 모든 화면과 만지는 칸(보는 화면의 칸) */
export interface WorkspaceModel {
  readonly screens: ScreensState
  readonly activePane: string
}

export interface CommandResult {
  readonly ok: boolean
  /** 사용자에게 보일 말(성공은 대개 빈 글자) */
  readonly message: string
}

export interface PaneRect {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export interface NamedTemplate {
  readonly id: ScreenTemplateId
  readonly label: string
}

/** 앱이 채워 주는 손잡이. 비어 있으면 그 명령은 「지금은 안 됩니다」로 답한다 */
export interface CommandHost {
  getModel: () => WorkspaceModel
  setModel: (model: WorkspaceModel) => void
  /** 칸의 지금 크기(px). 없으면 칸이 너무 작은지는 따지지 않는다 */
  sizeOf?: PaneSizer
  /** 칸 사각형(px). 없으면 나누기 트리의 비율 사각형으로 방향을 찾는다 */
  paneRects?: () => ReadonlyMap<string, PaneRect> | null
  /** 이름이 없는 새 화면의 이름 */
  blankScreenName: (count: number) => string
  /** 고를 수 있는 화면 템플릿(이름으로 찾는다) */
  templates: () => readonly NamedTemplate[]
  /** `;` 로 이은 명령 사이에서, 앞 명령이 바꾼 앱 상태가 반영되도록 기다린다 */
  settle?: () => Promise<void>
  newWindowFromTemplate?: (id: ScreenTemplateId, name: string | undefined, pane: string) => Promise<void>
  applyTemplate?: (id: LayoutPresetId, pane: string) => Promise<void>
  open?: (query: string, pane: string) => Promise<CommandResult>
  noteBeside?: (pane: string) => Promise<void>
  displayPanes?: () => void
  listKeys?: () => void
  /** 상태 줄을 명령줄로 연다(미리 채울 글) */
  promptCommand?: (prefill: string) => void
  /** 「화면을 닫을까요? y/n」 */
  confirmKillWindow?: () => void
  showSessionMenu?: () => void
}

// ── 명령 표 ───────────────────────────────────────────────────────────────────

interface CommandSpec {
  readonly name: string
  readonly aliases?: readonly string[]
  /** 값을 받는 옵션(`-t 3`) */
  readonly valueFlags?: readonly string[]
  /** 값 없는 옵션(`-h`) */
  readonly boolFlags?: readonly string[]
  /** 다음 단계에서 되는 명령 */
  readonly soon?: boolean
  /** 짧은 설명(목록·완성에 쓴다) */
  readonly usage: string
}

export const COMMAND_SPECS: readonly CommandSpec[] = [
  { name: 'split-window', aliases: ['splitw'], boolFlags: ['h', 'v'], usage: 'split-window [-h|-v]' },
  { name: 'select-pane', aliases: ['selectp'], boolFlags: ['L', 'R', 'U', 'D', 'n', 'p'], valueFlags: ['t'], usage: 'select-pane -L|-R|-U|-D|-t N' },
  { name: 'resize-pane', aliases: ['resizep'], boolFlags: ['Z'], usage: 'resize-pane -Z' },
  { name: 'kill-pane', aliases: ['killp'], usage: 'kill-pane' },
  { name: 'swap-pane', aliases: ['swapp'], boolFlags: ['U', 'D'], usage: 'swap-pane -U|-D' },
  { name: 'break-pane', aliases: ['breakp'], usage: 'break-pane' },
  { name: 'join-pane', aliases: ['joinp'], boolFlags: ['h', 'v'], valueFlags: ['s'], usage: 'join-pane -s N' },
  { name: 'new-window', aliases: ['neww'], valueFlags: ['n', 't'], usage: 'new-window [-n 이름] [-t 템플릿]' },
  { name: 'select-window', aliases: ['selectw'], valueFlags: ['t'], usage: 'select-window -t N|이름' },
  { name: 'next-window', aliases: ['next', 'nextw'], usage: 'next-window' },
  { name: 'previous-window', aliases: ['prev', 'prevw'], usage: 'previous-window' },
  { name: 'last-window', aliases: ['last', 'lastw'], usage: 'last-window' },
  { name: 'rename-window', aliases: ['renamew'], usage: 'rename-window 이름' },
  { name: 'kill-window', aliases: ['killw'], usage: 'kill-window' },
  { name: 'select-layout', aliases: ['selectl'], usage: 'select-layout even-horizontal|even-vertical|main-vertical|main-horizontal|tiled' },
  { name: 'display-panes', aliases: ['displayp'], usage: 'display-panes' },
  { name: 'list-keys', aliases: ['lsk'], usage: 'list-keys' },
  { name: 'open', usage: 'open 이름' },
  { name: 'set-channel', usage: 'set-channel blue|green|orange|none' },
  { name: 'note-beside', usage: 'note-beside' },
  { name: 'apply-template', usage: 'apply-template 이름' },
  // 접두키 표가 쓰는 안쪽 명령(목록·완성에는 보이지 않는다)
  { name: 'command-prompt', usage: 'command-prompt' },
  { name: 'rename-prompt', usage: 'rename-prompt' },
  { name: 'confirm-kill-window', usage: 'confirm-kill-window' },
  { name: 'choose-session', usage: 'choose-session' },
  // 다음 단계
  { name: 'new-session', aliases: ['new'], soon: true, usage: 'new-session' },
  { name: 'switch-client', aliases: ['switchc'], valueFlags: ['t'], soon: true, usage: 'switch-client -t 이름' },
  { name: 'save-session', soon: true, usage: 'save-session' },
  { name: 'rename-session', soon: true, usage: 'rename-session' },
  { name: 'float-pane', soon: true, usage: 'float-pane' },
  { name: 'embed-pane', soon: true, usage: 'embed-pane' },
  { name: 'toggle-floating', soon: true, usage: 'toggle-floating' },
  { name: 'display-popup', aliases: ['popup'], soon: true, usage: 'display-popup' },
  { name: 'new-client', soon: true, usage: 'new-client' },
  { name: 'detach', aliases: ['detach-client'], soon: true, usage: 'detach' },
]

const INTERNAL_COMMANDS: ReadonlySet<string> = new Set(['command-prompt', 'rename-prompt', 'confirm-kill-window', 'choose-session'])

const SPEC_BY_WORD = new Map<string, CommandSpec>()
for (const spec of COMMAND_SPECS) {
  SPEC_BY_WORD.set(spec.name, spec)
  for (const alias of spec.aliases ?? []) SPEC_BY_WORD.set(alias, spec)
}

/** 줄임말이나 이름 → 정식 이름(모르면 null) */
export function canonicalCommandName(word: string): string | null {
  return SPEC_BY_WORD.get(word)?.name ?? null
}

/** 사용자에게 보여 줄 명령 이름들(안쪽 명령은 뺀다). 완성·목록이 쓴다 */
export function commandNames(options: { readonly includeSoon?: boolean } = {}): string[] {
  return COMMAND_SPECS.filter((spec) => !INTERNAL_COMMANDS.has(spec.name) && (options.includeSoon === true || spec.soon !== true)).map((spec) => spec.name)
}

/** 지금 되는 명령의 한 줄 설명(`?` 목록과 도움말) */
export function commandUsages(): string[] {
  return COMMAND_SPECS.filter((spec) => !INTERNAL_COMMANDS.has(spec.name) && spec.soon !== true).map((spec) => spec.usage)
}

// ── 파서 ──────────────────────────────────────────────────────────────────────

export interface ParsedCommand {
  /** 정식 이름 */
  readonly name: string
  /** 입력에 쓴 낱말(오류 안내용) */
  readonly word: string
  /** 옵션: 값 없는 옵션은 true */
  readonly flags: Readonly<Record<string, string | true>>
  /** 옵션이 아닌 낱말들 */
  readonly args: readonly string[]
  readonly soon: boolean
}

export type ParseResult =
  | { readonly ok: true; readonly commands: readonly ParsedCommand[] }
  | { readonly ok: false; readonly message: string }

/** 줄을 `;` 로 끊고 따옴표(' ")를 지키며 낱말로 자른다. 따옴표를 닫지 않았으면 null */
export function splitCommandLine(line: string): string[][] | null {
  const commands: string[][] = []
  let current: string[] = []
  let token = ''
  let started = false
  let quote: '"' | "'" | null = null
  const pushToken = () => {
    if (started) current.push(token)
    token = ''
    started = false
  }
  const pushCommand = () => {
    pushToken()
    if (current.length > 0) commands.push(current)
    current = []
  }
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!
    if (quote !== null) {
      if (char === quote) quote = null
      else token += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue }
    if (char === '\\' && line[index + 1] === ';') { token += ';'; started = true; index += 1; continue }
    if (char === ';') { pushCommand(); continue }
    if (/\s/u.test(char)) { pushToken(); continue }
    token += char
    started = true
  }
  if (quote !== null) return null
  pushCommand()
  return commands
}

export function parseCommandLine(line: string): ParseResult {
  const text = line.trim().replace(/^:/u, '').trim()
  if (text === '') return { ok: false, message: t('명령이 비었습니다') }
  const groups = splitCommandLine(text)
  if (groups === null) return { ok: false, message: t('따옴표가 닫히지 않았습니다') }
  const commands: ParsedCommand[] = []
  for (const words of groups) {
    const [word, ...rest] = words as [string, ...string[]]
    const spec = SPEC_BY_WORD.get(word)
    if (spec === undefined) return { ok: false, message: t('모르는 명령: {name} — ? 로 목록', { name: word }) }
    const flags: Record<string, string | true> = {}
    const args: string[] = []
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index]!
      // 옵션: `-h`, `-t 3`, 붙여 쓴 `-t3`. 명령의 글 인자(이름 등)에서 `-` 로 시작하는 낱말은 첫 옵션 뒤에서만 옵션으로 읽는다
      if (/^-[A-Za-z]/u.test(token)) {
        const letter = token[1]!
        if (spec.valueFlags?.includes(letter) === true) {
          const attached = token.slice(2)
          const value = attached !== '' ? attached : rest[index + 1]
          if (value === undefined) return { ok: false, message: t('{name}: -{flag} 에 값이 필요합니다', { name: spec.name, flag: letter }) }
          flags[letter] = value
          if (attached === '') index += 1
          continue
        }
        if (spec.boolFlags?.includes(letter) === true && token.length === 2) { flags[letter] = true; continue }
        if (spec.soon === true) continue
        return { ok: false, message: t('{name}: 모르는 옵션 {flag}', { name: spec.name, flag: token }) }
      }
      args.push(token)
    }
    commands.push({ name: spec.name, word, flags, args, soon: spec.soon === true })
  }
  return { ok: true, commands }
}

// ── 이름으로 찾기 ─────────────────────────────────────────────────────────────

const lower = (text: string) => text.toLocaleLowerCase()

/** 이름 맞추기 순위(작을수록 좋다, 안 맞으면 null): 같음 < 앞부분 < 낱말 모두 포함 < 글자가 차례로 들어 있음 */
export function nameMatchRank(label: string, query: string): number | null {
  const name = lower(label.trim())
  const needle = lower(query.trim())
  if (needle === '') return null
  if (name === needle) return 0
  if (name.startsWith(needle)) return 1
  if (name.includes(needle)) return 2
  const words = needle.split(/\s+/u)
  if (words.length > 1 && words.every((word) => name.includes(word))) return 3
  // 글자가 차례로 들어 있으면(「읽기」 → 「읽 기」·「iwae tour」 → 「iwt」 같은 줄임)
  const letters = [...needle.replace(/\s+/gu, '')]
  let from = 0
  for (const letter of letters) {
    const at = name.indexOf(letter, from)
    if (at < 0) return null
    from = at + 1
  }
  return 4
}

/** 이름에 가장 잘 맞는 항목(같은 순위면 이름이 짧은 것). 없으면 null */
export function pickByName<T extends { readonly label: string }>(items: readonly T[], query: string): T | null {
  let best: { readonly item: T; readonly rank: number } | null = null
  for (const item of items) {
    const rank = nameMatchRank(item.label, query)
    if (rank === null) continue
    if (best === null || rank < best.rank || (rank === best.rank && item.label.length < best.item.label.length)) best = { item, rank }
  }
  return best?.item ?? null
}

/** 화면을 번호(0 부터) 또는 이름으로 찾는다. 없으면 -1 */
export function findScreenIndex(state: ScreensState, ref: string): number {
  const text = ref.trim()
  if (/^\d+$/u.test(text)) {
    const index = Number(text)
    return index < state.screens.length ? index : -1
  }
  const exact = state.screens.findIndex((screen) => lower(screen.name) === lower(text))
  if (exact >= 0) return exact
  const picked = pickByName(state.screens.map((screen, index) => ({ label: screen.name, index })), text)
  return picked?.index ?? -1
}

// ── 칸 이동(방향) ─────────────────────────────────────────────────────────────

export type PaneDirection = 'L' | 'R' | 'U' | 'D'

const lengthOf = (rect: PaneRect, vertical: boolean) => (vertical ? rect.bottom - rect.top : rect.right - rect.left)

/**
 * `from` 칸에서 그 방향으로 가장 가까운 칸. 방향에 칸이 없으면 반대편 끝으로 돌아 나간다(tmux 와 같다).
 * 맞닿은 칸이 여럿이면 겹친 길이가 긴 칸. 갈 데가 없으면 null.
 */
export function neighborPane(rects: ReadonlyMap<string, PaneRect>, from: string, direction: PaneDirection): string | null {
  const origin = rects.get(from)
  if (origin === undefined) return null
  const vertical = direction === 'U' || direction === 'D'
  const forward = direction === 'R' || direction === 'D'
  // 가는 방향의 좌표(앞쪽 가장자리)와 가로지르는 방향의 겹침
  const edgeNear = (rect: PaneRect) => (vertical ? (forward ? rect.top : rect.bottom) : (forward ? rect.left : rect.right))
  const edgeFar = (rect: PaneRect) => (vertical ? (forward ? rect.bottom : rect.top) : (forward ? rect.right : rect.left))
  const overlap = (rect: PaneRect) => (vertical
    ? Math.min(rect.right, origin.right) - Math.max(rect.left, origin.left)
    : Math.min(rect.bottom, origin.bottom) - Math.max(rect.top, origin.top))
  const tolerance = 0.5 * Math.max(1e-6, Math.min(lengthOf(origin, false), lengthOf(origin, true))) * 0.001
  const candidates: { readonly id: string; readonly gap: number; readonly overlap: number }[] = []
  for (const [id, rect] of rects) {
    if (id === from) continue
    const shared = overlap(rect)
    if (shared <= tolerance) continue
    const gap = forward ? edgeNear(rect) - edgeFar(origin) : edgeFar(origin) - edgeNear(rect)
    if (gap < -tolerance) continue
    candidates.push({ id, gap: Math.max(gap, 0), overlap: shared })
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.gap - b.gap || b.overlap - a.overlap)
    return candidates[0]!.id
  }
  // 돌아 나가기: 반대편에서 가장 먼 칸(겹치는 칸 가운데)
  const wrapped: { readonly id: string; readonly far: number; readonly overlap: number }[] = []
  for (const [id, rect] of rects) {
    if (id === from) continue
    const shared = overlap(rect)
    if (shared <= tolerance) continue
    wrapped.push({ id, far: forward ? -edgeNear(rect) : edgeNear(rect), overlap: shared })
  }
  wrapped.sort((a, b) => b.far - a.far || b.overlap - a.overlap)
  return wrapped[0]?.id ?? null
}

// ── 순수 동작 ─────────────────────────────────────────────────────────────────

type Outcome = { readonly model: WorkspaceModel; readonly message?: string } | { readonly error: string }

const refusalText = (reason: SplitRefusal): string => (reason === 'max' ? t('칸은 {max}개까지입니다', { max: MAX_PANES }) : t('칸이 너무 작습니다'))

function firstPaneOf(screen: Screen): string {
  return leaves(screen.layout)[0]!
}

/** 화면을 바꾼 뒤의 모델: 그 화면의 첫 칸을 만진다 */
function viewing(screens: ScreensState): WorkspaceModel {
  return { screens, activePane: firstPaneOf(activeScreenOf(screens)) }
}

function splitWindow(model: WorkspaceModel, dir: SplitDir, sizeOf?: PaneSizer): Outcome {
  const active = activeScreenOf(model.screens)
  const result = splitPane(workspaceOf(active), model.activePane, dir, sizeOf)
  if ('refused' in result) return { error: refusalText(result.refused) }
  const screens = setZoomed(withActiveWorkspace(model.screens, { panes: result.panes, channels: result.channels, layout: result.layout }), null)
  return { model: { screens, activePane: result.newPane } }
}

function selectPaneBy(model: WorkspaceModel, flags: ParsedCommand['flags'], rects: ReadonlyMap<string, PaneRect> | null): Outcome {
  const active = activeScreenOf(model.screens)
  const order = leaves(active.layout)
  const here = order.indexOf(model.activePane)
  let target: string | null | undefined
  const direction = (['L', 'R', 'U', 'D'] as const).find((letter) => flags[letter] === true)
  if (flags.t !== undefined) {
    const raw = String(flags.t)
    if (!/^\d+$/u.test(raw)) return { error: t('칸 번호를 쓰세요: select-pane -t N') }
    target = order[Number(raw)]
    if (target === undefined) return { error: t('{n}번 칸이 없습니다', { n: raw }) }
  } else if (direction !== undefined) {
    if (order.length <= 1) return { error: t('칸이 하나뿐입니다') }
    const map = rects ?? new Map([...layoutRects(active.layout).panes].map(([id, rect]) => [id, { left: rect.x, top: rect.y, right: rect.x + rect.w, bottom: rect.y + rect.h }] as const))
    target = neighborPane(map, model.activePane, direction)
    if (target === null) return { error: t('그 방향에 칸이 없습니다') }
  } else {
    // -n(다음 칸, 기본) · -p(앞 칸): 칸 차례대로 돈다
    if (order.length <= 1) return { error: t('칸이 하나뿐입니다') }
    const step = flags.p === true ? -1 : 1
    target = order[(here + step + order.length) % order.length]!
  }
  if (target === undefined || target === null) return { error: t('칸을 찾을 수 없습니다') }
  // 크게 보던 중이면 푼다(tmux 가 select-pane 으로 zoom 을 푸는 것과 같다)
  const screens = active.zoomed !== null && active.zoomed !== target ? setZoomed(model.screens, null) : model.screens
  return { model: { screens, activePane: target } }
}

function zoomPane(model: WorkspaceModel): Outcome {
  const active = activeScreenOf(model.screens)
  if (leaves(active.layout).length <= 1 && active.zoomed === null) return { error: t('칸이 하나뿐입니다') }
  return { model: { ...model, screens: setZoomed(model.screens, active.zoomed === model.activePane ? null : model.activePane) } }
}

function killPane(model: WorkspaceModel): Outcome {
  const active = activeScreenOf(model.screens)
  const result = closePaneTree(workspaceOf(active), model.activePane)
  if (result === null) return { error: t('칸이 하나뿐입니다') }
  const screens = withActiveWorkspace(model.screens, { panes: result.panes, channels: result.channels, layout: result.layout })
  return { model: { screens, activePane: result.landed } }
}

function swapPane(model: WorkspaceModel, step: 1 | -1): Outcome {
  const active = activeScreenOf(model.screens)
  const order = leaves(active.layout)
  if (order.length <= 1) return { error: t('칸이 하나뿐입니다') }
  const here = order.indexOf(model.activePane)
  const other = order[(here + step + order.length) % order.length]!
  const layout = swapLeaves(active.layout, model.activePane, other)
  return { model: { ...model, screens: withActiveWorkspace(model.screens, { ...workspaceOf(active), layout }) } }
}

function breakPaneOut(model: WorkspaceModel, name: string): Outcome {
  const screens = breakPane(model.screens, model.activePane, name)
  if (screens === null) return { error: t('칸이 하나뿐입니다') }
  return { model: { screens, activePane: model.activePane } }
}

function joinPane(model: WorkspaceModel, ref: string, dir: SplitDir, sizeOf?: PaneSizer): Outcome {
  const state = model.screens
  const index = findScreenIndex(state, ref)
  if (index < 0) return { error: t('화면을 찾을 수 없습니다: {name}', { name: ref }) }
  const source = state.screens[index]!
  const active = activeScreenOf(state)
  if (source.id === active.id) return { error: t('다른 화면의 칸을 가져옵니다') }
  const pane = firstPaneOf(source)
  const refused = splitRefusal(active.layout, model.activePane, dir, sizeOf?.(model.activePane) ?? null)
  if (refused !== null) return { error: refusalText(refused) }
  const moved = tabsOf(source.panes, pane)
  const layout = splitLeaf(active.layout, model.activePane, dir, pane)
  const joined: Screen = {
    ...active,
    layout,
    panes: { ...active.panes, [pane]: moved },
    channels: { ...active.channels, [pane]: channelOf(source.channels, pane) },
    zoomed: null,
  }
  const shrunkLayout = removeLeaf(source.layout, pane)
  const { [pane]: _gone, ...restPanes } = source.panes
  const shrunk: Screen | null = shrunkLayout === null ? null : {
    ...source,
    layout: shrunkLayout,
    panes: restPanes,
    channels: pruneChannels(source.channels, leaves(shrunkLayout)),
    zoomed: source.zoomed === pane ? null : source.zoomed,
  }
  const screens = state.screens.flatMap((screen) => (screen.id === active.id ? [joined] : screen.id === source.id ? (shrunk === null ? [] : [shrunk]) : [screen]))
  return { model: { screens: { screens, activeScreen: active.id, lastScreen: shrunk === null && state.lastScreen === source.id ? null : state.lastScreen }, activePane: pane } }
}

/** 화면을 만들 때 새 화면 하나를 맨 뒤에 더하고 그리로 간다(빈 칸 하나) */
function newBlankWindow(model: WorkspaceModel, name: string): Outcome {
  const used = model.screens.screens.flatMap((screen) => leaves(screen.layout))
  const blank = blankScreen(name, used)
  const { id: _id, ...screen } = blank
  return { model: { screens: addScreen(model.screens, screen, true), activePane: leaves(blank.layout)[0]! } }
}

function selectWindow(model: WorkspaceModel, ref: string): Outcome {
  const index = findScreenIndex(model.screens, ref)
  if (index < 0) return { error: t('화면을 찾을 수 없습니다: {name}', { name: ref }) }
  const target = model.screens.screens[index]!
  if (target.id === model.screens.activeScreen) return { model }
  return { model: viewing(switchScreen(model.screens, target.id)) }
}

function stepWindow(model: WorkspaceModel, step: 1 | -1): Outcome {
  if (model.screens.screens.length <= 1) return { error: t('화면이 하나뿐입니다') }
  return { model: viewing(stepScreen(model.screens, step)) }
}

function lastWindow(model: WorkspaceModel): Outcome {
  const next = lastScreenOf(model.screens)
  if (next === model.screens) return { error: t('바로 앞에 보던 화면이 없습니다') }
  return { model: viewing(next) }
}

function renameWindow(model: WorkspaceModel, name: string): Outcome {
  const trimmed = name.trim()
  if (trimmed === '') return { error: t('새 이름을 쓰세요: rename-window 이름') }
  return { model: { ...model, screens: renameScreen(model.screens, model.screens.activeScreen, trimmed) } }
}

function killWindow(model: WorkspaceModel): Outcome {
  const next = closeScreen(model.screens, model.screens.activeScreen)
  if (next === null) return { error: t('화면이 하나뿐입니다') }
  return { model: viewing(next) }
}

const layoutCycle = new Map<string, number>()
/** 시험용: 배치 돌리기 기록을 지운다 */
export function resetLayoutCycle(): void {
  layoutCycle.clear()
}

function selectLayoutBy(model: WorkspaceModel, name: string | undefined): Outcome {
  const active = activeScreenOf(model.screens)
  if (leaves(active.layout).length <= 1) return { error: t('칸이 하나뿐입니다') }
  let kind: RelayoutKind
  if (name === undefined) {
    const next = ((layoutCycle.get(active.id) ?? -1) + 1) % RELAYOUT_KINDS.length
    layoutCycle.set(active.id, next)
    kind = RELAYOUT_KINDS[next]!
  } else {
    const parsed = parseRelayoutKind(name)
    if (parsed === null) return { error: t('모르는 배치: {name} — {list}', { name, list: RELAYOUT_KINDS.join(' · ') }) }
    layoutCycle.set(active.id, RELAYOUT_KINDS.indexOf(parsed))
    kind = parsed
  }
  const next = selectLayout(workspaceOf(active), kind)
  const screens = setZoomed(withActiveWorkspace(model.screens, next), null)
  return { model: { ...model, screens }, message: kind }
}

const CHANNEL_WORDS: Readonly<Record<string, PaneChannel>> = { blue: 'blue', green: 'green', orange: 'orange', none: null, off: null, 파랑: 'blue', 초록: 'green', 주황: 'orange', 없음: null }

function setChannel(model: WorkspaceModel, word: string | undefined): Outcome {
  if (word === undefined || !(lower(word) in CHANNEL_WORDS)) return { error: t('set-channel blue|green|orange|none') }
  const active = activeScreenOf(model.screens)
  const channels = withChannel(active.channels, model.activePane, CHANNEL_WORDS[lower(word)] ?? null)
  return { model: { ...model, screens: withActiveWorkspace(model.screens, { ...workspaceOf(active), channels }) } }
}

// ── 실행 ──────────────────────────────────────────────────────────────────────

const ok = (message = ''): CommandResult => ({ ok: true, message })
const fail = (message: string): CommandResult => ({ ok: false, message })

const firstArg = (command: ParsedCommand): string | undefined => command.args[0]
const restText = (command: ParsedCommand): string => command.args.join(' ').trim()

function resolveTemplate(host: CommandHost, query: string): NamedTemplate | null {
  const items = host.templates()
  const byId = items.find((template) => lower(template.id) === lower(query))
  return byId ?? pickByName(items, query)
}

async function runOne(command: ParsedCommand, host: CommandHost): Promise<CommandResult> {
  if (command.soon) return fail(t('다음 단계에서 됩니다'))
  const apply = (outcome: Outcome): CommandResult => {
    if ('error' in outcome) return fail(outcome.error)
    host.setModel(outcome.model)
    return ok(outcome.message)
  }
  const model = host.getModel()
  const { flags } = command
  switch (command.name) {
    case 'split-window':
      return apply(splitWindow(model, flags.h === true ? 'h' : 'v', host.sizeOf))
    case 'select-pane':
      return apply(selectPaneBy(model, flags, host.paneRects?.() ?? null))
    case 'resize-pane':
      if (flags.Z !== true) return fail(t('resize-pane 은 -Z(크게/되돌리기)만 됩니다'))
      return apply(zoomPane(model))
    case 'kill-pane':
      return apply(killPane(model))
    case 'swap-pane':
      return apply(swapPane(model, flags.U === true ? -1 : 1))
    case 'break-pane':
      return apply(breakPaneOut(model, host.blankScreenName(model.screens.screens.length)))
    case 'join-pane': {
      const source = flags.s
      if (source === undefined) return fail(t('join-pane -s N (가져올 화면 번호)'))
      return apply(joinPane(model, String(source), flags.v === true ? 'v' : 'h', host.sizeOf))
    }
    case 'new-window': {
      const name = flags.n === undefined ? undefined : String(flags.n).trim() || undefined
      if (flags.t !== undefined) {
        const template = resolveTemplate(host, String(flags.t))
        if (template === null) return fail(t('모르는 템플릿: {name}', { name: String(flags.t) }))
        if (template.id !== 'blank') {
          if (host.newWindowFromTemplate === undefined) return fail(t('지금은 템플릿으로 새 화면을 만들 수 없습니다'))
          await host.newWindowFromTemplate(template.id, name, model.activePane)
          return ok()
        }
      }
      return apply(newBlankWindow(model, name ?? host.blankScreenName(model.screens.screens.length)))
    }
    case 'select-window': {
      const ref = flags.t ?? firstArg(command)
      if (ref === undefined) return fail(t('select-window -t N|이름'))
      return apply(selectWindow(model, String(ref)))
    }
    case 'next-window':
      return apply(stepWindow(model, 1))
    case 'previous-window':
      return apply(stepWindow(model, -1))
    case 'last-window':
      return apply(lastWindow(model))
    case 'rename-window':
      return apply(renameWindow(model, restText(command)))
    case 'kill-window':
      return apply(killWindow(model))
    case 'select-layout':
      return apply(selectLayoutBy(model, firstArg(command)))
    case 'display-panes':
      if (host.displayPanes === undefined) return fail(t('지금은 안 됩니다'))
      host.displayPanes()
      return ok()
    case 'list-keys':
      if (host.listKeys === undefined) return fail(t('지금은 안 됩니다'))
      host.listKeys()
      return ok()
    case 'open': {
      const query = restText(command)
      if (query === '') return fail(t('open 이름'))
      if (host.open === undefined) return fail(t('지금은 안 됩니다'))
      return host.open(query, model.activePane)
    }
    case 'set-channel':
      return apply(setChannel(model, firstArg(command)))
    case 'note-beside':
      if (host.noteBeside === undefined) return fail(t('지금은 안 됩니다'))
      await host.noteBeside(model.activePane)
      return ok()
    case 'apply-template': {
      const query = restText(command)
      if (query === '') return fail(t('apply-template 이름'))
      const template = resolveTemplate(host, query)
      if (template === null || template.id === 'blank') return fail(t('모르는 템플릿: {name}', { name: query }))
      if (host.applyTemplate === undefined) return fail(t('지금은 안 됩니다'))
      await host.applyTemplate(template.id, model.activePane)
      return ok()
    }
    case 'command-prompt':
      if (host.promptCommand === undefined) return fail(t('지금은 안 됩니다'))
      host.promptCommand(restText(command))
      return ok()
    case 'rename-prompt': {
      if (host.promptCommand === undefined) return fail(t('지금은 안 됩니다'))
      host.promptCommand(`rename-window ${activeScreenOf(model.screens).name}`)
      return ok()
    }
    case 'confirm-kill-window':
      if (model.screens.screens.length <= 1) return fail(t('화면이 하나뿐입니다'))
      if (host.confirmKillWindow === undefined) return apply(killWindow(model))
      host.confirmKillWindow()
      return ok()
    case 'choose-session':
      if (host.showSessionMenu === undefined) return fail(t('지금은 안 됩니다'))
      host.showSessionMenu()
      return ok()
    default:
      return fail(t('모르는 명령: {name} — ? 로 목록', { name: command.word }))
  }
}

/**
 * 명령줄 한 줄(`;` 로 이은 여러 명령)을 차례로 실행한다. 하나가 실패하면 거기서 멈춘다(tmux 와 같다).
 * 앞의 명령이 바꾼 상태는 `host.settle` 을 거쳐 다음 명령이 읽는다.
 */
export async function runCommandLine(line: string, host: CommandHost): Promise<CommandResult> {
  const parsed = parseCommandLine(line)
  if (!parsed.ok) return fail(parsed.message)
  let message = ''
  for (const [index, command] of parsed.commands.entries()) {
    // 앞 명령이 바꾼 상태를 다음 명령이 읽도록 기다린다
    if (index > 0) await host.settle?.()
    const result = await runOne(command, host)
    if (!result.ok) return result
    if (result.message !== '') message = result.message
  }
  return ok(message)
}
