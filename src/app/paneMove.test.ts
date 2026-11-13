import { describe, expect, it } from 'vitest'
import { MAX_PANES, layoutForLegacyId, leaves, shapeOf } from '../core/layoutTree'
import { movePaneToEdge, paneMoveEdges, paneMoveRefusal, swapPanes } from './paneMove'
import type { TreeWorkspace } from './tabDock'
import type { Tab } from './tabs'

const tab = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const tabs = (...ids: string[]) => ({ tabs: ids.map(tab), activeId: ids[0] ?? null })

/** a | b | c 세 칸(좌우), 칸마다 탭 · 색이 다르다 */
const cols3 = (): TreeWorkspace => ({
  layout: layoutForLegacyId('cols3', ['a', 'b', 'c']),
  panes: { a: tabs('a1', 'a2'), b: tabs('b1'), c: tabs() },
  channels: { a: 'blue', b: 'green', c: null },
})
const big = () => ({ width: 1200, height: 800 })

describe('movePaneToEdge — 칸을 다른 칸의 가장자리로 옮기기', () => {
  it('칸을 빼서 대상의 그쪽에 나누어 넣고, 탭 · 색은 칸 id 와 함께 간다', () => {
    const input = cols3()
    const result = movePaneToEdge(input, 'c', 'a', 'top', big)
    expect(result).not.toBeNull()
    expect(result).not.toHaveProperty('refused')
    const next = result as TreeWorkspace
    // c 가 a 위로: v(c, a) 가 왼쪽 자리, b 가 오른쪽
    expect(shapeOf(next.layout)).toBe('h(v(P,P),P)')
    expect(leaves(next.layout)).toEqual(['c', 'a', 'b'])
    expect(next.panes).toBe(input.panes)
    expect(next.channels).toBe(input.channels)
  })

  it('왼쪽 · 오른쪽 · 아래도 앞뒤 차례가 맞다', () => {
    expect(leaves((movePaneToEdge(cols3(), 'a', 'c', 'right', big) as TreeWorkspace).layout)).toEqual(['b', 'c', 'a'])
    expect(leaves((movePaneToEdge(cols3(), 'a', 'c', 'left', big) as TreeWorkspace).layout)).toEqual(['b', 'a', 'c'])
    expect(leaves((movePaneToEdge(cols3(), 'a', 'b', 'bottom', big) as TreeWorkspace).layout)).toEqual(['b', 'a', 'c'])
    expect(shapeOf((movePaneToEdge(cols3(), 'a', 'b', 'bottom', big) as TreeWorkspace).layout)).toBe('h(v(P,P),P)')
  })

  it('칸 수는 그대로다(빼고 다시 끼운다) — 칸이 상한이어도 옮겨진다', () => {
    const ids = Array.from({ length: MAX_PANES }, (_, index) => `p${index}`)
    const input: TreeWorkspace = {
      layout: ids.slice(1).reduce((node, id, index) => ({ kind: 'split', id: `s${index}`, dir: 'h', ratio: 0.5, a: node, b: { kind: 'pane', paneId: id } }), { kind: 'pane', paneId: ids[0]! } as TreeWorkspace['layout']),
      panes: Object.fromEntries(ids.map((id) => [id, tabs(id)])),
      channels: {},
    }
    const result = movePaneToEdge(input, 'p7', 'p0', 'top', big)
    expect(result).not.toHaveProperty('refused')
    expect(leaves((result as TreeWorkspace).layout)).toHaveLength(MAX_PANES)
  })

  it('자기 자신 · 없는 칸 · 하나뿐인 화면은 할 일이 없다(null)', () => {
    expect(movePaneToEdge(cols3(), 'a', 'a', 'left', big)).toBeNull()
    expect(movePaneToEdge(cols3(), 'a', 'zzz', 'left', big)).toBeNull()
    expect(movePaneToEdge(cols3(), 'zzz', 'a', 'left', big)).toBeNull()
    const single: TreeWorkspace = { layout: { kind: 'pane', paneId: 'a' }, panes: { a: tabs() }, channels: {} }
    expect(movePaneToEdge(single, 'a', 'b', 'left', big)).toBeNull()
  })

  it('대상이 너무 작아지면 { refused: small } 이다', () => {
    const narrow = () => ({ width: 300, height: 800 })
    expect(movePaneToEdge(cols3(), 'a', 'c', 'left', narrow)).toEqual({ refused: 'small' })
    // 위아래는 높이가 충분하니 된다
    expect(movePaneToEdge(cols3(), 'a', 'c', 'top', narrow)).not.toHaveProperty('refused')
  })

  it('옆 칸을 대상의 가장자리로 옮길 때는 옆 칸이 차지하던 자리까지 대상 몫으로 센다', () => {
    // a | b 가 각각 폭 300: b 를 빼면 a 가 600 이 되어 a 의 위로 나눌 수 있고, 지금 크기(300)만 보면 좌우는 막힌다
    const input: TreeWorkspace = { layout: layoutForLegacyId('cols2', ['a', 'b']), panes: { a: tabs(), b: tabs() }, channels: {} }
    const sizes = (pane: string) => ({ width: 300, height: pane === 'a' ? 600 : 600 })
    expect(paneMoveRefusal(input.layout, 'b', 'a', 'left', sizes)).toBeNull()
    // 다른 칸(옆이 아님)이면 지금 크기로만 본다
    const three = cols3()
    expect(paneMoveRefusal(three.layout, 'c', 'a', 'left', () => ({ width: 300, height: 800 }))).toBe('small')
  })
})

describe('paneMoveEdges — 놓을 수 있는 가장자리', () => {
  it('크기를 모르면 네 쪽 모두, 자기 자신이면 하나도 없다', () => {
    expect(paneMoveEdges(cols3().layout, 'a', 'c')).toEqual(['left', 'right', 'top', 'bottom'])
    expect(paneMoveEdges(cols3().layout, 'a', 'a')).toEqual([])
  })

  it('좁은 칸은 좌우를 빼고 위아래만 남긴다(미리보기 없이 가운데로 본다)', () => {
    expect(paneMoveEdges(cols3().layout, 'a', 'c', () => ({ width: 300, height: 800 }))).toEqual(['top', 'bottom'])
  })
})

describe('swapPanes — 두 칸의 자리 맞바꾸기', () => {
  it('트리의 칸 id 자리만 바뀌고 탭 · 색은 칸을 따라간다', () => {
    const input = cols3()
    const next = swapPanes(input, 'a', 'c')!
    expect(leaves(next.layout)).toEqual(['c', 'b', 'a'])
    expect(next.panes).toBe(input.panes)
    expect(next.channels).toBe(input.channels)
    expect(shapeOf(next.layout)).toBe(shapeOf(input.layout))
  })

  it('같은 칸 · 없는 칸은 null', () => {
    expect(swapPanes(cols3(), 'a', 'a')).toBeNull()
    expect(swapPanes(cols3(), 'a', 'nope')).toBeNull()
  })
})
