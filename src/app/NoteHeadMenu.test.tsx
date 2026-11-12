// @vitest-environment jsdom
import { useMemo } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MemoNote } from '../core/memoNote'
import { takeTitleEdit, type MemoNoteApi } from '../pdf/memoNoteContext'
import { NoteHeadMenu } from './NoteHeadMenu'

const PATH = '노트/전원.iwnote'
const OTHER = '노트/통신.iwnote'
const notes: Record<string, MemoNote> = {
  [PATH]: { version: 1, docId: 'doc-a', blocks: [] } as MemoNote,
  [OTHER]: { version: 1, blocks: [] } as MemoNote,
}

function makeSpies() {
  return {
    openInTab: vi.fn(),
    createForDoc: vi.fn().mockResolvedValue('노트/새.iwnote'),
    create: vi.fn().mockResolvedValue('노트/새 노트.iwnote'),
    trashNote: vi.fn().mockResolvedValue(undefined),
  }
}

function Harness({ spies, path = PATH, withSwitch = true }: { readonly spies: ReturnType<typeof makeSpies>; readonly path?: string; readonly withSwitch?: boolean }) {
  const api = useMemo<MemoNoteApi>(() => ({
    entries: withSwitch ? [{ path: PATH, title: '전원', docId: 'doc-a' }, { path: OTHER, title: '통신' }] : [],
    openPath: null,
    openTitle: null,
    openNote: null,
    open: vi.fn(),
    create: spies.create as never,
    updateOpen: vi.fn(),
    noteAt: (target) => notes[target] ?? null,
    updateNoteAt: vi.fn(),
    notesOf: () => [],
    openInTab: spies.openInTab as never,
    createForDoc: spies.createForDoc as never,
    trashNote: spies.trashNote as never,
    docOwner: (docId) => (docId === 'doc-a' ? 'doc-a' : null),
    docLabel: (docId) => (docId === 'doc-a' ? '전원 설계서' : docId),
    rename: vi.fn(),
  }), [spies, withSwitch])
  return <NoteHeadMenu api={api} path={path} />
}

afterEach(cleanup)

describe('NoteHeadMenu — 칸 머리의 노트 열기(노트 바꾸기) ⌄', () => {
  const trigger = (name = /노트 바꾸기: 전원/) => screen.getByRole('button', { name })

  it('누르면 「노트 열기」 목록이 열려 다른 노트를 탭으로 연다', () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(trigger())
    const menu = screen.getByRole('menu', { name: '노트 열기' })
    expect(within(menu).getByRole('menuitemradio', { name: '전원' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: '통신' }))
    expect(spies.openInTab).toHaveBeenCalledWith(OTHER)
    expect(screen.queryByRole('menu', { name: '노트 열기' })).toBeNull()
  })

  it('목록은 body 에 떠 있어(탭 줄에 잘리지 않는다) 단추를 다시 누르면 닫힌다', () => {
    render(<Harness spies={makeSpies()} />)
    fireEvent.click(trigger())
    expect(document.body.querySelector(':scope > .note-head-menu-pop .note-switch-menu')).not.toBeNull()
    fireEvent.click(trigger())
    expect(screen.queryByRole('menu', { name: '노트 열기' })).toBeNull()
  })

  it('문서에 속한 노트에서는 「이 PDF에 노트 만들기」가 그 PDF 의 새 노트를 만들어 탭으로 열고 이름 칸을 요청한다', async () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitem', { name: '이 PDF에 노트 만들기' }))
    await waitFor(() => expect(spies.openInTab).toHaveBeenCalledWith('노트/새.iwnote'))
    expect(spies.createForDoc).toHaveBeenCalledWith('doc-a')
    expect(takeTitleEdit('노트/새.iwnote')).toBe(true)
  })

  it('일반 노트에서는 「새 노트 만들기」가 새 노트를 만들어 탭으로 연다', async () => {
    const spies = makeSpies()
    render(<Harness spies={spies} path={OTHER} />)
    fireEvent.click(trigger(/노트 바꾸기: 통신/))
    fireEvent.click(screen.getByRole('menuitem', { name: '새 노트 만들기' }))
    await waitFor(() => expect(spies.openInTab).toHaveBeenCalledWith('노트/새 노트.iwnote'))
  })

  it('「이 노트 휴지통으로 이동…」은 확인 창(취소에 초점)을 거쳐 이 노트를 옮긴다', async () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(trigger())
    fireEvent.click(within(screen.getByRole('menu', { name: '노트 열기' })).getByRole('menuitem', { name: '이 노트 휴지통으로 이동…' }))
    const dialog = await screen.findByRole('dialog', { name: '노트 삭제' })
    expect(within(dialog).getByText('‘전원’ 노트를 휴지통으로 옮길까요?')).toBeDefined()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '취소' }))
    expect(spies.trashNote).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '휴지통으로 이동' }))
    await waitFor(() => expect(spies.trashNote).toHaveBeenCalledWith(PATH, 'note-tab-confirmed'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('취소하면 옮기지 않는다', async () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(trigger())
    fireEvent.click(within(screen.getByRole('menu', { name: '노트 열기' })).getByRole('menuitem', { name: '이 노트 휴지통으로 이동…' }))
    fireEvent.click(await screen.findByRole('button', { name: '취소' }))
    expect(spies.trashNote).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('바꿀 노트가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<Harness spies={makeSpies()} withSwitch={false} />)
    expect(container.querySelector('button')).toBeNull()
  })
})
