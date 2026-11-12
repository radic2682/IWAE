import { MAX_PANES, leaves, newPaneId, removeLeaf, splitLeaf, splitRefusal, type SplitRefusal } from '../core/layoutTree'
import { t } from '../i18n'
import { activeScreenOf, allScreenPaneIds, normalizeFloats, replaceScreen, type FloatAnchor, type FloatingPane, type Screen, type ScreensState } from './screens'
import { emptyTabs, openTab, tabsOf, type PanesState, type Tab, type TabsState } from './tabs'
import { channelOf } from './workspaceChannels'
import type { PaneSizer } from './tabDock'

/**
 * 떠 있는 칸(docs/design/workspace-tmux.md 5)의 순수 동작. DOM·React 를 모른다.
 * 떠 있는 칸은 보통 칸과 같은 칸(탭 줄 · 색 채널)이지만 나누기 트리 밖에 있고, 자리는 붙은 곳(화면 · 칸)의 사각형에 대한 비율이다.
 * 칸의 탭 · 채널은 Screen.panes · Screen.channels 에 paneId 로 들어 있다.
 */

export const FLOAT_MIN_W = 240
export const FLOAT_MIN_H = 160
/** 접은 떠 있는 칸의 높이(머리만) */
export const FLOAT_HEAD_H = 34
export const FLOAT_DEFAULT_W = 380
export const FLOAT_DEFAULT_H = 300
/** 번역기를 담은 떠 있는 칸의 처음 크기: 내용(언어 줄 · 입력 3줄 · 번역 단추 · 결과 3줄 · 복사)에 맞춰 작게. 이미 저장된 칸은 저장된 크기를 그대로 쓴다 */
export const TRANSLATOR_FLOAT_W = 340
export const TRANSLATOR_FLOAT_H = 300
export const MAX_FLOATS = 4

export interface FloatSize {
  readonly width: number
  readonly height: number
}

/** 붙은 곳 안의 상자(px, 붙은 곳의 왼쪽 위가 원점) */
export interface FloatBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high))

// ── 자리 · 크기 ───────────────────────────────────────────────────────────────

/**
 * 저장된 떠 있는 칸을 붙은 곳(anchor, px) 안의 상자로. 크기는 붙은 곳보다 커지지 않고(작은 곳에서는 최소 크기도 줄어든다),
 * 자리는 붙은 곳을 벗어나지 않게 가둔다. 접혀 있으면 높이는 머리만.
 */
export function floatBoxIn(float: Pick<FloatingPane, 'x' | 'y' | 'w' | 'h' | 'collapsed'>, anchor: FloatSize): FloatBox {
  const w = clamp(float.w, Math.min(FLOAT_MIN_W, anchor.width), anchor.width)
  const full = clamp(float.h, Math.min(FLOAT_MIN_H, anchor.height), anchor.height)
  const h = float.collapsed ? Math.min(FLOAT_HEAD_H, anchor.height) : full
  return {
    x: clamp(float.x * anchor.width, 0, anchor.width - w),
    y: clamp(float.y * anchor.height, 0, anchor.height - h),
    w,
    h,
  }
}

/**
 * 붙은 칸이 떠 있는 칸보다 작은가(가로든 세로든). 그러면 칸 사각형에 가두지 않는다 — 가두면 아래 · 오른쪽이 잘린다.
 * 접힌 칸은 머리 높이만 본다.
 */
export function floatOutgrowsAnchor(float: Pick<FloatingPane, 'w' | 'h' | 'collapsed'>, anchor: FloatSize): boolean {
  return anchor.width < float.w || anchor.height < (float.collapsed ? FLOAT_HEAD_H : float.h)
}

/**
 * 붙은 칸에 못 들어가는 떠 있는 칸의 상자: 화면(칸 영역 전체, screen) 안에 가둔다. 자리는 붙은 칸 안의 비율 자리를 화면 좌표로 옮긴 곳에서 시작해
 * (칸을 따라다닌다) 화면 가장자리를 넘지 않게 민다. 상자는 화면 원점 기준이다.
 */
