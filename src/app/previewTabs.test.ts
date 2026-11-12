import { describe, expect, it } from 'vitest'
import { parseAppPrefs } from './appPrefs'
import { dockTab, moveTabToPaneAt } from './tabDock'
import { emptyTabs, markPreviewTabs, moveTabToPane, openPreviewTab, openPreviewTabInPanes, pinTab, pinTabInPanes, type PanesState, type Tab } from './tabs'

const tab = (id: string, preview = false): Tab => ({ id, title: id, kind: 'pdf', ...(preview ? { preview: true } : {}) })
const ids = (state: { tabs: readonly Tab[] }) => state.tabs.map((item) => item.id)

describe('미리보기 탭', () => {
  it('미리보기로 열면 맨 뒤에 기울임 탭이 생기고, 다음 미리보기가 그 자리를 갈아 끼운다', () => {
    const base = { tabs: [tab('a'), tab('b')], activeId: 'a' }
    const first = openPreviewTab(base, tab('p1'))
    expect(ids(first)).toEqual(['a', 'b', 'p1'])
    expect(first.tabs[2]!.preview).toBe(true)
    expect(first.activeId).toBe('p1')
    const second = openPreviewTab({ tabs: [tab('a'), tab('p1', true), tab('b')], activeId: 'a' }, tab('p2'))
    // 같은 자리(둘째)에서 갈아 끼운다
    expect(ids(second)).toEqual(['a', 'p2', 'b'])
    expect(second.tabs[1]!.preview).toBe(true)
    expect(second.activeId).toBe('p2')
  })

  it('이미 열린 탭이면 그 탭으로 바꾸기만 한다(고정 여부 그대로)', () => {
    const base = { tabs: [tab('a'), tab('p1', true)], activeId: 'a' }
    expect(openPreviewTab(base, tab('a'))).toEqual({ tabs: base.tabs, activeId: 'a' })
    expect(openPreviewTab(base, tab('p1')).tabs[1]!.preview).toBe(true)
  })

  it('고정(편집·두 번 누르기)하면 보통 탭이 되어 다음 미리보기가 갈아 끼우지 않는다', () => {
    const base = { tabs: [tab('a'), tab('p1', true)], activeId: 'p1' }
    const pinned = pinTab(base, 'p1')
    expect(pinned.tabs[1]!.preview).toBeUndefined()
    expect(ids(openPreviewTab(pinned, tab('p2')))).toEqual(['a', 'p1', 'p2'])
    expect(pinTab(pinned, 'p1')).toBe(pinned)
  })

  it('모든 창에서 탭을 고정한다', () => {
    const panes: PanesState = { left: { tabs: [tab('a')], activeId: 'a' }, right: { tabs: [tab('p', true)], activeId: 'p' }, third: emptyTabs, fourth: emptyTabs }
    const next = pinTabInPanes(panes, 'p')
    expect(next.right.tabs[0]!.preview).toBeUndefined()
    expect(pinTabInPanes(next, 'p')).toBe(next)
  })

  it('다른 창으로 끌거나 옮기면 고정된다(같은 창 안 순서 바꾸기는 그대로)', () => {
    const panes: PanesState = { left: { tabs: [tab('a'), tab('p', true)], activeId: 'a' }, right: { tabs: [tab('c')], activeId: 'c' }, third: emptyTabs, fourth: emptyTabs }
    expect(moveTabToPaneAt(panes, 'p', 'right', 0).right.tabs[0]!.preview).toBeUndefined()
    expect(moveTabToPane(panes, 'p', 'right').right.tabs.find((item) => item.id === 'p')!.preview).toBeUndefined()
    expect(moveTabToPaneAt(panes, 'p', 'left', 0).left.tabs[0]!.preview).toBe(true)
    const docked = dockTab(panes, 'cols2', 'p', 'right', 'bottom')
    expect(docked?.panes[docked.newPane].tabs[0]!.preview).toBeUndefined()
  })

  it('창에 미리보기로 열기: 설정을 끄면 보통 탭으로 연다', () => {
    const panes: PanesState = { left: { tabs: [tab('a')], activeId: 'a' }, right: emptyTabs, third: emptyTabs, fourth: emptyTabs }
    expect(openPreviewTabInPanes(panes, tab('p'), 'left').left.tabs[1]!.preview).toBe(true)
    expect(openPreviewTabInPanes(panes, tab('p'), 'left', false).left.tabs[1]!.preview).toBeUndefined()
    // 이미 어느 창에 있으면 거기서 활성화
    const next = openPreviewTabInPanes(panes, tab('a'), 'right')
    expect(next.left.activeId).toBe('a')
    expect(next.right.tabs).toHaveLength(0)
  })

  it('설정 「다른 노트·문서를 미리보기 탭으로 열기」는 기본이 켜짐이고 끌 수 있다', () => {
    expect(parseAppPrefs(null).previewTabs).toBe(true)
    expect(parseAppPrefs(JSON.stringify({ previewTabs: false })).previewTabs).toBe(false)
  })

  it('저장해 둔 미리보기 표시를 되살린다', () => {
    const panes: PanesState = { left: { tabs: [tab('a'), tab('b')], activeId: 'a' }, right: emptyTabs, third: emptyTabs, fourth: emptyTabs }
    expect(markPreviewTabs(panes, ['b']).left.tabs.map((item) => item.preview === true)).toEqual([false, true])
    expect(markPreviewTabs(panes, [])).toBe(panes)
  })
})
