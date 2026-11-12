import { layoutForLegacyId, leaves, newPaneId, type LayoutNode } from '../core/layoutTree'
import { t } from '../i18n'
import { pickFreeChannel } from './noteBeside'
import { activeTab, allPaneTabs, isDocumentKind, tabsOf, type PaneId, type PanesState, type Tab, type TabsState } from './tabs'
import { channelOf, type Channel, type PaneChannels } from './workspaceChannels'

/**
 * 이름 붙은 배치(설계 3.6): 지금 열린 탭들을 그 모양으로 다시 놓는다. 어떤 탭도 닫지 않는다 —
 * 모양에 자리가 없는 탭은 가장 가까운 창의 탭 줄에 그대로 둔다. DOM·React 를 모른다.
 */
export type LayoutPresetId = 'read' | 'noteLeft' | 'compare' | 'organize'

export interface LayoutPresetDef {
  readonly id: LayoutPresetId
  /** 이름(현재 언어) */
  readonly label: string
  /** 한 줄 설명(현재 언어) */
  readonly hint: string
  /** 캔버스(YOLO 노트)가 필요한가 — CANVAS_ENABLED 가 꺼져 있으면 감춘다 */
  readonly needsCanvas?: boolean
}

export const LAYOUT_PRESETS: readonly LayoutPresetDef[] = [
  { id: 'read', get label() { return t('읽기') }, get hint() { return t('문서 | 노트') } },
  { id: 'noteLeft', get label() { return t('노트 왼쪽') }, get hint() { return t('노트 | 문서') } },
  { id: 'compare', get label() { return t('비교') }, get hint() { return t('문서 둘 | 노트 둘') } },
  { id: 'organize', get label() { return t('정리') }, get hint() { return t('노트 | 캔버스') }, needsCanvas: true },
]

export function availableLayoutPresets(canvasEnabled: boolean): readonly LayoutPresetDef[] {
  return LAYOUT_PRESETS.filter((preset) => canvasEnabled || preset.needsCanvas !== true)
}

export interface PresetInput {
  readonly id: LayoutPresetId
  readonly panes: PanesState
  readonly channels: PaneChannels
  /** 지금의 배치(칸 차례와 칸 id 를 이어 쓴다) */
  readonly layout: LayoutNode
  /** 지금 보는 문서 창(없으면 문서가 있는 첫 창) */
  readonly anchor: PaneId | null
  /** 마지막으로 만진 메모 노트(없으면 null) — 열린 노트 탭이 없을 때 쓴다 */
  readonly lastTouched: string | null
  /** 노트 탭이 하나도 없을 때 놓을 노트(마지막으로 만진·문서의 노트). 없으면 노트 칸은 비어 있다 */
  readonly fallbackNote: Tab | null
  /** 마지막으로 만진 캔버스(없으면 null) — 「정리」에서 여러 캔버스 중 보일 것 */
  readonly lastCanvas?: string | null
  /** 캔버스 탭이 하나도 없을 때 「정리」가 놓을 캔버스(마지막으로 만진·첫 캔버스·새로 만든 것). 없으면 캔버스 칸은 비어 있다 */
  readonly fallbackCanvas?: Tab | null
}

export interface PresetOutcome {
  readonly layout: LayoutNode
  readonly panes: PanesState
  readonly channels: PaneChannels
  /** 지금 만진 것으로 삼을 창(문서 칸) */
  readonly focus: PaneId
  /** 새로 자라듯 보일 창(문서 칸의 짝) */
  readonly fresh: PaneId
}

/** first 를 맨 앞으로 옮긴다(비교처럼 「보던 것이 첫째 칸」일 때) */
function leadWith(list: readonly Tab[], first: Tab | undefined): Tab[] {
  if (first === undefined) return [...list]
  return [first, ...list.filter((tab) => tab.id !== first.id)]
}

/**
 * 프리셋을 지금 탭들에 적용한다.
 * - 문서(PDF·Markdown) 탭은 문서 칸으로, 메모 노트는 노트 칸으로, 캔버스는 노트 칸 뒤(정리에서는 캔버스 칸)로 간다. 탭 차례는 지킨다.
 * - 칸에서 보일 탭: 문서는 지금 보던 문서, 노트는 마지막으로 만진 노트다.
 * - 문서 칸과 노트 칸은 같은 색이다. 비교는 두 쌍이 서로 다른 색이다.
 */
