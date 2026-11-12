import { describe, expect, it } from 'vitest'
import { layoutForLegacyId, paneNode } from '../core/layoutTree'
import { captureSession, parseSession } from '../core/session'
import { collapseEmptyPane, dockTab, openTabBeside, type TreeWorkspace } from './tabDock'
import { emptyTabs, type PanesState, type Tab } from './tabs'
import {
  DEFAULT_CHANNEL,
  DEFAULT_CHANNELS,
  channelOf,
  cycleChannel,
  cyclePaneChannel,
  inheritChannel,
  parseChannel,
  pruneChannels,
  swapPaneChannels,
  withChannel,
  type PaneChannels,
} from './workspaceChannels'

const tab = (id: string, kind: Tab['kind'] = 'pdf'): Tab => ({ id, title: id, kind })
const state = (...ids: string[]) => ({ tabs: ids.map((id) => tab(id)), activeId: ids[0] ?? null })

describe('색 채널', () => {
  it('정해 둔 적이 없는 칸은 파랑이다(저장된 없음은 그대로 없음)', () => {
    expect(DEFAULT_CHANNEL).toBe('blue')
    expect(channelOf(DEFAULT_CHANNELS, 'any')).toBe('blue')
    expect(channelOf({ a: null, b: 'orange' }, 'a')).toBeNull()
    expect(channelOf({ a: null, b: 'orange' }, 'b')).toBe('orange')
  })

  it('점을 누를 때마다 파랑 → 초록 → 주황 → 없음 → 파랑', () => {
    expect(cycleChannel('blue')).toBe('green')
    expect(cycleChannel('green')).toBe('orange')
    expect(cycleChannel('orange')).toBeNull()
    expect(cycleChannel(null)).toBe('blue')
    expect(cyclePaneChannel({}, 'right')).toEqual({ right: 'green' })
    expect(cyclePaneChannel({ right: 'orange' }, 'right')).toEqual({ right: null })
  })

  it('저장된 값 하나를 읽는다: 모르는 값은 undefined, 저장된 없음은 null', () => {
    expect(parseChannel('orange')).toBe('orange')
    expect(parseChannel(null)).toBeNull()
    expect(parseChannel('red')).toBeUndefined()
    expect(parseChannel(undefined)).toBeUndefined()
  })

  it('세션에 칸마다 저장하고 되살린다(미리보기 탭 표시도 함께)', () => {
    const layout = layoutForLegacyId('cols3', ['x', 'y', 'z'])
    const channels: PaneChannels = { x: 'green', y: null, z: 'orange' }
    const panes: PanesState = { x: { tabs: [tab('a'), { ...tab('b'), preview: true }], activeId: 'a' }, y: state('n'), z: emptyTabs }
    const captured = captureSession({ panes, channels, layout }, { sidebarCollapsed: false, sidebarPx: 260, leftFrac: 0.5 })
    expect(captured.paneState?.x?.channel).toBe('green')
    expect(captured.paneState?.y?.channel).toBeNull()
    expect(captured.paneState?.z?.channel).toBe('orange')
    expect(captured.previewTabIds).toEqual(['b'])
    const restored = parseSession(JSON.parse(JSON.stringify(captured)))
    expect(restored.paneState).toEqual(captured.paneState)
    expect(restored.previewTabIds).toEqual(['b'])
  })

  it('두 칸의 채널을 맞바꾼다', () => {
    expect(swapPaneChannels({ a: 'green', b: null }, 'a', 'b')).toEqual({ a: null, b: 'green' })
  })

  it('withChannel 은 같은 값이면 같은 객체, inheritChannel 은 새 칸이 그 칸의 채널을 받는다', () => {
    const base: PaneChannels = { a: 'green' }
    expect(withChannel(base, 'a', 'green')).toBe(base)
    expect(withChannel(base, 'a', null)).toEqual({ a: null })
    expect(inheritChannel(base, 'a', 'n')).toEqual({ a: 'green', n: 'green' })
    expect(inheritChannel({ a: null }, 'a', 'n')).toEqual({ a: null, n: null })
    // 정해 둔 적이 없으면 기본(파랑)을 받는다
    expect(inheritChannel({}, 'a', 'n')).toEqual({ n: 'blue' })
  })

  it('pruneChannels 는 있는 칸의 채널만 남긴다(바뀐 게 없으면 같은 객체)', () => {
    const base: PaneChannels = { a: 'green', b: 'orange' }
    expect(pruneChannels(base, ['a', 'b'])).toBe(base)
    expect(pruneChannels(base, ['b'])).toEqual({ b: 'orange' })
  })
})

describe('채널 이어받기', () => {
  const input = (): TreeWorkspace => ({
    panes: { left: state('a', 'b'), right: state('c') },
    channels: { left: 'green', right: 'orange' },
    layout: layoutForLegacyId('cols2', ['left', 'right']),
  })

  it('탭을 끌어 새 창을 만들면 탭이 떠난 창의 채널을 받는다', () => {
    const result = dockTab(input(), 'a', 'left', 'bottom')
    if (result === null || 'refused' in result) throw new Error('나뉘어야 한다')
    expect(result.channels[result.newPane]).toBe('green')
    // 다른 창의 채널은 칸 id 에 붙어 그대로다
    expect(result.channels.right).toBe('orange')
  })

  it('다른 창의 가장자리에 놓아도 새 창은 탭이 떠난 창의 채널이다', () => {
    const result = dockTab(input(), 'a', 'right', 'left')
    if (result === null || 'refused' in result) throw new Error('나뉘어야 한다')
    expect(result.channels[result.newPane]).toBe('green')
    expect(result.channels.right).toBe('orange')
  })

  it('칸이 닫히면 닫힌 칸의 채널이 지워지고 남은 칸의 채널은 그대로다', () => {
    const closing: TreeWorkspace = { ...input(), panes: { left: emptyTabs, right: state('b') } }
    const result = collapseEmptyPane(closing, 'left')
    expect(result?.channels).toEqual({ right: 'orange' })
  })

  it('openTabBeside: 보낸 창 옆에 새 창을 만들고 그 창의 채널을 준다', () => {
    const channels: PaneChannels = { left: 'orange', right: 'blue' }
    const result = openTabBeside({ left: state('a'), right: emptyTabs }, layoutForLegacyId('cols2', ['left', 'right']), 'left', tab('x'), channels)
    expect(result?.panes[result.newPane]?.tabs.map((item) => item.id)).toEqual(['x'])
    expect(result?.channels[result!.newPane]).toBe('orange')
  })

  it('openTabBeside: 한 칸짜리 배치도 나눌 수 있다', () => {
    const result = openTabBeside({ only: state('a') }, paneNode('only'), 'only', tab('x'), { only: null })
    expect(result?.channels[result!.newPane]).toBeNull()
  })
})
