import { describe, it, expect } from 'vitest'
import {
  emptyTabs,
  isDocumentKind,
  moveMemoNoteTabs,
  syncMemoNoteTabs,
  normalizeTabKind,
  paneRouteOf,
  openTab,
  closeTab,
  activateTab,
  activeTab,
  type Tab,
  closeTabEverywhere,
  mapPaneTabs,
  moveTabToPane,
  openTabInPanes,
  paneOfTab,
  reorderTab,
  replaceTab,
  mergeHiddenPanes,
  paneLabel,
  type PanesState,
} from './tabs'

const spec: Tab = { id: 'ab12cd34ef56', title: 'HTTP Semantics v1.1', kind: 'pdf' }
const book: Tab = { id: '77aa11bb22cc', title: 'Rust Handbook', kind: 'pdf' }
const guide: Tab = { id: '99ff88ee77dd', title: 'Team Onboarding Guide', kind: 'pdf' }

describe('openTab', () => {
  it('빈 상태에 열면 탭 하나가 생기고 활성화된다', () => {
    const s = openTab(emptyTabs, spec)
    expect(s.tabs).toEqual([spec])
    expect(s.activeId).toBe(spec.id)
  })

  it('이미 열린 문서를 다시 열면 중복 추가하지 않고 활성화만 한다', () => {
    const s = openTab(openTab(openTab(emptyTabs, spec), book), spec)
    expect(s.tabs).toEqual([spec, book])
    expect(s.activeId).toBe(spec.id)
  })

  it('새 탭은 항상 맨 뒤에 붙는다', () => {
    const s = openTab(openTab(emptyTabs, spec), book)
    expect(s.tabs.map((t) => t.id)).toEqual([spec.id, book.id])
  })
})

describe('closeTab', () => {
  it('비활성 탭을 닫아도 활성 탭은 그대로다', () => {
    const s = closeTab(openTab(openTab(emptyTabs, spec), book), spec.id)
    expect(s.tabs).toEqual([book])
    expect(s.activeId).toBe(book.id)
  })

  it('활성 탭을 닫으면 오른쪽 탭이 활성화된다', () => {
    const three = openTab(openTab(openTab(emptyTabs, spec), book), guide)
    const s = closeTab(activateTab(three, book.id), book.id)
    expect(s.activeId).toBe(guide.id)
  })

  it('맨 오른쪽 활성 탭을 닫으면 왼쪽 탭이 활성화된다', () => {
    const two = openTab(openTab(emptyTabs, spec), book)
    const s = closeTab(two, book.id)
    expect(s.activeId).toBe(spec.id)
  })

  it('마지막 탭을 닫으면 활성 탭이 없어진다', () => {
    const s = closeTab(openTab(emptyTabs, spec), spec.id)
    expect(s.tabs).toEqual([])
    expect(s.activeId).toBeNull()
  })

  it('없는 id 를 닫으면 아무것도 바뀌지 않는다', () => {
    const one = openTab(emptyTabs, spec)
    expect(closeTab(one, 'nope')).toEqual(one)
  })
})

describe('activateTab', () => {
  it('열린 탭을 활성화한다', () => {
    const two = openTab(openTab(emptyTabs, spec), book)
    expect(activateTab(two, spec.id).activeId).toBe(spec.id)
  })

  it('없는 id 는 무시한다 — 활성 탭이 사라지면 화면이 빈다', () => {
    const two = openTab(openTab(emptyTabs, spec), book)
    expect(activateTab(two, 'nope').activeId).toBe(book.id)
  })
})

describe('activeTab', () => {
  it('활성 탭 객체를 돌려준다', () => {
    const two = openTab(openTab(emptyTabs, spec), book)
    expect(activeTab(two)).toEqual(book)
  })

  it('빈 상태에서는 null 이다 — 패널은 이때 안내 문구를 그린다', () => {
    expect(activeTab(emptyTabs)).toBeNull()
  })

  it('마지막 탭을 닫아 activeId 가 null 이 되면 null 이다', () => {
    const closed = closeTab(openTab(emptyTabs, spec), spec.id)
    expect(activeTab(closed)).toBeNull()
  })
})

describe('불변성', () => {
  it('입력 상태를 변경하지 않는다', () => {
    const before = openTab(emptyTabs, spec)
    const snapshot = JSON.parse(JSON.stringify(before))
    openTab(before, book)
    closeTab(before, spec.id)
    activateTab(before, spec.id)
    expect(before).toEqual(snapshot)
  })
})

