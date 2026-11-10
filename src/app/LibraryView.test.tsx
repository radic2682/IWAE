// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LibraryView } from './LibraryView'
import { pointerDragTo } from '../test/internalDrag'
import type { VaultTreeNode } from '../core/vaultTree'
import type { VaultSearchRecord } from '../core/vaultSearch'

const tree: VaultTreeNode[] = [
  { id: 'folder:논문', kind: 'folder', name: '논문', path: '논문', children: [] },
  { id: 'pdf:d1', kind: 'pdf', name: '나 논문', folderPath: '', doc: { docId: 'd1', title: '나 논문', pages: 2 } },
  { id: 'pdf:d2', kind: 'pdf', name: '다 참조', folderPath: '', doc: { docId: 'd2', title: '다 참조', pages: 1 } },
  { id: 'note:가.iwae', kind: 'note', name: '가 노트', path: '가.iwae' },
]
const rec = (id: string, path: string, storage: 'vault' | 'reference'): VaultSearchRecord => ({
  id, kind: 'pdf', storage, path, folder: '', filename: '', displayName: '', extractedText: '', pages: [],
  missing: false, favorite: false, lastOpenedAt: null, addedAt: '2026-01-01T00:00:00Z',
})
const records = [rec('d1', 'd1.pdf', 'vault'), rec('d2', 'd2.pdf', 'reference'), rec('n1', '가.iwae', 'vault')]

function setup(over: Partial<ComponentProps<typeof LibraryView>> = {}) {
  const props = {
    tree,
    records,
    itemIcons: { d1: '📕' },
    onOpenItem: vi.fn(),
    onMoveEntry: vi.fn(() => Promise.resolve()),
    ...over,
  }
  render(<LibraryView {...props} />)
  return props
}

const bodyRows = () => screen.getAllByRole('row').slice(1)
const rowNames = () => bodyRows().map((row) => within(row).getAllByRole('gridcell')[1]?.textContent)

