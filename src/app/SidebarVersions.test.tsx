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
  it('판들은 한 줄로 겹쳐 보이고, 줄 제목 뒤에 지금 버전이 붙는다(칩은 없고, 겹친 판은 목록에서 숨는다)', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: 'Handbook Jul 2026' }).textContent).toContain('Handbook · Jul 2026')
    expect(screen.queryByRole('button', { name: 'Handbook Jul 2026 Jul' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Other' })).toBeDefined()
    expect(screen.queryByRole('button', { name: /기본 버전 고르기/ })).toBeNull()
    // 켜짐 바탕은 제목과 펼침 화살표를 묶은 줄 전체에 깔린다
    expect(screen.getByRole('button', { name: 'Handbook Jul 2026' }).closest('.side-version-line-open')).not.toBeNull()
    // 버전이 없는 문서에는 화살표가 없다
    expect(screen.queryByRole('button', { name: 'Other 펼치기' })).toBeNull()
  })

  it('묶음 줄을 누르면 기본 판 문서를 연다', () => {
    const { onOpenDoc } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Handbook Jul 2026' }))
    expect(onOpenDoc).toHaveBeenCalledWith(expect.objectContaining({ docId: 'bbbbbbbbbbbb' }))
  })

  it('오른쪽 끝 화살표 하나로 펼치면 「버전」 알약 한 줄: 지금 버전이 켜져 있고, 누르면 그 버전으로 바뀐다', () => {
    const { actions } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Handbook 펼치기' }))
    const pills = screen.getByRole('group', { name: 'Handbook 버전' })
    expect(within(pills).getByText('버전')).toBeDefined()
    expect(within(pills).getByRole('button', { name: /Jul 2026 버전으로/ }).getAttribute('aria-pressed')).toBe('true')
    expect(within(pills).getByRole('button', { name: /Jan 2025 버전으로/ }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(pills).getByRole('button', { name: /Jan 2025 버전으로/ }))
    expect(actions.onPin).toHaveBeenCalledWith('aaaaaaaaaaaa')
    fireEvent.click(screen.getByRole('button', { name: 'Handbook 접기' }))
    expect(screen.queryByRole('group', { name: 'Handbook 버전' })).toBeNull()
  })

  it('알약 우클릭 메뉴에 열기·이름 바꾸기·묶음에서 빼기가 있다', () => {
    const { actions } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Handbook 펼치기' }))
    const pill = () => within(screen.getByRole('group', { name: 'Handbook 버전' })).getByRole('button', { name: /Jan 2025 버전으로/ })
    fireEvent.contextMenu(pill())
    fireEvent.click(within(screen.getByRole('menu', { name: /Jan 2025 버전 작업/ })).getByRole('menuitem', { name: '이 버전 열기' }))
    expect(actions.onOpen).toHaveBeenCalledWith('aaaaaaaaaaaa')
    fireEvent.contextMenu(pill())
    fireEvent.click(within(screen.getByRole('menu', { name: /Jan 2025 버전 작업/ })).getByRole('menuitem', { name: '이 버전을 묶음에서 빼기' }))
    expect(actions.onRemove).toHaveBeenCalledWith('aaaaaaaaaaaa')
    fireEvent.contextMenu(pill())
    fireEvent.click(within(screen.getByRole('menu', { name: /Jan 2025 버전 작업/ })).getByRole('menuitem', { name: '버전 이름 바꾸기' }))
    const input = screen.getByRole('textbox', { name: '버전 이름' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Winter' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(actions.onRename).toHaveBeenCalledWith('aaaaaaaaaaaa', 'Winter')
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
