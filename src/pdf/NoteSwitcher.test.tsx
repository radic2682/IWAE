// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NoteSwitcherMenu, noteSwitcherGroups } from './NoteSwitcher'
import { EMPTY_MEMO_NOTE } from '../core/memoNote'
import type { MemoNoteApi } from './memoNoteContext'

afterEach(cleanup)

const entries = [
  { path: '노트/일반.iwnote', title: '일반' },
  { path: '노트/S1.iwnote', title: 'S1', docId: 'docS' },
  { path: '노트/S2.iwnote', title: 'S2', docId: 'docS' },
  { path: '노트/T1.iwnote', title: 'T1', docId: 'docT' },
]

function makeApi(overrides: Partial<MemoNoteApi> = {}): MemoNoteApi {
  return {
    entries,
    openPath: '노트/일반.iwnote',
    openTitle: '일반',
    openNote: EMPTY_MEMO_NOTE,
    open: vi.fn(),
    create: vi.fn(),
    updateOpen: vi.fn(),
    noteAt: () => null,
    updateNoteAt: vi.fn(),
    notesOf: () => [],
    docOwner: (docId) => (docId === 'docS' || docId === 'docT' ? docId : null),
    docLabel: (docId) => (docId === 'docS' ? 'Sleep Paper' : docId),
    createForDoc: vi.fn().mockResolvedValue('노트/new.iwnote'),
    ...overrides,
  }
}

describe('노트 열기 목록 — 그룹', () => {
  it('지금 PDF 의 노트와 다른(일반) 노트로 나눈다. 다른 PDF 의 노트는 지금 보는 노트일 때만 다른 노트에 낀다', () => {
    const groups = noteSwitcherGroups(makeApi(), 'docS', '노트/일반.iwnote')
    expect(groups.owner).toBe('docS')
    expect(groups.mine.map((entry) => entry.title)).toEqual(['S1', 'S2'])
    expect(groups.others.map((entry) => entry.title)).toEqual(['일반'])
    const other = noteSwitcherGroups(makeApi(), 'docS', '노트/T1.iwnote')
    expect(other.others.map((entry) => entry.title)).toEqual(['일반', 'T1'])
    // 노트를 PDF 별로 나누지 않는 문서(Markdown·일반 노트): 모두 한 목록
    const markdown = noteSwitcherGroups(makeApi(), 'notes/readme.md', null)
    expect(markdown.owner).toBeNull()
    expect(markdown.others).toHaveLength(4)
    expect(noteSwitcherGroups(makeApi(), '', null).owner).toBeNull()
  })
})

describe('노트 열기 목록 — 메뉴', () => {
  const renderMenu = (api: MemoNoteApi, props: Partial<Parameters<typeof NoteSwitcherMenu>[0]> = {}) => {
    const onPick = vi.fn()
    const onClose = vi.fn()
    render(<NoteSwitcherMenu api={api} currentDocId="docS" docLabel="Sleep Paper" currentPath="노트/S1.iwnote" onPick={onPick} onClose={onClose} {...props} />)
    return { onPick, onClose, menu: screen.getByRole('menu', { name: '노트 열기' }) }
  }

  it('「이 PDF의 노트」와 「다른 노트」를 보이고, 지금 노트를 표시하며, 고르면 그 노트로 열고 닫는다', () => {
    const { menu, onPick, onClose } = renderMenu(makeApi())
    expect(within(menu).getByText('이 PDF의 노트 · Sleep Paper')).toBeDefined()
    expect(within(menu).getByText('다른 노트')).toBeDefined()
    expect(within(menu).getByRole('menuitemradio', { name: 'S1' }).getAttribute('aria-checked')).toBe('true')
    expect(within(menu).getByRole('menuitemradio', { name: '일반' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: '일반' }))
    expect(onPick).toHaveBeenCalledWith('노트/일반.iwnote')
    expect(onClose).toHaveBeenCalled()
  })

  it('고른 노트는 api.open(마지막으로 만진 노트)을 바꾸지 않고 onPick 에 맡긴다', () => {
    const api = makeApi()
    const { menu } = renderMenu(api)
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'S2' }))
    expect(api.open).not.toHaveBeenCalled()
  })

  it('「이 PDF에 노트 만들기」는 그 PDF 에 노트가 없을 때도 보인다', () => {
    const onCreate = vi.fn()
    renderMenu(makeApi({ entries: [{ path: '노트/일반.iwnote', title: '일반' }] }), { onCreate })
    fireEvent.click(screen.getByRole('menuitem', { name: '이 PDF에 노트 만들기' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('문서에 속하지 않은 노트(일반 노트)에서는 「새 노트 만들기」가 보인다', () => {
    const onCreate = vi.fn()
    renderMenu(makeApi(), { currentDocId: '', currentPath: '노트/일반.iwnote', onCreate })
    expect(screen.queryByRole('menuitem', { name: '이 PDF에 노트 만들기' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '새 노트 만들기' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('맨 아래 「이 노트 휴지통으로 이동…」은 지금 노트가 있고 휴지통 동작이 있을 때만 보인다', () => {
    const onTrashCurrent = vi.fn()
    const { menu, onClose } = renderMenu(makeApi(), { onTrashCurrent })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.at(-1)?.textContent).toBe('이 노트 휴지통으로 이동…')
    fireEvent.click(items.at(-1)!)
    expect(onTrashCurrent).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
    cleanup()
    renderMenu(makeApi())
    expect(screen.queryByRole('menuitem', { name: '이 노트 휴지통으로 이동…' })).toBeNull()
  })

  it('옛 「이 노트를 탭으로 열기」 항목은 없다(노트는 늘 탭이다)', () => {
    renderMenu(makeApi({ openInTab: vi.fn() }), { onTrashCurrent: vi.fn() })
    expect(screen.queryByRole('menuitem', { name: '이 노트를 탭으로 열기' })).toBeNull()
  })
})