export function floatBoxOnScreen(float: Pick<FloatingPane, 'x' | 'y' | 'w' | 'h' | 'collapsed'>, anchor: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }, screen: FloatSize): FloatBox {
  const w = clamp(float.w, Math.min(FLOAT_MIN_W, screen.width), screen.width)
  const full = clamp(float.h, Math.min(FLOAT_MIN_H, screen.height), screen.height)
  const h = float.collapsed ? Math.min(FLOAT_HEAD_H, screen.height) : full
  return {
    x: clamp(anchor.left + float.x * anchor.width, 0, screen.width - w),
    y: clamp(anchor.top + float.y * anchor.height, 0, screen.height - h),
    w,
    h,
  }
}

/** 끌어 옮기기: dx · dy 만큼 옮기되 붙은 곳 안에 가둔다 */
export function moveFloatBox(box: FloatBox, dx: number, dy: number, anchor: FloatSize): FloatBox {
  return {
    ...box,
    x: clamp(box.x + dx, 0, anchor.width - box.w),
    y: clamp(box.y + dy, 0, anchor.height - box.h),
  }
}

/** 오른쪽 아래 모서리로 크기 바꾸기: 최소 크기 이상, 붙은 곳의 오른쪽·아래 가장자리까지 */
export function resizeFloatBox(box: FloatBox, dx: number, dy: number, anchor: FloatSize): FloatBox {
  const maxW = Math.max(anchor.width - box.x, 0)
  const maxH = Math.max(anchor.height - box.y, 0)
  return {
    ...box,
    w: clamp(box.w + dx, Math.min(FLOAT_MIN_W, maxW), maxW),
    h: clamp(box.h + dy, Math.min(FLOAT_MIN_H, maxH), maxH),
  }
}

/** 끌기·크기 바꾸기가 끝난 상자를 저장 모양(비율 자리 + px 크기)으로. 접혀 있으면 펼쳤을 때의 높이는 그대로 둔다 */
export function floatFromBox(float: FloatingPane, box: FloatBox, anchor: FloatSize): FloatingPane {
  return {
    ...float,
    x: anchor.width > 0 ? box.x / anchor.width : float.x,
    y: anchor.height > 0 ? box.y / anchor.height : float.y,
    w: box.w,
    h: float.collapsed ? float.h : box.h,
  }
}

// ── 찾기 ──────────────────────────────────────────────────────────────────────

export const floatIdsOf = (screen: Screen): string[] => screen.floats.map((float) => float.paneId)

export const floatOf = (screen: Screen, paneId: string): FloatingPane | undefined => screen.floats.find((float) => float.paneId === paneId)

export const isFloatPane = (screen: Screen, paneId: string): boolean => floatOf(screen, paneId) !== undefined

/** 지금 보이는 떠 있는 칸들(toggle-floating 으로 숨겼으면 없다) */
export const visibleFloats = (screen: Screen): readonly FloatingPane[] => (screen.floatsHidden === true ? [] : screen.floats)

/** select-pane · o 가 도는 칸들: 트리의 칸 + 보이는 떠 있는 칸. 칸 번호(q · -t N)는 트리의 칸만 센다 */
export function selectableOrder(screen: Screen): string[] {
  return [...leaves(screen.layout), ...visibleFloats(screen).map((float) => float.paneId)]
}

// ── 동작 ──────────────────────────────────────────────────────────────────────

/** 명령이 읽고 바꾸는 장면(workspaceCommands 의 WorkspaceModel 과 같은 모양) */
export interface FloatModel {
  readonly screens: ScreensState
  readonly activePane: string
}

export type FloatOutcome = { readonly model: FloatModel; readonly message?: string } | { readonly error: string }

const refusalText = (reason: SplitRefusal): string => (reason === 'max' ? t('칸은 {max}개까지입니다', { max: MAX_PANES }) : t('칸이 너무 작습니다'))

/** 겹치지 않게 어긋나게 놓는 처음 자리(n 번째 떠 있는 칸) */
function cascade(count: number): { readonly x: number; readonly y: number } {
  const step = count % 6
  return { x: 0.12 + 0.05 * step, y: 0.1 + 0.06 * step }
}