describe('좌우 패널', () => {
  const pdf = (id: string) => ({ id, title: id, kind: 'pdf' as const })
  const note = (id: string) => ({ id, title: id, kind: 'canvas' as const })
  const empty: PanesState = { left: emptyTabs, right: emptyTabs, third: emptyTabs, fourth: emptyTabs }

  it('이미 반대편에 열린 탭은 새로 열지 않고 그 패널에서 활성화한다', () => {
    const opened = openTabInPanes(openTabInPanes(empty, pdf('a'), 'right'), pdf('b'), 'right')
    const again = openTabInPanes(opened, pdf('a'), 'left')
    expect(again.left.tabs).toEqual([])
    expect(again.right).toEqual({ tabs: [pdf('a'), pdf('b')], activeId: 'a' })
  })

  it('한 패널에 PDF 와 캔버스를 섞어 담고, 탭을 반대편으로 옮긴다', () => {
    const mixed = openTabInPanes(openTabInPanes(empty, pdf('a'), 'left'), note('n.canvas'), 'left')
    expect(mixed.left.tabs.map((tab) => tab.kind)).toEqual(['pdf', 'canvas'])
    const moved = moveTabToPane(mixed, 'a', 'right')
    expect(moved.left).toEqual({ tabs: [note('n.canvas')], activeId: 'n.canvas' })
    expect(moved.right).toEqual({ tabs: [pdf('a')], activeId: 'a' })
    expect(paneOfTab(moved, 'a')).toBe('right')
    expect(moveTabToPane(moved, 'a', 'right')).toBe(moved)
  })

  it('어느 패널에 있든 닫고, 제목을 함께 고친다', () => {
    const panes = moveTabToPane(openTabInPanes(openTabInPanes(empty, pdf('a'), 'left'), pdf('b'), 'left'), 'b', 'right')
    expect(closeTabEverywhere(panes, 'b').right).toEqual(emptyTabs)
    expect(mapPaneTabs(panes, (tab) => ({ ...tab, title: tab.id.toUpperCase() })).right.tabs[0]?.title).toBe('B')
  })
})

describe('reorderTab', () => {
  it('탭을 끌어 놓은 자리로 옮기고 활성 탭은 그대로 둔다', () => {
    const s = { tabs: [spec, book, guide], activeId: book.id }
    expect(reorderTab(s, spec.id, 2)).toEqual({ tabs: [book, guide, spec], activeId: book.id })
    expect(reorderTab(s, guide.id, 0)).toEqual({ tabs: [guide, spec, book], activeId: book.id })
    expect(reorderTab(s, book.id, 1)).toBe(s)
    expect(reorderTab(s, 'missing', 0)).toBe(s)
    expect(reorderTab(s, spec.id, 99).tabs.at(-1)).toBe(spec)
  })
})

describe('3단', () => {
  const pdf = (id: string) => ({ id, title: id, kind: 'pdf' as const })
  it('단을 줄이면 숨는 패널의 탭을 남는 맨 끝 패널로 합친다', () => {
    const panes: PanesState = {
      left: { tabs: [pdf('a')], activeId: 'a' },
      right: { tabs: [pdf('b')], activeId: 'b' },
      third: { tabs: [pdf('c')], activeId: 'c' },
      fourth: emptyTabs,
    }
    const two = mergeHiddenPanes(panes, 2, 'third')
    expect(two.right).toEqual({ tabs: [pdf('b'), pdf('c')], activeId: 'c' })
    expect(two.third.tabs).toEqual([])
    const one = mergeHiddenPanes(two, 1, 'left')
    expect(one.left).toEqual({ tabs: [pdf('a'), pdf('b'), pdf('c')], activeId: 'a' })
    expect(mergeHiddenPanes(one, 1, 'left')).toBe(one)
  })
  it('3단이면 가운데 패널을 가운데라고 부른다', () => {
    expect(paneLabel('right', 2)).toBe('오른쪽')
    expect(paneLabel('right', 3)).toBe('가운데')
    expect(paneLabel('third', 3)).toBe('오른쪽')
  })
})

describe('replaceTab (탭 안에서 판 바꾸기)', () => {
  const pdf = (id: string) => ({ id, title: id, kind: 'pdf' as const })
  it('같은 자리·같은 패널에서 바꾸고 활성 여부를 지킨다', () => {
    const panes: PanesState = { left: { tabs: [pdf('a'), pdf('v1'), pdf('c')], activeId: 'v1' }, right: { tabs: [pdf('z')], activeId: 'z' }, third: emptyTabs, fourth: emptyTabs }
    const next = replaceTab(panes, 'v1', pdf('v2'))
    expect(next.left.tabs.map((tab) => tab.id)).toEqual(['a', 'v2', 'c'])
    expect(next.left.activeId).toBe('v2')
    expect(next.right).toBe(panes.right)
  })
  it('바꿀 판이 이미 열려 있으면 그 탭을 활성화하고 옛 탭은 둔다', () => {
    const panes: PanesState = { left: { tabs: [pdf('v1')], activeId: 'v1' }, right: { tabs: [pdf('v2')], activeId: null }, third: emptyTabs, fourth: emptyTabs }
    const next = replaceTab(panes, 'v1', pdf('v2'))
    expect(next.left.tabs.map((tab) => tab.id)).toEqual(['v1'])
    expect(next.right.activeId).toBe('v2')
  })
})


