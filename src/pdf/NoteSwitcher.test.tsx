// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { NoteBarHeader } from './NoteBarHeader'
import { noteSwitcherGroups } from './NoteSwitcher'
import { EMPTY_MEMO_NOTE } from '../core/memoNote'
import type { MemoNoteApi } from './memoNoteContext'

const entries = [
  { path: '노트/일반.iwnote', title: '일반' },
  { path: '노트/S1.iwnote', title: 'S1', docId: 'docS' },
  { path: '노트/S2.iwnote', title: 'S2', docId: 'docS' },
  { path: '노트/T1.iwnote', title: 'T1', docId: 'docT' },
]

function makeApi(overrides: Partial<MemoNoteApi> = {}): MemoNoteApi {
  const openPath = overrides.openPath ?? '노트/일반.iwnote'
  return {
    entries,
    openPath,
    openTitle: entries.find((entry) => entry.path === openPath)?.title ?? null,
    openNote: EMPTY_MEMO_NOTE,
    open: vi.fn(),
    create: vi.fn(),
    updateOpen: vi.fn(),
    notesOf: () => [],
    docOwner: (docId) => (docId === 'docS' || docId === 'docT' ? docId : null),
    docLabel: (docId) => (docId === 'docS' ? 'Sleep Paper' : docId),
    createForDoc: vi.fn().mockResolvedValue('노트/new.iwnote'),
    ...overrides,
  }
}

function renderHeader(api: MemoNoteApi, currentDocId = 'docS') {
  render(
    <NoteBarHeader api={api} fallbackTitle="노트 없음" highlights={[]} currentDocId={currentDocId} onPickResult={vi.fn()} />,
  )
}

describe('노트 바꾸기(오른쪽 바 머리)', () => {
  it('지금 PDF 의 노트와 다른(일반) 노트로 나눈다. 다른 PDF 의 노트는 열려 있을 때만 다른 노트에 낀다', () => {
    const groups = noteSwitcherGroups(makeApi(), 'docS')
    expect(groups.owner).toBe('docS')
    expect(groups.mine.map((entry) => entry.title)).toEqual(['S1', 'S2'])
    expect(groups.others.map((entry) => entry.title)).toEqual(['일반'])
    const open = noteSwitcherGroups(makeApi({ openPath: '노트/T1.iwnote' }), 'docS')
    expect(open.others.map((entry) => entry.title)).toEqual(['일반', 'T1'])
    // 노트를 PDF 별로 나누지 않는 문서(Markdown): 모두 한 목록
    const markdown = noteSwitcherGroups(makeApi(), 'notes/readme.md')
    expect(markdown.owner).toBeNull()
    expect(markdown.others).toHaveLength(4)
  })

  it('제목을 누르면 목록이 열리고, 현재 노트가 표시되며, 다른 노트를 누르면 바꾼다', () => {
    const api = makeApi({ openPath: '노트/S1.iwnote' })
    renderHeader(api)
    fireEvent.click(screen.getByRole('button', { name: /노트 바꾸기: S1/ }))
    const menu = screen.getByRole('menu', { name: '노트 바꾸기' })
    expect(within(menu).getByText('이 PDF의 노트 · Sleep Paper')).toBeDefined()
    expect(within(menu).getByText('다른 노트')).toBeDefined()
    expect(within(menu).getByRole('menuitemradio', { name: 'S1' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: '일반' }))
    expect(api.open).toHaveBeenCalledWith('노트/일반.iwnote')
    expect(screen.queryByRole('menu', { name: '노트 바꾸기' })).toBeNull()
  })

  it('「이 PDF에 노트 만들기」는 목록 끝에 있고, 그 PDF 에 노트가 없을 때도 보인다', () => {
    const api = makeApi({ entries: [{ path: '노트/일반.iwnote', title: '일반' }] })
    renderHeader(api)
    fireEvent.click(screen.getByRole('button', { name: /노트 바꾸기/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '이 PDF에 노트 만들기' }))
    expect(api.createForDoc).toHaveBeenCalledWith('docS')
  })

  it('제목 옆에 이 PDF 의 노트 개수 칩을 붙이지 않는다(제목 자리를 넓게 쓴다)', () => {
    renderHeader(makeApi())
    expect(screen.queryByText(/이 PDF \d/)).toBeNull()
  })
})