function put(model: FloatModel, screen: Screen, activePane: string): FloatModel {
  return { screens: replaceScreen(model.screens, screen), activePane }
}

/** 떠 있는 칸을 가장 위로(맨 뒤로) 올린다. 이미 맨 위이거나 없으면 같은 객체 */
export function raiseFloat(screens: ScreensState, paneId: string): ScreensState {
  const active = activeScreenOf(screens)
  const at = active.floats.findIndex((float) => float.paneId === paneId)
  if (at < 0 || at === active.floats.length - 1) return screens
  return replaceScreen(screens, { ...active, floats: [...active.floats.filter((float) => float.paneId !== paneId), active.floats[at]!] })
}

/** 떠 있는 칸의 자리 · 크기 · 접힘을 바꾼다. 없으면 같은 객체 */
export function patchFloat(screens: ScreensState, paneId: string, patch: Partial<Pick<FloatingPane, 'x' | 'y' | 'w' | 'h' | 'collapsed' | 'anchor'>>): ScreensState {
  const active = activeScreenOf(screens)
  if (!isFloatPane(active, paneId)) return screens
  return replaceScreen(screens, { ...active, floats: active.floats.map((float) => (float.paneId === paneId ? { ...float, ...patch } : float)) })
}

/**
 * float-pane: 트리의 칸 하나를 떼어 화면 위에 띄운다(탭 · 색은 그대로). 칸이 하나뿐이면 못 한다.
 * 그 칸에 붙어 있던 다른 떠 있는 칸은 화면에 붙는다. 띄운 칸이 만지는 칸이 된다.
 */
export function floatPane(model: FloatModel, pane: string = model.activePane): FloatOutcome {
  const active = activeScreenOf(model.screens)
  if (isFloatPane(active, pane)) return { error: t('이미 떠 있는 칸입니다') }
  const order = leaves(active.layout)
  if (!order.includes(pane)) return { error: t('칸을 찾을 수 없습니다') }
  if (order.length <= 1) return { error: t('칸이 하나뿐이라 띄울 수 없습니다') }
  if (active.floats.length >= MAX_FLOATS) return { error: t('떠 있는 칸은 {max}개까지입니다', { max: MAX_FLOATS }) }
  const layout = removeLeaf(active.layout, pane)
  if (layout === null) return { error: t('칸이 하나뿐이라 띄울 수 없습니다') }
  const float: FloatingPane = { paneId: pane, anchor: { kind: 'screen' }, ...cascade(active.floats.length), w: FLOAT_DEFAULT_W, h: FLOAT_DEFAULT_H, collapsed: false }
  const next = normalizeFloats({ ...active, layout, floats: [...active.floats, float], floatsHidden: false, zoomed: active.zoomed === pane ? null : active.zoomed }, active.layout)
  return { model: put(model, next, pane) }
}

/** 떠 있는 칸의 탭을 tree 칸(target)에 합친다: 번역기 탭은 버리고 나머지는 뒤에 붙인다 */
function mergeFloatTabs(panes: PanesState, float: string, target: string): PanesState {
  const { [float]: closed, ...rest } = panes
  const keep = (closed?.tabs ?? []).filter((tab) => tab.kind !== 'translator')
  if (keep.length === 0 || rest[target] === undefined) return rest
  const have = new Set(rest[target]!.tabs.map((tab) => tab.id))
  const extra = keep.filter((tab) => !have.has(tab.id))
  const activeKept = closed?.activeId !== null && closed?.activeId !== undefined && keep.some((tab) => tab.id === closed.activeId) ? closed.activeId : null
  return { ...rest, [target]: { tabs: [...rest[target]!.tabs, ...extra], activeId: rest[target]!.activeId ?? activeKept } }
}

/** 떠 있는 칸이 돌아갈(또는 탭을 합칠) 트리의 칸: 붙은 칸 → 만지던 칸 → 첫 칸 */
function homeFor(screen: Screen, float: FloatingPane, preferred: string): string {
  const order = leaves(screen.layout)
  if (float.anchor.kind === 'pane' && order.includes(float.anchor.paneId)) return float.anchor.paneId
  return order.includes(preferred) ? preferred : order[0]!
}

