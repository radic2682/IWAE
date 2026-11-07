// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Sidebar } from './Sidebar'
import type { VaultTreeNode } from '../core/vaultTree'
import type { VersionGroup } from '../core/versionGroups'

const docs = [
  { docId: 'aaaaaaaaaaaa', title: 'Handbook Jan 2025', pages: 20 },
  { docId: 'bbbbbbbbbbbb', title: 'Handbook Jul 2026', pages: 27 },
  { docId: 'cccccccccccc', title: 'Other', pages: 3 },
]

const group: VersionGroup = {
  id: 'g1',
  title: 'Handbook',
  anchorDocId: 'aaaaaaaaaaaa',
  defaultDocId: 'bbbbbbbbbbbb',
  versions: [
    { docId: 'aaaaaaaaaaaa', label: 'Jan 2025', addedAt: '2026-01-01' },
    { docId: 'bbbbbbbbbbbb', label: 'Jul 2026', addedAt: '2026-01-01' },
  ],
}

const tree: readonly VaultTreeNode[] = docs.map((doc) => ({ id: `pdf:${doc.docId}`, kind: 'pdf', name: doc.title, folderPath: '', doc }))

function renderSidebar() {
  const onOpenDoc = vi.fn()
  const actions = { onOpen: vi.fn(), onPin: vi.fn(), onRename: vi.fn(), onRemove: vi.fn(), onDissolve: vi.fn(), onAddVersion: vi.fn(), onRenameGroup: vi.fn() }
  const onRenameEntry = vi.fn()
  render(
    <Sidebar
      library={docs}
      notebooks={[]}
      tree={tree}
      onOpenDoc={onOpenDoc}
      onOpenNote={vi.fn()}
      onAddDoc={vi.fn()}
      openDocIds={['bbbbbbbbbbbb']}
      versionGroups={{ g1: group }}
      versionActions={actions}
      openNotePaths={[]}
      onRenameEntry={onRenameEntry}
    />,
  )
  return { onOpenDoc, actions, onRenameEntry }
}

describe('Sidebar — 문서 판 묶음', () => {
  it('판들은 한 줄로 겹쳐 보이고, 줄에는 기본 판 이름 칩이 붙는다(겹친 판은 목록에서 숨는다)', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: 'Handbook Jul 2026' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Handbook Jul 2026 Jul' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Other' })).toBeDefined()
    expect(screen.getByRole('button', { name: /Handbook 기본 버전 고르기: 지금 Jul 2026/ }).textContent).toContain('Jul 2026')
    // 켜짐 바탕은 제목과 칩을 묶은 줄 전체에 깔린다
    expect(screen.getByRole('button', { name: 'Handbook Jul 2026' }).closest('.side-version-line-open')).not.toBeNull()
  })

  it('묶음 줄을 누르면 기본 판 문서를 연다', () => {
    const { onOpenDoc } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Handbook Jul 2026' }))
    expect(onOpenDoc).toHaveBeenCalledWith(expect.objectContaining({ docId: 'bbbbbbbbbbbb' }))
  })

  it('칩(a)을 누르면 기본 판 드롭다운, 옆 단추는 펼치기. 펼친 줄에서 켜진 판은 하이라이팅, 누르면 연다', () => {
    const { actions } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /Handbook 기본 버전 고르기/ }))
    const menu = screen.getByRole('menu', { name: 'Handbook 기본 버전' })
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: /Jan 2025/ }))
    expect(actions.onPin).toHaveBeenCalledWith('aaaaaaaaaaaa')
    expect(screen.queryByRole('menu', { name: 'Handbook 기본 버전' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Handbook 버전 펼치기' }))
    const rows = screen.getByRole('group', { name: 'Handbook 버전' })
    const open = within(rows).getByRole('button', { name: /Jul 2026 열기/ })
    expect(open.className).toContain('side-version-row-open')
    expect(within(rows).getByRole('button', { name: /Jan 2025 열기/ }).className).not.toContain('side-version-row-open')
    fireEvent.click(within(rows).getByRole('button', { name: /Jan 2025 열기/ }))
    expect(actions.onOpen).toHaveBeenCalledWith('aaaaaaaaaaaa')
    expect(within(rows).queryByRole('button', { name: /빼기/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Handbook 버전 접기' }))
    expect(screen.queryByRole('group', { name: 'Handbook 버전' })).toBeNull()
  })

  it('묶음 줄을 더블클릭해 이름을 바꾸면 묶음 이름이 바뀐다(대표 문서 이름이 아니라)', async () => {
    const { actions, onRenameEntry } = renderSidebar()
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Handbook Jul 2026' }))
    const input = screen.getByRole('textbox', { name: /표시 이름/ }) as HTMLInputElement
    expect(input.value).toBe('Handbook')
    fireEvent.change(input, { target: { value: 'Release Notes Archive' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await Promise.resolve()
    expect(actions.onRenameGroup).toHaveBeenCalledWith('g1', 'Release Notes Archive')
    expect(onRenameEntry).not.toHaveBeenCalled()
  })
})