describe('LibraryView', () => {
  it('이름순으로 보여 주고 머리를 누르면 순서를 뒤집는다', () => {
    setup()
    expect(rowNames()).toEqual(['가 노트', '나 논문', '다 참조'])
    fireEvent.click(screen.getByRole('button', { name: /이름/ }))
    expect(rowNames()).toEqual(['다 참조', '나 논문', '가 노트'])
  })

  it('이모지가 있는 항목은 이모지로 그린다', () => {
    setup()
    expect(screen.getByText('📕')).toBeTruthy()
  })

  it('항목·폴더 아이콘을 누르면 열지 않고 바로 이모지를 고른다', () => {
    const onPickIcon = vi.fn()
    const props = setup({ onPickIcon })
    const row = bodyRows().find((item) => item.textContent?.includes('나 논문'))!
    fireEvent.click(row.querySelector('[data-emoji-pick]')!)
    expect(onPickIcon).toHaveBeenCalledWith('d1', expect.any(Number), expect.any(Number))
    expect(props.onOpenItem).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('treeitem', { name: '논문' }).querySelector('[data-emoji-pick]')!)
    expect(onPickIcon).toHaveBeenLastCalledWith('folder:논문', expect.any(Number), expect.any(Number))
  })

  it('폴더 줄을 두 번 누르면 이름 바꾸기를 시작하고, 그 자리에서 고친 이름을 넘긴다', () => {
    const onStartFolderRename = vi.fn()
    const onFolderEditCommit = vi.fn()
    const { rerender } = render(<LibraryView tree={tree} records={records} itemIcons={{}} onOpenItem={vi.fn()} onStartFolderRename={onStartFolderRename} />)
    fireEvent.doubleClick(screen.getByRole('treeitem', { name: '논문' }))
    expect(onStartFolderRename).toHaveBeenCalledWith(expect.objectContaining({ path: '논문' }))
    rerender(<LibraryView tree={tree} records={records} itemIcons={{}} onOpenItem={vi.fn()}
      folderEdit={{ kind: 'rename', path: '논문', name: '논문' }} onFolderEditCommit={onFolderEditCommit} onFolderEditCancel={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: '논문 폴더 이름' })
    fireEvent.change(input, { target: { value: '논문 2026' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onFolderEditCommit).toHaveBeenCalledWith('논문 2026')
  })

  it('새 하위 폴더 이름 칸을 그 폴더 아래에 띄운다', () => {
    const onFolderEditCommit = vi.fn()
    render(<LibraryView tree={tree} records={records} itemIcons={{}} onOpenItem={vi.fn()}
      folderEdit={{ kind: 'create', parentPath: '논문' }} onFolderEditCommit={onFolderEditCommit} onFolderEditCancel={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: '새 폴더 이름' })
    fireEvent.change(input, { target: { value: '2026' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onFolderEditCommit).toHaveBeenCalledWith('2026')
  })

  it('메뉴의 이름 바꾸기 요청이 오면 그 항목의 이름 칸을 연다', () => {
    setup({ onRenameItem: vi.fn().mockResolvedValue(undefined), renameRequest: { id: 'd1', nonce: 1 } })
    expect(screen.getByRole('textbox', { name: '나 논문 이름' })).toBeTruthy()
  })

  it('Ctrl·Shift 로 여러 항목을 고른다', () => {
    setup()
    const rows = bodyRows()
    fireEvent.click(rows[0]!)
    fireEvent.click(rows[2]!, { shiftKey: true })
    expect(rows.every((row) => row.getAttribute('aria-selected') === 'true')).toBe(true)
    fireEvent.click(rows[1]!, { ctrlKey: true })
    expect(rows[1]!.getAttribute('aria-selected')).toBe('false')
  })

  it('끌어 놓은 선택을 폴더로 옮긴다 — 참조 PDF도 Library 안 위치는 옮긴다', async () => {
    const props = setup()
    const rows = bodyRows()
    fireEvent.click(rows[1]!)
    fireEvent.click(rows[2]!, { ctrlKey: true })
    pointerDragTo(rows[1]!, screen.getByRole('treeitem', { name: '논문' }))
    await waitFor(() => expect(props.onMoveEntry).toHaveBeenCalledTimes(2))
    expect(props.onMoveEntry).toHaveBeenCalledWith('d1', '논문')
    expect(props.onMoveEntry).toHaveBeenCalledWith('d2', '논문')
    expect(await screen.findByText(/2개 항목을 '논문'\(으\)로 이동했습니다/)).toBeTruthy()
    expect(screen.queryByText(/외부 참조/)).toBeNull()
  })

  it('이동이 실패하면 실패한 항목을 알린다', async () => {
    const onMoveEntry = vi.fn(() => Promise.reject(new Error('이미 같은 이름이 있습니다')))
    setup({ onMoveEntry })
    const rows = bodyRows()
    pointerDragTo(rows[1]!, screen.getByRole('treeitem', { name: '논문' }))
    expect(await screen.findByText(/실패 1개: 나 논문: 이미 같은 이름이 있습니다/)).toBeTruthy()
  })

  it('두 번 클릭하거나 Enter 로 연다', () => {
    const props = setup()
    const rows = bodyRows()
    fireEvent.doubleClick(rows[1]!)
    expect(props.onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pdf' }))
    fireEvent.keyDown(rows[0]!, { key: 'Enter' })
    expect(props.onOpenItem).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'note' }))
  })

  it('날짜를 읽을 수 없으면 Invalid Date 대신 빈칸을 둔다', () => {
    setup({ records: [{ ...rec('d1', 'd1.pdf', 'vault'), addedAt: 'not-a-date' }] })
    const row = bodyRows().find((candidate) => candidate.textContent?.includes('나 논문'))
    expect(row?.textContent).not.toContain('Invalid Date')
    expect(row!.querySelector('.library-cell-date')?.textContent).toBe('')
  })

  it('이름 필터로 줄인다', () => {
    setup()
    fireEvent.change(screen.getByRole('searchbox', { name: '라이브러리 필터' }), { target: { value: '참조' } })
    expect(rowNames()).toEqual(['다 참조'])
  })
})

describe('LibraryView — 서지 칸', () => {
  it('PDF의 저자·연도를 보여 준다', () => {
    setup({ bibliography: { d1: { authors: ['Ada Lovelace'], year: 1843, source: 'manual', updatedAt: 'x' } } })
    const row = screen.getAllByRole('row').find((candidate) => candidate.textContent?.includes('나 논문'))!
    expect(row.textContent).toContain('Ada Lovelace')
    expect(row.textContent).toContain('1843')
    expect(screen.getByRole('button', { name: /저자/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /연도/ })).toBeDefined()
  })
})

describe('LibraryView — 왼쪽 바 / 오른쪽 표 분리', () => {
  it('모음·폴더 목록은 navHost 에, 표와 필터는 tableHost 에 그린다', () => {
    const navHost = document.createElement('div')
    const tableHost = document.createElement('div')
    document.body.append(navHost, tableHost)
    render(<LibraryView tree={tree} records={records} itemIcons={{}} onOpenItem={vi.fn()} navHost={navHost} tableHost={tableHost} />)
    expect(within(navHost).getByRole('treeitem', { name: '전체' })).toBeTruthy()
    expect(within(navHost).getByRole('treeitem', { name: '논문' })).toBeTruthy()
    expect(within(navHost).queryByRole('grid')).toBeNull()
    expect(within(tableHost).getByRole('grid')).toBeTruthy()
    expect(within(tableHost).getByRole('searchbox')).toBeTruthy()
    expect(within(tableHost).queryByRole('treeitem')).toBeNull()
    // 왼쪽 바에서 고른 모음이 오른쪽 표를 거른다
    expect(within(tableHost).getAllByRole('row')).toHaveLength(4)
    fireEvent.click(within(navHost).getByRole('treeitem', { name: '즐겨찾기' }))
    expect(within(navHost).getByRole('treeitem', { name: '즐겨찾기' }).getAttribute('aria-selected')).toBe('true')
    expect(within(tableHost).getAllByRole('row')).toHaveLength(1)
    navHost.remove()
    tableHost.remove()
  })

  it('알림이 없으면 아래 띠는 비어 있다(CSS 가 숨긴다)', () => {
    setup()
    expect(screen.getByRole('status').textContent).toBe('')
  })
})

describe('LibraryView — 열 감추기와 카드 보기', () => {
  it('모든 항목에서 비어 있는 열(저자·연도·폴더·저장)은 감춘다', () => {
    setup({ records: [rec('d1', 'd1.pdf', 'vault'), rec('n1', '가.iwae', 'vault')] })
    const names = screen.getAllByRole('columnheader').map((header) => header.textContent)
    expect(names).not.toContain('저자')
    expect(names).not.toContain('연도')
    expect(names).not.toContain('저장')
    expect(names).toContain('이름')
  })

  it('항목이 가진 열은 보인다', () => {
    setup({ bibliography: { d1: { authors: ['Ada'], year: 1843, source: 'manual', updatedAt: 'x' } } })
    const names = screen.getAllByRole('columnheader').map((header) => header.textContent)
    expect(names).toContain('저자')
    expect(names).toContain('연도')
    expect(names).toContain('저장')
  })

  it('카드 보기로 바꾸면 카드가 나오고 두 번 누르면 연다', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: '카드로 보기' }))
    const cards = screen.getAllByRole('option')
    expect(cards.length).toBe(3)
    fireEvent.doubleClick(screen.getByRole('option', { name: '나 논문' }))
    expect(props.onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pdf' }))
    fireEvent.click(screen.getByRole('button', { name: '목록으로 보기' }))
    expect(screen.getByRole('grid')).toBeTruthy()
  })
})
