// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import type { VaultTreeNode } from '../../core/vaultTree'

const docs = [
  { docId: 'aaaaaaaaaaaa', title: 'Sleep Paper', pages: 20 },
  { docId: 'bbbbbbbbbbbb', title: 'Garden Survey', pages: 27 },
]
const tree: readonly VaultTreeNode[] = docs.map((doc) => ({ id: `pdf:${doc.docId}`, kind: 'pdf', name: doc.title, folderPath: '', doc }))
const entries = [
  { path: '노트/일반.iwnote', title: '일반 노트' },
  { path: '노트/Sleep 노트.iwnote', title: 'Sleep 노트', docId: 'aaaaaaaaaaaa' },
  { path: '노트/고아.iwnote', title: '고아 노트', docId: 'deleted-doc' },
]

function renderSidebar() {
  const memo = {
    entries,
    docOwner: (docId: string) => docs.some((doc) => doc.docId === docId) ? docId : null,
    openPath: null,
    onOpen: vi.fn(),
    onOpenInTab: vi.fn(),
    onCreate: vi.fn(),
    onCreateForDoc: vi.fn(),
    onRename: vi.fn().mockResolvedValue(undefined),
    onTrash: vi.fn().mockResolvedValue(undefined),
  }
  render(
    <Sidebar library={docs} notebooks={[]} tree={tree} onOpenDoc={vi.fn()} onOpenNote={vi.fn()} onAddDoc={vi.fn()} openDocIds={[]} openNotePaths={[]} memoNotes={memo} />,
  )
  return memo
}

describe('Sidebar — PDF 별 노트', () => {
  it('PDF 의 노트는 그 줄 아래(펼치면)에만 보이고, 일반 노트와 사라진 PDF 의 노트는 아래 「노트」 구역에 남는다', () => {
    renderSidebar()
    const bottom = screen.getByRole('tree', { name: '노트 트리' })
    expect(within(bottom).getByRole('button', { name: /일반 노트/ })).toBeDefined()
    expect(within(bottom).getByRole('button', { name: /고아 노트/ })).toBeDefined()
    expect(within(bottom).queryByRole('button', { name: /Sleep 노트/ })).toBeNull()
    // 접혀 있으면 PDF 아래에도 보이지 않는다
    expect(screen.queryByRole('group', { name: '이 PDF의 노트' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sleep Paper 펼치기' }))
    const list = screen.getByRole('group', { name: '이 PDF의 노트' })
    expect(within(list).getByRole('button', { name: /Sleep 노트/ })).toBeDefined()
    expect(within(bottom).queryByRole('button', { name: /Sleep 노트/ })).toBeNull()
  })

  it('노트가 있는 PDF 줄에만 아이콘 점과 펼침 화살표가 있다', () => {
    renderSidebar()
    const sleep = screen.getByRole('button', { name: 'Sleep Paper' })
    expect(sleep.querySelector('.side-doc-note-dot')).not.toBeNull()
    const garden = screen.getByRole('button', { name: 'Garden Survey' })
    expect(garden.querySelector('.side-doc-note-dot')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Garden Survey 펼치기' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /펼치기$/ })).toHaveLength(1)
  })

  it('「+」는 그 PDF 에 노트를 만들고, 노트 줄을 누르면 연다', () => {
    const memo = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Garden Survey에 노트 만들기' }))
    expect(memo.onCreateForDoc).toHaveBeenCalledWith('bbbbbbbbbbbb')
    fireEvent.click(screen.getByRole('button', { name: 'Sleep Paper 펼치기' }))
    fireEvent.click(within(screen.getByRole('group', { name: '이 PDF의 노트' })).getByRole('button', { name: /Sleep 노트/ }))
    expect(memo.onOpen).toHaveBeenCalledWith('노트/Sleep 노트.iwnote')
  })

  it('PDF 아래 노트 줄의 우클릭 메뉴에도 「탭으로 열기」가 있다', () => {
    const memo = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Sleep Paper 펼치기' }))
    fireEvent.contextMenu(within(screen.getByRole('group', { name: '이 PDF의 노트' })).getByRole('button', { name: /Sleep 노트/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '탭으로 열기' }))
    expect(memo.onOpenInTab).toHaveBeenCalledWith('노트/Sleep 노트.iwnote')
    expect(memo.onOpen).not.toHaveBeenCalled()
  })

  it('PDF 줄 우클릭 메뉴에도 「이 PDF에 노트 만들기」가 있다', () => {
    const memo = renderSidebar()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Garden Survey' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '이 PDF에 노트 만들기' }))
    expect(memo.onCreateForDoc).toHaveBeenCalledWith('bbbbbbbbbbbb')
  })

  it('PDF 아래 노트도 이름 바꾸기·지우기를 한다', () => {
    const memo = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Sleep Paper 펼치기' }))
    const noteButton = () => within(screen.getByRole('group', { name: '이 PDF의 노트' })).getByRole('button', { name: /Sleep 노트/ })
    fireEvent.contextMenu(noteButton())
    fireEvent.click(screen.getByRole('menuitem', { name: '휴지통으로 이동' }))
    expect(memo.onTrash).toHaveBeenCalledWith('노트/Sleep 노트.iwnote')
    fireEvent.doubleClick(noteButton())
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '새 이름' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(memo.onRename).toHaveBeenCalledWith('노트/Sleep 노트.iwnote', '새 이름')
  })
})