describe('탭 종류 이름 정리 (note → canvas, memoNote 추가)', () => {
  it('예전에 저장된 note 는 canvas 로 읽고, 새 종류는 그대로, 모르는 값은 null', () => {
    expect(normalizeTabKind('note')).toBe('canvas')
    expect(normalizeTabKind('canvas')).toBe('canvas')
    expect(normalizeTabKind('memoNote')).toBe('memoNote')
    expect(normalizeTabKind('pdf')).toBe('pdf')
    expect(normalizeTabKind('markdown')).toBe('markdown')
    expect(normalizeTabKind('folder')).toBeNull()
    expect(normalizeTabKind(undefined)).toBeNull()
  })
  it('문서 종류와 새 탭 길: 문서는 doc, 메모 노트·캔버스는 note', () => {
    expect(isDocumentKind('pdf')).toBe(true)
    expect(isDocumentKind('markdown')).toBe(true)
    expect(isDocumentKind('memoNote')).toBe(false)
    expect(isDocumentKind('canvas')).toBe(false)
    expect(paneRouteOf('pdf')).toBe('doc')
    expect(paneRouteOf('memoNote')).toBe('note')
    expect(paneRouteOf('canvas')).toBe('note')
  })
})

describe('메모 노트 탭: 옮김·휴지통·이름 따라가기', () => {
  const memo = (id: string, title = id.replace(/^.*\//u, '').replace('.iwnote', '')) => ({ id, title, kind: 'memoNote' as const })
  const pdf = (id: string) => ({ id, title: id, kind: 'pdf' as const })
  const panes = (): PanesState => ({
    left: { tabs: [pdf('doc-a'), memo('노트/A.iwnote')], activeId: '노트/A.iwnote' },
    right: { tabs: [memo('노트/B.iwnote')], activeId: '노트/B.iwnote' },
    third: emptyTabs,
    fourth: emptyTabs,
  })
  const titleOf = (path: string) => path.replace(/^.*\//u, '').replace('.iwnote', '')

  it('이름을 바꾸거나 폴더를 옮기면 그 노트의 탭이 새 경로·새 이름으로 따라가고 활성 탭도 유지된다', () => {
    const next = moveMemoNoteTabs(panes(), new Map([['노트/A.iwnote', '노트/회의/새 A.iwnote']]), titleOf)
    expect(next.left.tabs.map((tab) => [tab.id, tab.title])).toEqual([['doc-a', 'doc-a'], ['노트/회의/새 A.iwnote', '새 A']])
    expect(next.left.activeId).toBe('노트/회의/새 A.iwnote')
    expect(next.right.tabs[0]!.id).toBe('노트/B.iwnote')
  })
  it('옮겨진 노트가 없으면 같은 객체를 돌려준다', () => {
    const state = panes()
    expect(moveMemoNoteTabs(state, new Map([['노트/Z.iwnote', '노트/Y.iwnote']]), titleOf)).toBe(state)
  })
  it('목록에 없는 노트의 탭은 닫고 활성 탭은 이웃으로 물러난다', () => {
    const next = syncMemoNoteTabs(panes(), new Map([['노트/B.iwnote', 'B']]))
    expect(next.left.tabs.map((tab) => tab.id)).toEqual(['doc-a'])
    expect(next.left.activeId).toBe('doc-a')
    expect(next.right.tabs.map((tab) => tab.id)).toEqual(['노트/B.iwnote'])
  })
  it('이름이 달라진 탭은 새 이름으로 고치고, 문서 탭은 건드리지 않는다. 다 맞으면 같은 객체', () => {
    const state = panes()
    const titles = new Map([['노트/A.iwnote', 'A'], ['노트/B.iwnote', '다른 이름']])
    const next = syncMemoNoteTabs(state, titles)
    expect(next.right.tabs[0]!.title).toBe('다른 이름')
    expect(next.left.tabs[0]).toBe(state.left.tabs[0])
    expect(syncMemoNoteTabs(next, titles)).toBe(next)
  })
})