/**
 * embed-pane: 떠 있는 칸을 트리로 되돌린다. 만지는 칸이 떠 있는 칸이면 그 칸을, 아니면 가장 위의 떠 있는 칸을 넣는다.
 * 붙은 칸(없으면 만지던 트리 칸)의 오른쪽에 나누어 넣는다. 칸이 상한이거나 너무 작으면 못 한다.
 */
export function embedPane(model: FloatModel, sizeOf?: PaneSizer, paneId?: string): FloatOutcome {
  const active = activeScreenOf(model.screens)
  const float = (paneId === undefined ? undefined : floatOf(active, paneId)) ?? floatOf(active, model.activePane) ?? active.floats[active.floats.length - 1]
  if (float === undefined) return { error: t('떠 있는 칸이 없습니다') }
  const target = homeFor(active, float, model.activePane)
  const refused = splitRefusal(active.layout, target, 'h', sizeOf?.(target) ?? null)
  if (refused !== null) return { error: refusalText(refused) }
  const layout = splitLeaf(active.layout, target, 'h', float.paneId)
  const next: Screen = { ...active, layout, floats: active.floats.filter((candidate) => candidate.paneId !== float.paneId), zoomed: null }
  return { model: put(model, next, float.paneId) }
}

/** toggle-floating: 이 화면의 떠 있는 칸을 모두 숨기거나 다시 보인다. 숨길 때 만지던 칸이 떠 있는 칸이면 트리의 칸으로 옮긴다 */
export function toggleFloating(model: FloatModel): FloatOutcome {
  const active = activeScreenOf(model.screens)
  if (active.floats.length === 0) return { error: t('떠 있는 칸이 없습니다') }
  const hide = active.floatsHidden !== true
  const landed = hide && isFloatPane(active, model.activePane) ? homeFor(active, floatOf(active, model.activePane)!, leaves(active.layout)[0]!) : model.activePane
  return { model: put(model, { ...active, floatsHidden: hide }, landed), message: hide ? t('떠 있는 칸을 숨겼습니다') : t('떠 있는 칸을 보입니다') }
}

/**
 * 떠 있는 칸을 닫는다(× · kill-pane): 번역기 탭은 버리고, 다른 탭은 돌아갈 칸의 뒤에 합친다(탭은 잃지 않는다).
 * 이 칸에 붙어 있던 다른 떠 있는 칸은 없어질 일이 없다(떠 있는 칸에는 붙지 않는다).
 */
export function closeFloat(model: FloatModel, paneId: string): FloatOutcome {
  const active = activeScreenOf(model.screens)
  const float = floatOf(active, paneId)
  if (float === undefined) return { error: t('떠 있는 칸이 없습니다') }
  const home = homeFor(active, float, model.activePane)
  const { [paneId]: _gone, ...channels } = active.channels
  const next: Screen = {
    ...active,
    panes: mergeFloatTabs(active.panes, paneId, home),
    channels,
    floats: active.floats.filter((candidate) => candidate.paneId !== paneId),
  }
  return { model: put(model, next, model.activePane === paneId ? home : model.activePane) }
}

export interface FloatInput {
  /** 처음 담을 탭(없으면 빈 칸) */
  readonly tab?: Tab
  /** 붙일 칸(트리의 칸). 없으면 화면 */
  readonly anchorPane?: string
  readonly size?: { readonly w: number; readonly h: number }
  /** 처음 자리(붙은 곳 비율). 없으면 어긋나게 쌓는다 */
  readonly at?: { readonly x: number; readonly y: number }
  /** 칸 id 를 정해 만든다(탭 id 가 칸 id 를 담을 때) */
  readonly paneId?: string
}

