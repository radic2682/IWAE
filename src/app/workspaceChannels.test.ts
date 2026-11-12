import { describe, expect, it } from 'vitest'
import { captureSession, parseSession } from '../core/session'
import { collapseEmptyPane, dockTab, openTabBeside } from './tabDock'
import { emptyTabs, type PanesState, type Tab } from './tabs'
import {
  DEFAULT_CHANNELS,
  cycleChannel,
  cyclePaneChannel,
  parsePaneChannels,
  remapChannelsByKeep,
  swapPaneChannels,
  type PaneChannels,
} from './workspaceChannels'

const tab = (id: string, kind: Tab['kind'] = 'pdf'): Tab => ({ id, title: id, kind })
const state = (...ids: string[]) => ({ tabs: ids.map((id) => tab(id)), activeId: ids[0] ?? null })

describe('색 채널', () => {
  it('처음에는 모든 창이 파랑이다', () => {
    expect(DEFAULT_CHANNELS).toEqual({ left: 'blue', right: 'blue', third: 'blue', fourth: 'blue' })
  })

  it('점을 누를 때마다 파랑 → 초록 → 주황 → 없음 → 파랑', () => {
    expect(cycleChannel('blue')).toBe('green')
    expect(cycleChannel('green')).toBe('orange')
    expect(cycleChannel('orange')).toBeNull()
    expect(cycleChannel(null)).toBe('blue')
    expect(cyclePaneChannel(DEFAULT_CHANNELS, 'right')).toEqual({ ...DEFAULT_CHANNELS, right: 'green' })
  })

  it('저장된 값을 읽는다: 없는 창·모르는 값은 파랑, 저장된 없음은 그대로', () => {
    expect(parsePaneChannels(undefined)).toEqual(DEFAULT_CHANNELS)
    expect(parsePaneChannels({ left: 'orange', right: null, third: 'red' })).toEqual({ left: 'orange', right: null, third: 'blue', fourth: 'blue' })
  })

  it('세션에 저장하고 되살린다(미리보기 탭 표시도 함께)', () => {
    const channels: PaneChannels = { left: 'green', right: null, third: 'blue', fourth: 'orange' }
    const left = { tabs: [tab('a'), { ...tab('b'), preview: true }], activeId: 'a' }
    const captured = captureSession(left, state('n'), { sidebarCollapsed: false, sidebarPx: 260, leftFrac: 0.5 }, emptyTabs, emptyTabs, channels)
    expect(captured.paneChannels).toEqual(channels)
    expect(captured.previewTabIds).toEqual(['b'])
    const restored = parseSession(JSON.parse(JSON.stringify(captured)))
    expect(restored.paneChannels).toEqual(channels)
    expect(restored.previewTabIds).toEqual(['b'])
  })

  it('예전 세션(채널 없음)은 채널 항목이 없고, 저장 때 채널을 안 주면 쓰지 않는다', () => {
    const captured = captureSession(state('a'), emptyTabs, { sidebarCollapsed: false, sidebarPx: 260, leftFrac: 0.5 })
    expect(captured.paneChannels).toBeUndefined()
    expect(parseSession(JSON.parse(JSON.stringify(captured))).paneChannels).toBeUndefined()
  })

  it('두 창의 채널을 맞바꾼다', () => {
    expect(swapPaneChannels({ ...DEFAULT_CHANNELS, left: 'green', right: null }, 'left', 'right')).toMatchObject({ left: null, right: 'green' })
  })
})

describe('채널 이어받기', () => {
  const panes: PanesState = { left: state('a', 'b'), right: state('c'), third: emptyTabs, fourth: emptyTabs }

  it('탭을 끌어 새 창을 만들면 탭이 떠난 창의 채널을 받는다', () => {
    const channels: PaneChannels = { left: 'green', right: 'orange', third: 'blue', fourth: 'blue' }
    const result = dockTab(panes, 'cols2', 'a', 'left', 'bottom', channels)
    expect(result?.channels[result!.newPane]).toBe('green')
    // 원래 창과 다른 창의 채널은 새 이름으로 따라간다
    expect(result?.channels[result!.sourcePane]).toBe('green')
    const other = (['left', 'right', 'third'] as const).find((pane) => pane !== result!.newPane && pane !== result!.sourcePane)!
    expect(result?.channels[other]).toBe('orange')
  })

  it('다른 창의 가장자리에 놓아도 새 창은 탭이 떠난 창의 채널이다', () => {
    const channels: PaneChannels = { left: 'green', right: 'orange', third: 'blue', fourth: 'blue' }
    // 왼쪽 창의 탭 a 를 오른쪽 창의 왼쪽 가장자리로: 새 칸이 앞에 끼어 이름이 밀린다
    const result = dockTab(panes, 'cols2', 'a', 'right', 'left', channels)
    expect(result?.layout).toBe('cols3')
    expect(result?.channels[result!.newPane]).toBe('green')
    expect(result?.channels.third).toBe('orange')
  })

  it('칸이 닫히면 남은 창의 채널이 창을 따라 옮겨 간다', () => {
    const base: PanesState = { left: emptyTabs, right: state('b'), third: state('c'), fourth: emptyTabs }
    const channels: PaneChannels = { left: 'green', right: 'orange', third: null, fourth: 'blue' }
    const result = collapseEmptyPane(base, 'cols3', 'left', channels)
    expect(result?.layout).toBe('cols2')
    expect(result?.channels).toMatchObject({ left: 'orange', right: null })
  })

  it('remapChannelsByKeep: 새 칸 차례대로 옛 칸의 채널을 옮긴다', () => {
    expect(remapChannelsByKeep({ left: 'green', right: 'orange', third: null, fourth: 'blue' }, [1, 2])).toMatchObject({ left: 'orange', right: null })
  })

  it('openTabBeside: 보낸 창 옆에 새 창을 만들고 그 창의 채널을 준다', () => {
    const channels: PaneChannels = { left: 'orange', right: 'blue', third: 'blue', fourth: 'blue' }
    const result = openTabBeside({ ...panes, right: emptyTabs }, 'cols2', 'left', tab('x'), channels)
    expect(result?.layout).toBe('cols3')
    expect(result?.panes[result.newPane].tabs.map((item) => item.id)).toEqual(['x'])
    expect(result?.channels[result!.newPane]).toBe('orange')
  })

  it('openTabBeside: 칸이 이미 넷이면 null', () => {
    const four: PanesState = { left: state('a'), right: state('b'), third: state('c'), fourth: state('d') }
    expect(openTabBeside(four, 'grid4', 'left', tab('x'))).toBeNull()
  })
})