export function applyLayoutPreset(input: PresetInput): PresetOutcome {
  const { id, panes, channels, layout, anchor, lastTouched, fallbackNote, lastCanvas = null, fallbackCanvas = null } = input
  const order = leaves(layout)
  const all = allPaneTabs(panes, order)
  const shown = order.map((pane) => activeTab(tabsOf(panes, pane))).filter((tab): tab is Tab => tab !== null)
  const anchorTab = anchor === null ? null : activeTab(tabsOf(panes, anchor))
  const activeDoc = anchorTab !== null && isDocumentKind(anchorTab.kind) ? anchorTab : shown.find((tab) => isDocumentKind(tab.kind))
  const docs = all.filter((tab) => isDocumentKind(tab.kind))
  let canvases = all.filter((tab) => tab.kind === 'canvas')
  // 「정리」는 캔버스가 있어야 한다: 열린 캔버스 탭이 없으면 마지막으로 만진(또는 새) 캔버스를 놓는다
  if (id === 'organize' && canvases.length === 0 && fallbackCanvas !== null) canvases = [fallbackCanvas]
  const activeCanvas = canvases.find((tab) => tab.id === lastCanvas) ?? canvases.find((tab) => shown.some((candidate) => candidate.id === tab.id)) ?? canvases[0]
  let notes = all.filter((tab) => tab.kind === 'memoNote')
  if (notes.length === 0 && fallbackNote !== null) notes = [fallbackNote]
  const activeNote = notes.find((tab) => tab.id === lastTouched) ?? notes.find((tab) => shown.some((candidate) => candidate.id === tab.id)) ?? notes[0]

  const anchorChannel: Channel = (anchor === null ? null : channelOf(channels, anchor)) ?? pickFreeChannel(channels, order.filter((pane) => tabsOf(panes, pane).tabs.length > 0))
  // 새 배치의 칸은 지금 있는 칸 id 를 차례로 이어 쓰고(보던 칸이 그대로 남는다), 모자라면 새 id 를 만든다
  const used = new Set(order)
  const paneIds = (count: number): string[] => Array.from({ length: count }, (_, index) => order[index] ?? newPaneId(used)).map((pane) => { used.add(pane); return pane })
  /** 탭 줄: 차례는 그대로, 보일 탭은 activeId(없으면 첫째) */
  const strip = (list: readonly Tab[], activeId?: string): TabsState => ({
    tabs: [...list],
    activeId: list.some((tab) => tab.id === activeId) ? activeId ?? null : list[0]?.id ?? null,
  })

  if (id === 'compare') {
    // 왼쪽 열: 문서 둘(위·아래), 오른쪽 열: 노트 둘(위·아래). 위 쌍과 아래 쌍은 다른 색. 남는 탭은 아래 칸 탭 줄에 둔다
    const [docA, docB, ...docRest] = leadWith(docs, activeDoc)
    const [noteA, noteB, ...noteRest] = leadWith(notes, activeNote)
    const other: Channel = anchorChannel === 'blue' ? 'green' : 'blue'
    const list = (...tabs: (Tab | undefined)[]) => tabs.filter((tab): tab is Tab => tab !== undefined)
    const [p0, p1, p2, p3] = paneIds(4) as [string, string, string, string]
    return {
      // 위 줄: 문서 | 노트, 아래 줄: 문서 | 노트
      layout: layoutForLegacyId('grid4', [p0, p1, p2, p3]),
      panes: {
        [p0]: strip(list(docA)),
        [p1]: strip([...list(noteA), ...canvases]),
        [p2]: strip(list(docB, ...docRest)),
        [p3]: strip(list(noteB, ...noteRest)),
      },
      channels: { [p0]: anchorChannel, [p1]: anchorChannel, [p2]: other, [p3]: other },
      focus: p0,
      fresh: p1,
    }
  }

  // 두 칸 배치. 읽기(문서 | 노트), 노트 왼쪽(노트 | 문서), 정리(노트 | 캔버스: 문서 탭은 닫지 않고 노트 칸 뒤에 둔다)
  const [left, right] = paneIds(2) as [string, string]
  const twoCols = layoutForLegacyId('cols2', [left, right])
  const channelsOut: PaneChannels = { [left]: anchorChannel, [right]: anchorChannel }
  const docStrip = strip(docs, activeDoc?.id)
  const noteStrip = strip([...notes, ...canvases], activeNote?.id)
  if (id === 'read') return { layout: twoCols, panes: { [left]: docStrip, [right]: noteStrip }, channels: channelsOut, focus: left, fresh: right }
  if (id === 'noteLeft') return { layout: twoCols, panes: { [left]: noteStrip, [right]: docStrip }, channels: channelsOut, focus: right, fresh: left }
  return { layout: twoCols, panes: { [left]: strip([...notes, ...docs], activeNote?.id ?? activeDoc?.id), [right]: strip(canvases, activeCanvas?.id) }, channels: channelsOut, focus: left, fresh: right }
}