/** 새 떠 있는 칸을 만든다. 만든 칸이 만지는 칸이 된다. 칸 id 도 돌려준다 */
export function addFloat(model: FloatModel, input: FloatInput = {}): { readonly model: FloatModel; readonly paneId: string } | { readonly error: string } {
  const active = activeScreenOf(model.screens)
  if (active.floats.length >= MAX_FLOATS) return { error: t('떠 있는 칸은 {max}개까지입니다', { max: MAX_FLOATS }) }
  const paneId = input.paneId ?? newPaneId(allScreenPaneIds(model.screens))
  const anchor: FloatAnchor = input.anchorPane !== undefined && leaves(active.layout).includes(input.anchorPane) ? { kind: 'pane', paneId: input.anchorPane } : { kind: 'screen' }
  const state: TabsState = input.tab === undefined ? emptyTabs : openTab(emptyTabs, input.tab)
  const at = input.at ?? cascade(active.floats.length)
  const float: FloatingPane = { paneId, anchor, x: at.x, y: at.y, w: input.size?.w ?? FLOAT_DEFAULT_W, h: input.size?.h ?? FLOAT_DEFAULT_H, collapsed: false }
  const next: Screen = {
    ...active,
    panes: { ...active.panes, [paneId]: state },
    channels: { ...active.channels, [paneId]: anchor.kind === 'pane' ? channelOf(active.channels, anchor.paneId) : 'blue' },
    floats: [...active.floats, float],
    floatsHidden: false,
  }
  return { model: put(model, next, paneId), paneId }
}

/** 번역기 탭(떠 있는 칸마다 하나, 탭 id 에 칸 id 가 들어 있다) */
export const translatorTabId = (paneId: string): string => `translator:${paneId}`

export const isTranslatorTabId = (id: string): boolean => id === 'translator' || id.startsWith('translator:')

export function translatorTab(paneId: string): Tab {
  return { id: translatorTabId(paneId), title: t('번역기'), kind: 'translator' }
}

/** 이 칸에 붙은(anchorPane 가 없으면 화면에 붙은) 번역기 떠 있는 칸 */
export function translatorFloatFor(screen: Screen, anchorPane: string | undefined): FloatingPane | undefined {
  return screen.floats.find((float) => {
    const sameAnchor = anchorPane === undefined ? float.anchor.kind === 'screen' : float.anchor.kind === 'pane' && float.anchor.paneId === anchorPane
    return sameAnchor && tabsOf(screen.panes, float.paneId).tabs.some((tab) => tab.kind === 'translator')
  })
}

/**
 * display-popup: 번역기 탭을 담은 떠 있는 칸을 띄운다. 같은 곳에 붙은 번역기가 이미 있으면 새로 만들지 않고
 * 그 칸을 보이고(숨겨져 있었다면 숨김을 풀고, 접혀 있었다면 펼치고) 만진다.
 */
export function openTranslatorFloat(model: FloatModel, anchorPane?: string): FloatOutcome {
  const active = activeScreenOf(model.screens)
  const existing = translatorFloatFor(active, anchorPane)
  if (existing !== undefined) {
    const shown: Screen = { ...active, floatsHidden: false, floats: active.floats.map((float) => (float.paneId === existing.paneId ? { ...float, collapsed: false } : float)) }
    return { model: put(model, shown, existing.paneId) }
  }
  const paneId = newPaneId(allScreenPaneIds(model.screens))
  const created = addFloat(model, { paneId, tab: translatorTab(paneId), ...(anchorPane === undefined ? {} : { anchorPane }), size: { w: TRANSLATOR_FLOAT_W, h: TRANSLATOR_FLOAT_H }, at: anchorPane === undefined ? { x: 0.6, y: 0.08 } : { x: 0.55, y: 0.05 } })
  if ('error' in created) return created
  return { model: created.model }
}

/** 번역기 단추: 이 칸의 번역기가 있으면 닫고, 없으면 연다 */
export function toggleTranslatorFloat(model: FloatModel, anchorPane: string): FloatOutcome {
  const existing = translatorFloatFor(activeScreenOf(model.screens), anchorPane)
  return existing === undefined ? openTranslatorFloat(model, anchorPane) : closeFloat(model, existing.paneId)
}
