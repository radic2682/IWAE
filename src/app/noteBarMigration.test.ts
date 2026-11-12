import { describe, expect, it } from 'vitest'
import { barMigrationKey, legacyBarWasOpen, LEGACY_BAR_KEY, migrateNoteBar } from './noteBarMigration'
import { emptyTabs, type PaneId, type PanesState, type Tab } from './tabs'
import { DEFAULT_CHANNELS } from './workspaceChannels'

const pdf = (id: string): Tab => ({ id, title: id, kind: 'pdf' })
const note = (id: string): Tab => ({ id, title: id, kind: 'memoNote' })
const strip = (tabs: Tab[], activeId: string | null = tabs[0]?.id ?? null) => ({ tabs, activeId })
const panes = (p: Partial<PanesState>): PanesState => ({ left: emptyTabs, right: emptyTabs, third: emptyTabs, fourth: emptyTabs, ...p })
const ids = (state: { tabs: readonly Tab[] }) => state.tabs.map((tab) => tab.id)

const storage = (value: string | null | 'throw') => ({
  getItem: (key: string) => {
    if (value === 'throw') throw new Error('blocked')
    return key === LEGACY_BAR_KEY ? value : null
  },
})

describe('legacyBarWasOpen — 예전 노트 바가 열려 있었나', () => {
  it('저장값이 없으면(처음 쓰는 사람) 열려 있던 것으로 본다. off 만 닫혀 있던 것', () => {
    expect(legacyBarWasOpen(storage(null))).toBe(true)
    expect(legacyBarWasOpen(storage('on'))).toBe(true)
    expect(legacyBarWasOpen(storage('off'))).toBe(false)
  })

  it('저장소를 읽을 수 없으면 열려 있던 것으로 본다', () => {
    expect(legacyBarWasOpen(storage('throw'))).toBe(true)
    expect(legacyBarWasOpen(null)).toBe(true)
  })

  it('Vault 마다 한 번만 옮긴다는 표시의 열쇠', () => {
    expect(barMigrationKey('C:/a')).not.toBe(barMigrationKey('C:/b'))
  })
})

describe('migrateNoteBar — 예전 세션을 「읽기」(문서 | 노트)로', () => {
  const base = { barOpen: true, channels: DEFAULT_CHANNELS, visible: ['left'] as readonly PaneId[], layoutId: 'single' as const, anchor: 'left' as PaneId, notePath: '노트/N.iwnote' }

  it('노트 바가 열려 있던 세션: 문서 창 오른쪽에 그 노트를 같은 색 노트 창으로 연다', () => {
    const result = migrateNoteBar({ ...base, panes: panes({ left: strip([pdf('D')]) }) })!
    expect(result.layout).toBe('cols2')
    expect(ids(result.panes.left)).toEqual(['D'])
    expect(ids(result.panes.right)).toEqual(['노트/N.iwnote'])
    expect(result.panes.right.tabs[0]).toMatchObject({ kind: 'memoNote', title: 'N' })
    expect(result.channels.right).toBe(result.channels.left)
  })

  it('이미 좌우 둘로 나눠 쓰던 세션이면 문서 창 옆에 끼운다(탭은 하나도 닫히지 않는다)', () => {
    const state = panes({ left: strip([pdf('D')]), right: strip([pdf('E')]) })
    const result = migrateNoteBar({ ...base, panes: state, visible: ['left', 'right'], layoutId: 'cols2' })!
    expect(result.layout).toBe('cols3')
    expect(ids(result.panes.left)).toEqual(['D'])
    expect(ids(result.panes.right)).toEqual(['노트/N.iwnote'])
    expect(ids(result.panes.third)).toEqual(['E'])
  })

  it('노트 바를 닫아 둔 세션은 노트 창 없이 그대로 연다', () => {
    expect(migrateNoteBar({ ...base, barOpen: false, panes: panes({ left: strip([pdf('D')]) }) })).toBeNull()
  })

  it('열린 문서가 없거나 보일 노트가 없으면 아무것도 하지 않는다', () => {
    expect(migrateNoteBar({ ...base, anchor: null, panes: panes({}) })).toBeNull()
    expect(migrateNoteBar({ ...base, notePath: null, panes: panes({ left: strip([pdf('D')]) }) })).toBeNull()
  })

  it('이미 메모 노트 탭이 있는 세션(새 방식으로 쓰던 사람)은 건드리지 않는다', () => {
    expect(migrateNoteBar({ ...base, panes: panes({ left: strip([pdf('D')]), right: strip([note('X')]) }), visible: ['left', 'right'], layoutId: 'cols2' })).toBeNull()
  })
})
