// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { sidebarDefaults } from './sidebarDefaults'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Sidebar, vaultFolderName } from './Sidebar'
import { loadLibrary, loadNotebooks } from '../bridge/fake'
import type { VaultTreeNode, VaultTreePlaceRequest, VaultTreeReorderRequest } from '../core/vaultTree'
import type { PdfAttachmentPolicy } from '../core/vaultTree'

/**
 * bridge 읽기가 비동기라 헬퍼도 비동기다. App.test 와 달리 여기서는
 * 일부러 진짜 bridge 데이터를 쓴다 — 사이드바가 그려야 하는 것은 bridge 가
 * 내놓는 모양 그대로이고, 그 모양이 어긋나면 여기서 잡혀야 한다.
 */
async function renderSidebar(
  overrides: {
    onOpenDoc?: () => void
    onOpenNote?: () => void
    onOpenMarkdown?: () => void
    onAddDoc?: (policy?: PdfAttachmentPolicy) => void
    onCreateNote?: (notebookName: string, noteName: string) => Promise<void>
    onRelinkDoc?: (docId: string) => void
    missingDocIds?: readonly string[]
    openDocIds?: readonly string[]
    openNotePaths?: readonly string[]
    onOpenSettings?: () => void
    recentVaultPaths?: readonly string[]
    onOpenRecentVault?: (root: string) => void
    tree?: readonly VaultTreeNode[]
    onReorderNode?: (request: VaultTreeReorderRequest) => void
    onRenameEntry?: (id: string, displayName: string) => Promise<void>
    onCreateFolder?: (parentPath: string, name: string) => Promise<void>
    onMoveEntry?: (id: string, destinationFolder: string) => Promise<void>
    onPlaceNode?: (request: VaultTreePlaceRequest) => Promise<void>
    onPlaceNodes?: ComponentProps<typeof Sidebar>['onPlaceNodes']
    documentDropFolder?: string | null
    onDuplicateEntry?: (id: string, destinationFolder?: string) => Promise<void>
    onTrashEntry?: (id: string) => Promise<void>
    onTrashFolder?: (path: string) => Promise<void>
    onRenameFolder?: (path: string, name: string) => Promise<void>
    onConvertEntryToCopy?: (id: string, destinationFolder?: string) => Promise<void>
    onCopyEntryPath?: (id: string) => Promise<string>
    onFavoriteChange?: (id: string, favorite: boolean) => void
    documentDropActive?: boolean
    itemIcons?: Readonly<Record<string, string>>
    onItemIconChange?: (key: string, emoji: string | null) => void
    itemColors?: Readonly<Record<string, 'yellow' | 'orange' | 'green' | 'blue' | 'purple' | 'violet' | 'pink'>>
    onItemColorChange?: (key: string, color: string | null) => void
    recentPdfs?: readonly { path: string; title: string; openedAt: string }[]
    onOpenRecentPdf?: (path: string) => void
    onForgetRecentPdf?: (path: string) => void
    onRevealRecentPdf?: (path: string) => void
    onEditBibliography?: (docId: string) => void
    onCopyBibtex?: (docId: string) => void
    onMakeSearchable?: (docId: string) => void
    memoCategories?: Readonly<Record<string, { total: number; untagged: number; topics: readonly (readonly [string, number])[] }>>
    memoFilter?: { docId: string; topic: string | null } | null
    onSelectMemoCategory?: (doc: { docId: string }, topic: string | null) => void
  } = {},
) {
  const onOpenDoc = overrides.onOpenDoc ?? vi.fn()
  const onOpenNote = overrides.onOpenNote ?? vi.fn()
  const onOpenMarkdown = overrides.onOpenMarkdown ?? vi.fn()
  const onAddDoc = overrides.onAddDoc ?? vi.fn()
  const onCreateNote = overrides.onCreateNote ?? vi.fn().mockResolvedValue(undefined)
  const onRelinkDoc = overrides.onRelinkDoc ?? vi.fn()
  const onRenameEntry = overrides.onRenameEntry ?? vi.fn().mockResolvedValue(undefined)
  const [library, notebooks] = await Promise.all([loadLibrary(), loadNotebooks()])
  const view = render(
    <Sidebar
      library={library}
      notebooks={notebooks}
      onOpenDoc={onOpenDoc}
      onOpenNote={onOpenNote}
      onOpenMarkdown={onOpenMarkdown}
      onAddDoc={onAddDoc}
      onCreateNote={onCreateNote}
      onRelinkDoc={onRelinkDoc}
      missingDocIds={overrides.missingDocIds ?? []}
      openDocIds={overrides.openDocIds ?? []}
      openNotePaths={overrides.openNotePaths ?? []}
      onOpenSettings={overrides.onOpenSettings}
      recentVaultPaths={overrides.recentVaultPaths}
      onOpenRecentVault={overrides.onOpenRecentVault}
      tree={overrides.tree}
      onReorderNode={overrides.onReorderNode}
      onRenameEntry={onRenameEntry}
      onCreateFolder={overrides.onCreateFolder}
      onMoveEntry={overrides.onMoveEntry}
      onPlaceNode={overrides.onPlaceNode}
      onPlaceNodes={overrides.onPlaceNodes}
      documentDropFolder={overrides.documentDropFolder}
      onDuplicateEntry={overrides.onDuplicateEntry}
      onTrashEntry={overrides.onTrashEntry}
      onTrashFolder={overrides.onTrashFolder}
      onRenameFolder={overrides.onRenameFolder}
      onConvertEntryToCopy={overrides.onConvertEntryToCopy}
      onCopyEntryPath={overrides.onCopyEntryPath}
      onFavoriteChange={overrides.onFavoriteChange}
      documentDropActive={overrides.documentDropActive}
      itemIcons={overrides.itemIcons}
      onItemIconChange={overrides.onItemIconChange}
      itemColors={overrides.itemColors}
      onItemColorChange={overrides.onItemColorChange}
      recentPdfs={overrides.recentPdfs}
      onOpenRecentPdf={overrides.onOpenRecentPdf}
      onForgetRecentPdf={overrides.onForgetRecentPdf}
      onRevealRecentPdf={overrides.onRevealRecentPdf}
      onEditBibliography={overrides.onEditBibliography}
      onCopyBibtex={overrides.onCopyBibtex}
      onMakeSearchable={overrides.onMakeSearchable}
      memoCategories={overrides.memoCategories}
      memoFilter={overrides.memoFilter}
      onSelectMemoCategory={overrides.onSelectMemoCategory}
    />,
  )
  return { ...view, onOpenDoc, onOpenNote, onOpenMarkdown, onAddDoc, onCreateNote, onRelinkDoc, onRenameEntry }
}

describe('Sidebar', () => {
  it('주요 작업은 「문서」 제목 줄 오른쪽에 두고, 로고는 사이드바에 두지 않는다(상단바 로고 메뉴)', async () => {
    const view = await renderSidebar({ onCreateFolder: vi.fn() })

    expect(view.container.querySelector('.side-brand-mark')).toBeNull()
    const head = view.container.querySelector('.side-documents-head') as HTMLElement
    expect(within(head).getByRole('heading', { name: '문서' })).toBeDefined()
    expect(within(head).getByRole('button', { name: 'Vault 검색' })).toBeDefined()
    expect(within(head).getByRole('button', { name: '새 폴더' })).toBeDefined()
    expect(within(head).getByRole('button', { name: '문서 추가' })).toBeDefined()
  })

  it('운영체제 문서 드래그 중에는 전체 높이 드롭 대상을 한 번만 보여준다', async () => {
    await renderSidebar({ documentDropActive: true })
    expect(screen.getAllByText('놓으면 Vault 에 복사 · 줄 사이에 놓으면 그 자리, 폴더 위면 그 폴더 안')).toHaveLength(1)
  })

  it('PDF 문서와 노트를 이름 있는 별도 구역으로 보여준다', async () => {
    await renderSidebar()
    expect(screen.getByRole('region', { name: '문서' })).toBeDefined()
    expect(screen.getByRole('region', { name: '노트' })).toBeDefined()
  })

  it('문서 목록을 그린다', async () => {
    await renderSidebar()
    expect(screen.getByRole('button', { name: /HTTP Semantics Guide v1.1/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Compilers Textbook 5.0/ })).toBeDefined()
  })

  it('노트북 이름과 그 안의 노트를 그린다', async () => {
    await renderSidebar()
    expect(screen.getByText('HTTP')).toBeDefined()
    expect(screen.getByRole('button', { name: 'OPTIONS' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Paging Notes' })).toBeDefined()
  })

  it('문서를 누르면 onOpenDoc 이 그 문서로 불린다', async () => {
    const onOpenDoc = vi.fn()
    await renderSidebar({ onOpenDoc })
    screen.getByRole('button', { name: /Rust Programming Handbook/ }).click()
    expect(onOpenDoc).toHaveBeenCalledWith(
      expect.objectContaining({ docId: '77aa11bb22cc' }),
    )
  })

  it('노트를 누르면 onOpenNote 가 그 노트로 불린다', async () => {
    const onOpenNote = vi.fn()
    await renderSidebar({ onOpenNote })
    screen.getByRole('button', { name: 'HEADERS' }).click()
    expect(onOpenNote).toHaveBeenCalledWith({ path: 'HTTP/HEADERS.canvas', title: 'HEADERS' })
  })
})

describe('Sidebar — 문서 추가', () => {
  it('Library 머리에 "문서 추가" 버튼이 있다', async () => {
    await renderSidebar()
    expect(screen.getByRole('button', { name: '문서 추가' })).toBeDefined()
  })

  it('문서 추가에서 참조 방식을 명시해 부모에 전달한다', async () => {
    const onAddDoc = vi.fn()
    await renderSidebar({ onAddDoc })
    fireEvent.click(screen.getByRole('button', { name: '문서 추가' }))
    fireEvent.click(screen.getByRole('button', { name: /원본 위치 참조/ }))
    expect(onAddDoc).toHaveBeenCalledWith({ kind: 'reference' })
  })

  it('하단 Vault 메뉴에서 최근 폴더를 다시 열 수 있다', async () => {
    const onOpenRecentVault = vi.fn()
    await renderSidebar({
      recentVaultPaths: ['C:/Vaults/Protocol', 'D:/Notes/IWAE'],
      onOpenRecentVault,
    })

    fireEvent.click(screen.getByRole('button', { name: '폴더를 선택하세요' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^Protocol/ }))
    expect(onOpenRecentVault).toHaveBeenCalledWith('C:/Vaults/Protocol')
  })

  it('PDF 이름을 더블클릭하면 표시 이름을 인라인으로 바꾼다', async () => {
    const onRenameEntry = vi.fn().mockResolvedValue(undefined)
    await renderSidebar({ onRenameEntry })
    const document = screen.getByRole('button', { name: /Rust Programming Handbook/ })

    fireEvent.doubleClick(document)
    const input = screen.getByRole('textbox', { name: 'Rust Programming Handbook 표시 이름' })
    fireEvent.change(input, { target: { value: 'Rust Handbook' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onRenameEntry).toHaveBeenCalledWith('77aa11bb22cc', 'Rust Handbook'))
  })

  it('노트와 Markdown도 더블클릭으로 표시 이름을 바꾼다', async () => {
    const onRenameEntry = vi.fn().mockResolvedValue(undefined)
    const tree: readonly VaultTreeNode[] = [{
      id: 'folder:Notes',
      kind: 'folder',
      name: 'Notes',
      path: 'Notes',
      children: [
        { id: 'note:Notes/Sketch.canvas', kind: 'note', name: 'Sketch', path: 'Notes/Sketch.canvas' },
        {
          id: 'markdown:Notes/README.md', kind: 'markdown', name: 'README', path: 'Notes/README.md',
          storage: 'vault', indexId: 'Notes/README.md',
        },
      ],
    }]
    await renderSidebar({ tree, onRenameEntry })

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Sketch' }))
    const noteInput = screen.getByRole('textbox', { name: 'Sketch 표시 이름' })
    fireEvent.change(noteInput, { target: { value: '아이디어 보드' } })
    fireEvent.keyDown(noteInput, { key: 'Enter' })
    await waitFor(() => expect(onRenameEntry).toHaveBeenCalledWith('Notes/Sketch.canvas', '아이디어 보드'))

    fireEvent.doubleClick(screen.getByRole('button', { name: 'README, Markdown' }))
    const markdownInput = screen.getByRole('textbox', { name: 'README 표시 이름' })
    fireEvent.change(markdownInput, { target: { value: '개요' } })
    fireEvent.keyDown(markdownInput, { key: 'Enter' })
    await waitFor(() => expect(onRenameEntry).toHaveBeenCalledWith('Notes/README.md', '개요'))
  })

  it('현재 폴더와 다른 폴더 복사 정책을 구분한다', async () => {
    const onAddDoc = vi.fn()
    const tree: readonly VaultTreeNode[] = [
      { id: 'folder:A', kind: 'folder', name: 'A', path: 'A', children: [] },
      { id: 'folder:B', kind: 'folder', name: 'B', path: 'B', children: [] },
    ]
    await renderSidebar({ onAddDoc, tree })

    const documents = screen.getByRole('region', { name: '문서' })
    fireEvent.click(within(documents).getByRole('button', { name: 'A 접기' }))
    fireEvent.click(screen.getByRole('button', { name: '문서 추가' }))
    // 지금 폴더(A)가 미리 골라져 있다
    expect(screen.getByRole('radio', { name: /A/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /파일 골라 복사/ }))
    expect(onAddDoc).toHaveBeenLastCalledWith({ kind: 'copy-another-folder', folderPath: 'A' })

    fireEvent.click(screen.getByRole('button', { name: '문서 추가' }))
    fireEvent.click(screen.getByRole('radio', { name: 'B' }))
    fireEvent.click(screen.getByRole('button', { name: /파일 골라 복사/ }))
    expect(onAddDoc).toHaveBeenLastCalledWith({ kind: 'copy-another-folder', folderPath: 'B' })
  })
})

describe('Sidebar — 열림 표시', () => {
  it('열려 있는 문서에만 점이 켜진다', async () => {
    // 점이 상태를 뜻한다는 것이 여기서 지켜진다. 전부 켜지거나 전부
    // 꺼지면 그냥 장식이고, 사이드바를 훑어서 "이미 열려 있나"를 알 수 없다.
    const { container } = await renderSidebar({ openDocIds: ['77aa11bb22cc'] })
    const open = container.querySelectorAll('.side-dot-open')
    expect(open).toHaveLength(1)

    const row = open[0]?.closest('.side-item')
    expect(row?.textContent).toContain('Rust Programming Handbook')
  })

  it('아무것도 안 열렸으면 켜진 점이 없다', async () => {
    const { container } = await renderSidebar()
    expect(container.querySelectorAll('.side-dot-open')).toHaveLength(0)
    // 자리는 남아 있어야 제목의 왼쪽 선이 흐트러지지 않는다
    expect(container.querySelectorAll('.side-dot').length).toBeGreaterThan(0)
  })
})

describe('Sidebar — 새 노트', () => {
  it('폴더 줄의 + 는 그 폴더 안에 새 폴더를 만든다', async () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined)
    const tree: readonly VaultTreeNode[] = [
      { id: 'folder:Specs', kind: 'folder', name: 'Specs', path: 'Specs', children: [] },
    ]
    await renderSidebar({ tree, onCreateFolder })
    fireEvent.click(screen.getByRole('button', { name: 'Specs에 새 하위 폴더' }))
    const input = screen.getByRole('textbox', { name: '새 폴더 이름' })
    fireEvent.change(input, { target: { value: 'Protocol' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCreateFolder).toHaveBeenCalledWith('Specs', 'Protocol'))
  })

  it('맨 위 「새 폴더」는 폴더를 열어 두었어도 Vault 맨 위에 새 줄로 만든다', async () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined)
    const tree: readonly VaultTreeNode[] = [
      { id: 'folder:Specs', kind: 'folder', name: 'Specs', path: 'Specs', children: [] },
    ]
    await renderSidebar({ tree, onCreateFolder })

    fireEvent.click(screen.getAllByRole('button', { name: 'Specs 접기' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '새 폴더' }))
    // 대화상자가 아니라 트리 안의 새 줄이다
    expect(screen.queryByRole('dialog')).toBeNull()
    const input = screen.getByRole('textbox', { name: '새 폴더 이름' })
    expect(input.closest('.side-tree-draft')).not.toBeNull()
    fireEvent.change(input, { target: { value: 'Protocol' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onCreateFolder).toHaveBeenCalledWith('', 'Protocol'))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '새 폴더 이름' })).toBeNull())
  })

  it('새 줄은 실패 이유를 보여주고 고칠 수 있게 남는다', async () => {
    const onCreateFolder = vi.fn().mockRejectedValue(new Error('대상 위치에 같은 이름의 파일이 이미 있습니다.'))
    await renderSidebar({ onCreateFolder })
    fireEvent.click(screen.getByRole('button', { name: '새 폴더' }))
    fireEvent.change(screen.getByRole('textbox', { name: '새 폴더 이름' }), { target: { value: 'Specs' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: '새 폴더 이름' }), { key: 'Enter' })
    expect((await screen.findByRole('alert')).textContent).toContain('같은 이름')
    expect(screen.getByRole('textbox', { name: '새 폴더 이름' })).toBeTruthy()
  })

  it('새 줄은 Escape 나 빈 이름으로 떠나면 사라진다', async () => {
    const onCreateFolder = vi.fn()
    const onCreateNote = vi.fn()
    await renderSidebar({ onCreateFolder, onCreateNote })

    fireEvent.click(screen.getByRole('button', { name: '새 폴더' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: '새 폴더 이름' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: '새 폴더 이름' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '새 노트' }))
    fireEvent.blur(screen.getByRole('textbox', { name: '새 노트 이름' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '새 노트 이름' })).toBeNull())
    expect(onCreateFolder).not.toHaveBeenCalled()
    expect(onCreateNote).not.toHaveBeenCalled()
  })

  it('새 노트는 노트 구역 맨 위에 새 줄로 생기고, 폴더의 + 단추로는 그 폴더 안에 만든다', async () => {
    const onCreateNote = vi.fn().mockResolvedValue(undefined)
    await renderSidebar({ onCreateNote })

    fireEvent.click(screen.getByRole('button', { name: '새 노트' }))
    const input = screen.getByRole('textbox', { name: '새 노트 이름' })
    fireEvent.change(input, { target: { value: 'Hot Join' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onCreateNote).toHaveBeenCalledWith('', 'Hot Join'))

    const plus = screen.getAllByRole('button', { name: /에 새 노트$/u })[0]!
    const folder = (plus.getAttribute('aria-label') ?? '').replace(/에 새 노트$/u, '')
    fireEvent.click(plus)
    const nested = screen.getByRole('textbox', { name: '새 노트 이름' })
    fireEvent.change(nested, { target: { value: 'Timing' } })
    fireEvent.keyDown(nested, { key: 'Enter' })
    await waitFor(() => expect(onCreateNote).toHaveBeenLastCalledWith(expect.stringContaining(folder), 'Timing'))
  })

  it('설정 버튼은 부모의 설정 팝업 열기 콜백만 호출한다', async () => {
    const onOpenSettings = vi.fn()
    const { container } = await renderSidebar({ onOpenSettings })
    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.side-menu')).toBeNull()
  })
})

describe('Sidebar — 문서 다시 연결', () => {
  it('찾을 수 없는 문서에 상태와 다시 연결 버튼을 보여준다', async () => {
    const onRelinkDoc = vi.fn()
    await renderSidebar({ missingDocIds: ['77aa11bb22cc'], onRelinkDoc })

    expect(screen.getByText('찾을 수 없음')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Rust Programming Handbook 다시 연결' }))
    expect(onRelinkDoc).toHaveBeenCalledWith('77aa11bb22cc')
  })
})

describe('Sidebar — 폴더 우선 트리', () => {
  const tree: readonly VaultTreeNode[] = [{
    id: 'folder:Specs',
    kind: 'folder',
    name: 'Specs',
    path: 'Specs',
    children: [{
      id: 'folder:Specs/Bus',
      kind: 'folder',
      name: 'Bus',
      path: 'Specs/Bus',
      children: [
        {
          id: 'note:Specs/Bus/HEADERS.canvas',
          kind: 'note',
          name: 'HEADERS',
          path: 'Specs/Bus/HEADERS.canvas',
        },
        {
          id: 'markdown:Specs/Bus/README.md',
          kind: 'markdown',
          name: 'README',
          path: 'Specs/Bus/README.md',
          storage: 'vault',
          indexId: 'Specs/Bus/README.md',
        },
        {
          id: 'pdf:doc-http',
          kind: 'pdf',
          name: 'HTTP Basics',
          folderPath: 'Specs/Bus',
          doc: { docId: 'doc-http', title: 'HTTP Basics', pages: 12, folderPath: 'Specs/Bus' },
        },
        {
          id: 'pdf:doc-http-advanced',
          kind: 'pdf',
          name: 'HTTP Advanced',
          folderPath: 'Specs/Bus',
          doc: { docId: 'doc-http-advanced', title: 'HTTP Advanced', pages: 24, folderPath: 'Specs/Bus' },
        },
      ],
    }],
  }]

  const row = (region: HTMLElement, name: string | RegExp) =>
    within(region).getByRole('button', { name }).closest('[data-internal-drop="tree-node"]') as HTMLElement

  it('Ctrl+누르기로 여러 개를 고르면 열지 않고, Esc 로 고른 것을 푼다', async () => {
    const view = await renderSidebar({ tree })
    const documents = screen.getByRole('region', { name: '문서' })
    fireEvent.click(within(documents).getByRole('button', { name: 'HTTP Basics' }), { ctrlKey: true })
    fireEvent.click(within(documents).getByRole('button', { name: 'HTTP Advanced' }), { ctrlKey: true })
    expect(view.onOpenDoc).not.toHaveBeenCalled()
    expect(row(documents, 'HTTP Basics').classList.contains('side-tree-node-selected')).toBe(true)
    expect(row(documents, 'HTTP Advanced').classList.contains('side-tree-node-selected')).toBe(true)
    // Ctrl 로 다시 누르면 빠진다
    fireEvent.click(within(documents).getByRole('button', { name: 'HTTP Advanced' }), { ctrlKey: true })
    expect(row(documents, 'HTTP Advanced').classList.contains('side-tree-node-selected')).toBe(false)
    fireEvent.keyDown(within(documents).getByRole('button', { name: 'HTTP Basics' }), { key: 'Escape' })
    expect(row(documents, 'HTTP Basics').classList.contains('side-tree-node-selected')).toBe(false)
  })

  it('Shift+누르기는 마지막으로 누른 줄부터 여기까지 고르고, 폴더도 펼치지 않는다', async () => {
    const view = await renderSidebar({ tree })
    const documents = screen.getByRole('region', { name: '문서' })
    fireEvent.click(within(documents).getByRole('button', { name: 'Bus 접기' }), { ctrlKey: true })
    expect(within(documents).getByRole('button', { name: 'Bus 접기' })).toBeTruthy()
    fireEvent.click(within(documents).getByRole('button', { name: 'HTTP Advanced' }), { shiftKey: true })
    expect(view.onOpenDoc).not.toHaveBeenCalled()
    for (const name of ['Bus 접기', 'HTTP Basics', 'HTTP Advanced']) {
      expect(row(documents, name).classList.contains('side-tree-node-selected')).toBe(true)
    }
    expect(row(documents, 'Specs 접기').classList.contains('side-tree-node-selected')).toBe(false)
  })

  it('고른 여러 개를 끌어 폴더에 놓으면 화면 차례대로 함께 옮긴다', async () => {
    const onPlaceNodes = vi.fn().mockResolvedValue(undefined)
    const onPlaceNode = vi.fn().mockResolvedValue(undefined)
    await renderSidebar({ tree, onPlaceNode, onPlaceNodes })
    const documents = screen.getByRole('region', { name: '문서' })
    fireEvent.click(within(documents).getByRole('button', { name: 'HTTP Advanced' }), { ctrlKey: true })
    fireEvent.click(within(documents).getByRole('button', { name: 'HTTP Basics' }), { ctrlKey: true })
    dragTreeNode(row(documents, 'HTTP Advanced'), row(documents, 'Specs 접기'))
    expect(onPlaceNode).not.toHaveBeenCalled()
    expect(onPlaceNodes).toHaveBeenCalledWith(
      [{ nodeId: 'pdf:doc-http', fromParent: 'Specs/Bus' }, { nodeId: 'pdf:doc-http-advanced', fromParent: 'Specs/Bus' }],
      expect.objectContaining({ toParent: 'Specs', targetNodeId: null, position: 'inside' }),
    )
    await waitFor(() => expect(row(documents, 'HTTP Basics').classList.contains('side-tree-node-selected')).toBe(false))
  })

  it('탐색기에서 끌어 오는 중이면 목록을 가리지 않고 들어갈 폴더를 칠한다', async () => {
    await renderSidebar({ tree, documentDropActive: true, documentDropFolder: 'Specs/Bus' })
    const documents = screen.getByRole('region', { name: '문서' })
    expect(row(documents, 'Bus 접기').classList.contains('side-tree-drop-inside')).toBe(true)
    expect(row(documents, 'Specs 접기').classList.contains('side-tree-drop-inside')).toBe(false)
    expect(screen.getByRole('status').textContent).toContain('「Bus」 폴더에 복사')
  })

  it('중첩 폴더를 접근 가능한 버튼으로 접고 펼친다', async () => {
    await renderSidebar({ tree })

    const notes = screen.getByRole('region', { name: '노트' })
    const folder = within(notes).getByRole('button', { name: 'Bus 접기' })
    expect(folder.getAttribute('aria-expanded')).toBe('true')
    expect(within(notes).getByRole('button', { name: 'HEADERS' })).toBeDefined()

    fireEvent.click(folder)
    expect(within(notes).getByRole('button', { name: 'Bus 펼치기' }).getAttribute('aria-expanded')).toBe('false')
    expect(within(notes).queryByRole('button', { name: 'HEADERS' })).toBeNull()
    expect(within(screen.getByRole('region', { name: '문서' })).getByRole('button', { name: /HTTP Basics/ })).toBeDefined()
  })

  it('PDF 문서와 노트를 서로 다른 이름 있는 구역에만 렌더링한다', async () => {
    await renderSidebar({ tree })

    const documents = screen.getByRole('region', { name: '문서' })
    const notes = screen.getByRole('region', { name: '노트' })
    expect(within(documents).getByRole('button', { name: /HTTP Basics/ })).toBeDefined()
    expect(within(documents).getByRole('button', { name: 'README, Markdown' })).toBeDefined()
    expect(within(documents).queryByRole('button', { name: 'HEADERS' })).toBeNull()
    expect(within(notes).getByRole('button', { name: 'HEADERS' })).toBeDefined()
    expect(within(notes).queryByRole('button', { name: 'README, Markdown' })).toBeNull()
    expect(within(notes).queryByRole('button', { name: /HTTP Basics/ })).toBeNull()
  })

  it('Markdown을 누르면 캔버스 콜백이 아니라 읽기 콜백을 호출한다', async () => {
    const onOpenNote = vi.fn()
    const onOpenMarkdown = vi.fn()
    await renderSidebar({ tree, onOpenNote, onOpenMarkdown })

    fireEvent.click(screen.getByRole('button', { name: 'README, Markdown' }))
    expect(onOpenMarkdown).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'markdown',
      path: 'Specs/Bus/README.md',
    }))
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('순서 손잡이 없이, 줄에서 Alt+↑/↓ 로 형제 이동 요청을 전달한다', async () => {
    const onReorderNode = vi.fn()
    await renderSidebar({ tree, onReorderNode })

    expect(screen.queryByRole('button', { name: '위로 이동' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'HTTP Advanced 순서 변경' })).toBeNull()
    const row = screen.getByRole('button', { name: 'HTTP Advanced' })
    // Alt 없이 화살표만 누르면 옮기지 않는다
    fireEvent.keyDown(row, { key: 'ArrowUp' })
    expect(onReorderNode).not.toHaveBeenCalled()
    fireEvent.keyDown(row, { key: 'ArrowUp', altKey: true })
    expect(onReorderNode).toHaveBeenCalledWith({
      parentPath: 'Specs/Bus',
      nodeId: 'pdf:doc-http-advanced',
      targetNodeId: 'pdf:doc-http',
      position: 'before',
    })
  })

  it('포인터로 끌어 같은 구역의 형제 대상 뒤에 놓는다', async () => {
    const onReorderNode = vi.fn()
    await renderSidebar({ tree, onReorderNode })
    const documents = screen.getByRole('region', { name: '문서' })
    const source = within(documents).getByRole('button', { name: 'HTTP Basics' }).closest('[data-internal-drop="tree-node"]') as HTMLElement
    const target = within(documents).getByRole('button', { name: 'HTTP Advanced' }).closest('[data-internal-drop="tree-node"]') as HTMLElement

    dragTreeNode(source, target)

    expect(onReorderNode).toHaveBeenCalledWith({
      parentPath: 'Specs/Bus',
      nodeId: 'pdf:doc-http',
      targetNodeId: 'pdf:doc-http-advanced',
      position: 'after',
    })
  })

  it('자유 배치: 폴더 줄 가운데에 놓으면 그 폴더 안으로, 구역 빈 곳에 놓으면 Vault 맨 위로 옮긴다', async () => {
    const onPlaceNode = vi.fn().mockResolvedValue(undefined)
    await renderSidebar({ tree, onPlaceNode })
    const documents = screen.getByRole('region', { name: '문서' })
    const source = within(documents).getByRole('button', { name: 'HTTP Basics' }).closest('[data-internal-drop="tree-node"]') as HTMLElement
    const specs = within(documents).getByRole('button', { name: 'Specs 접기' }).closest('[data-internal-drop="tree-node"]') as HTMLElement

    dragTreeNode(source, specs)
    expect(onPlaceNode).toHaveBeenLastCalledWith({
      nodeId: 'pdf:doc-http', fromParent: 'Specs/Bus', toParent: 'Specs', targetNodeId: null, position: 'inside',
    })

    dragTreeNode(source, documents)
    expect(onPlaceNode).toHaveBeenLastCalledWith({
      nodeId: 'pdf:doc-http', fromParent: 'Specs/Bus', toParent: '', targetNodeId: null, position: 'after',
    })
  })

  it('자유 배치: 다른 항목 줄 위아래에 놓으면 그 앞뒤에 두고, 폴더를 자기 안으로는 넣지 않는다', async () => {
    const onPlaceNode = vi.fn().mockResolvedValue(undefined)
    await renderSidebar({ tree, onPlaceNode })
    const documents = screen.getByRole('region', { name: '문서' })
    const source = within(documents).getByRole('button', { name: 'HTTP Basics' }).closest('[data-internal-drop="tree-node"]') as HTMLElement
    const target = within(documents).getByRole('button', { name: 'HTTP Advanced' }).closest('[data-internal-drop="tree-node"]') as HTMLElement
    dragTreeNode(source, target)
    expect(onPlaceNode).toHaveBeenLastCalledWith({
      nodeId: 'pdf:doc-http', fromParent: 'Specs/Bus', toParent: 'Specs/Bus', targetNodeId: 'pdf:doc-http-advanced', position: 'after',
    })

    onPlaceNode.mockClear()
    const specs = within(documents).getByRole('button', { name: 'Specs 접기' }).closest('[data-internal-drop="tree-node"]') as HTMLElement
    const bus = within(documents).getByRole('button', { name: 'Bus 접기' }).closest('[data-internal-drop="tree-node"]') as HTMLElement
    dragTreeNode(specs, bus)
    expect(onPlaceNode).not.toHaveBeenCalled()
  })

  it('파일을 폴더 위에 놓으면 실제 폴더 이동을 요청한다', async () => {
    const onMoveEntry = vi.fn().mockResolvedValue(undefined)
    await renderSidebar({ tree, onReorderNode: vi.fn(), onMoveEntry })
    const notes = screen.getByRole('region', { name: '노트' })
    const source = within(notes).getByRole('button', { name: 'HEADERS' }).closest('[data-internal-drop="tree-node"]') as HTMLElement
    const target = within(notes).getByRole('button', { name: 'Specs 접기' }).closest('[data-internal-drop="tree-node"]') as HTMLElement

    dragTreeNode(source, target)

    expect(onMoveEntry).toHaveBeenCalledWith('Specs/Bus/HEADERS.canvas', 'Specs')
  })

  it('폴더로 옮기지 못하면 이유를 보여준다', async () => {
    const onMoveEntry = vi.fn().mockRejectedValue(new Error('대상 폴더에 같은 이름이 있습니다.'))
    await renderSidebar({ tree, onReorderNode: vi.fn(), onMoveEntry })
    const notes = screen.getByRole('region', { name: '노트' })
    const source = within(notes).getByRole('button', { name: 'HEADERS' }).closest('[data-internal-drop="tree-node"]') as HTMLElement
    const target = within(notes).getByRole('button', { name: 'Specs 접기' }).closest('[data-internal-drop="tree-node"]') as HTMLElement

    dragTreeNode(source, target)

    expect((await screen.findByRole('alert')).textContent).toContain('대상 폴더에 같은 이름이 있습니다.')
  })

  it('파일 우클릭 메뉴에서 복제·경로 복사·휴지통을 실행한다', async () => {
    const onDuplicateEntry = vi.fn().mockResolvedValue(undefined)
    const onTrashEntry = vi.fn().mockResolvedValue(undefined)
    const onCopyEntryPath = vi.fn().mockResolvedValue('C:/Vault/Specs/Bus/README.md')
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    await renderSidebar({ tree, onDuplicateEntry, onTrashEntry, onCopyEntryPath })

    fireEvent.contextMenu(screen.getByRole('button', { name: 'README, Markdown' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '복제' }))
    await waitFor(() => expect(onDuplicateEntry).toHaveBeenCalledWith('Specs/Bus/README.md', 'Specs/Bus'))

    fireEvent.contextMenu(screen.getByRole('button', { name: 'README, Markdown' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '경로 복사' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('C:/Vault/Specs/Bus/README.md'))

    fireEvent.contextMenu(screen.getByRole('button', { name: 'README, Markdown' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '휴지통으로 이동' }))
    await waitFor(() => expect(onTrashEntry).toHaveBeenCalledWith('Specs/Bus/README.md'))
  })
})

const emojiTree: VaultTreeNode[] = [
  { id: 'folder:논문', kind: 'folder', name: '논문', path: '논문', children: [
    { id: 'pdf:doc-1', kind: 'pdf', name: '첫 논문', folderPath: '논문', doc: { docId: 'doc-1', title: '첫 논문', pages: 3, folderPath: '논문' } },
  ] },
]

describe('Sidebar — 메모 카테고리', () => {
  it('열린 PDF 밑에 그 PDF 의 메모 카테고리를 펼치고, 누르면 그 카테고리를 고른다', async () => {
    const onSelectMemoCategory = vi.fn()
    await renderSidebar({
      tree: emojiTree,
      openDocIds: ['doc-1'],
      memoCategories: { 'doc-1': { total: 4, untagged: 1, topics: [['QUESTIONS', 1], ['TODO', 2]] } },
      memoFilter: { docId: 'doc-1', topic: 'TODO' },
      onSelectMemoCategory,
    })
    const group = await screen.findByRole('group', { name: '첫 논문 메모 카테고리' })
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['QUESTIONS', 'TODO', '카테고리 없음'])
    expect(within(group).getByRole('button', { name: /TODO/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(group).getByRole('button', { name: /QUESTIONS/ }))
    expect(onSelectMemoCategory).toHaveBeenCalledWith(expect.objectContaining({ docId: 'doc-1' }), 'QUESTIONS')
    // 고른 카테고리를 다시 누르면 풀린다
    fireEvent.click(within(group).getByRole('button', { name: /TODO/ }))
    expect(onSelectMemoCategory).toHaveBeenLastCalledWith(expect.objectContaining({ docId: 'doc-1' }), null)
  })

  it('닫힌 PDF 에는 카테고리를 펼치지 않는다', async () => {
    await renderSidebar({ tree: emojiTree, openDocIds: [], memoCategories: { 'doc-1': { total: 1, untagged: 1, topics: [] } }, onSelectMemoCategory: vi.fn() })
    await screen.findByText('첫 논문')
    expect(screen.queryByRole('group', { name: '첫 논문 메모 카테고리' })).toBeNull()
  })
})

describe('Sidebar — 최근 연 PDF', () => {
  it('Vault 밖에서 연 PDF 를 날짜와 함께 바닥 위에 보이고, 누르면 열고 빼기도 한다', async () => {
    const onOpenRecentPdf = vi.fn()
    const onForgetRecentPdf = vi.fn()
    const openedAt = new Date().toISOString()
    await renderSidebar({ tree: emojiTree, recentPdfs: [{ path: 'D:/받은 파일/spec.pdf', title: '받은 스펙', openedAt }], onOpenRecentPdf, onForgetRecentPdf })
    const section = screen.getByRole('region', { name: '최근 연 PDF' })
    const item = section.querySelector<HTMLButtonElement>('.side-recent-item')!
    expect(item.textContent).toMatch(/\d{2}:\d{2}/u)
    fireEvent.click(item)
    expect(onOpenRecentPdf).toHaveBeenCalledWith('D:/받은 파일/spec.pdf')
    fireEvent.click(within(section).getByRole('button', { name: '받은 스펙 목록에서 빼기' }))
    expect(onForgetRecentPdf).toHaveBeenCalledWith('D:/받은 파일/spec.pdf')
  })

  it('우클릭하면 그 PDF 가 든 폴더를 열 수 있다', async () => {
    const onRevealRecentPdf = vi.fn()
    const onOpenRecentPdf = vi.fn()
    await renderSidebar({ tree: emojiTree, recentPdfs: [{ path: 'D:/받은 파일/spec.pdf', title: '받은 스펙', openedAt: new Date().toISOString() }], onOpenRecentPdf, onRevealRecentPdf })
    const section = screen.getByRole('region', { name: '최근 연 PDF' })
    fireEvent.contextMenu(section.querySelector<HTMLButtonElement>('.side-recent-item')!)
    const menu = screen.getByRole('menu', { name: '받은 스펙 작업' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: '폴더 열기' }))
    expect(onRevealRecentPdf).toHaveBeenCalledWith('D:/받은 파일/spec.pdf')
    expect(screen.queryByRole('menu', { name: '받은 스펙 작업' })).toBeNull()
  })
})

describe('Sidebar — 이모지', () => {
  it('항목 아이콘 자리에 이모지를 그린다', async () => {
    await renderSidebar({ tree: emojiTree, itemIcons: { 'doc-1': '📕', 'folder:논문': '🗂️' } })
    const docButton = screen.getByRole('button', { name: /첫 논문/ })
    expect(within(docButton).getByText('📕')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: '논문 접기' })).getByText('🗂️')).toBeTruthy()
  })

  it('파일 메뉴에서 이모지 선택창을 연다', async () => {
    await renderSidebar({ tree: emojiTree, onItemIconChange: vi.fn() })
    fireEvent.contextMenu(screen.getByRole('button', { name: /첫 논문/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '이모지 설정…' }))
    expect(await screen.findByRole('dialog', { name: '이모지 선택' })).toBeTruthy()
  })

  it('PDF 아이콘을 누르면 PDF 를 열지 않고 바로 이모지 선택창을 연다', async () => {
    const onOpenDoc = vi.fn()
    await renderSidebar({ tree: emojiTree, onItemIconChange: vi.fn(), onOpenDoc })
    const docButton = screen.getByRole('button', { name: /첫 논문/ })
    fireEvent.click(docButton.querySelector('[data-emoji-pick]')!)
    expect(await screen.findByRole('dialog', { name: '이모지 선택' })).toBeTruthy()
    expect(onOpenDoc).not.toHaveBeenCalled()
  })

  it('폴더에도 메뉴가 있고 이모지를 지울 수 있다', async () => {
    const onItemIconChange = vi.fn()
    await renderSidebar({ tree: emojiTree, itemIcons: { 'folder:논문': '🗂️' }, onItemIconChange })
    fireEvent.contextMenu(screen.getByRole('button', { name: '논문 접기' }))
    expect(screen.queryByRole('menuitem', { name: '복제' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '이모지 지우기' }))
    expect(onItemIconChange).toHaveBeenCalledWith('folder:논문', null)
  })

  it('폴더 메뉴에서 웨일처럼 폴더 색을 고르고, 고른 색으로 폴더를 칠한다', async () => {
    const onItemColorChange = vi.fn()
    await renderSidebar({ tree: emojiTree, itemColors: { 'folder:논문': 'green' }, onItemColorChange })
    expect(screen.getByRole('button', { name: '논문 접기' }).querySelector('.side-folder-icon-colored')).not.toBeNull()
    fireEvent.contextMenu(screen.getByRole('button', { name: '논문 접기' }))
    expect(screen.getByRole('menuitemradio', { name: '폴더 색 초록' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '폴더 색 분홍' }))
    await waitFor(() => expect(onItemColorChange).toHaveBeenCalledWith('folder:논문', 'pink'))
  })

  it('노트에도 이모지를 달 수 있고 기본 아이콘을 대신한다', async () => {
    const tree: readonly VaultTreeNode[] = [
      { id: 'note:실험.canvas', kind: 'note', name: '실험 기록', path: '실험.canvas' },
    ]
    await renderSidebar({ tree, itemIcons: { '실험.canvas': '🧪' }, onItemIconChange: vi.fn() })
    const noteButton = screen.getByRole('button', { name: /실험 기록/ })
    expect(within(noteButton).getByText('🧪')).toBeTruthy()
  })
})

describe('Sidebar — 폴더 작업', () => {
  const folderTree: readonly VaultTreeNode[] = [
    {
      id: 'folder:Specs',
      kind: 'folder',
      name: 'Specs',
      path: 'Specs',
      children: [
        { id: 'pdf:doc-1', kind: 'pdf', name: '첫 논문', folderPath: 'Specs', doc: { docId: 'doc-1', title: '첫 논문', pages: 3, folderPath: 'Specs' } },
        {
          id: 'folder:Specs/HTTP',
          kind: 'folder',
          name: 'HTTP',
          path: 'Specs/HTTP',
          children: [
            { id: 'pdf:doc-2', kind: 'pdf', name: '둘째 논문', folderPath: 'Specs/HTTP', doc: { docId: 'doc-2', title: '둘째 논문', pages: 5, folderPath: 'Specs/HTTP' } },
          ],
        },
      ],
    },
  ]

  it('폴더 메뉴에 하위 폴더·이름 바꾸기·이모지·삭제가 있다', async () => {
    await renderSidebar({ tree: folderTree, onCreateFolder: vi.fn(), onRenameFolder: vi.fn(), onTrashFolder: vi.fn(), onItemIconChange: vi.fn() })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Specs 접기' }))
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(names).toEqual(['새 하위 폴더…', '이름 바꾸기', '이모지 설정…', '삭제…'])
  })

  it('폴더 삭제는 문서 수를 알리는 확인 뒤에 휴지통 콜백을 부른다', async () => {
    const onTrashFolder = vi.fn().mockResolvedValue(undefined)
    await renderSidebar({ tree: folderTree, onTrashFolder })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Specs 접기' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '삭제…' }))
    const dialog = screen.getByRole('dialog', { name: '폴더 삭제' })
    expect(dialog.textContent).toContain('문서 2개')
    expect(dialog.textContent).toContain('하위 폴더 1개')
    expect(onTrashFolder).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '휴지통으로 이동' }))
    await waitFor(() => expect(onTrashFolder).toHaveBeenCalledWith('Specs'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '폴더 삭제' })).toBeNull())
  })

  it('폴더 삭제 확인을 취소하면 아무것도 지우지 않는다', async () => {
    const onTrashFolder = vi.fn()
    await renderSidebar({ tree: folderTree, onTrashFolder })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'HTTP 접기' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '삭제…' }))
    fireEvent.keyDown(screen.getByRole('dialog', { name: '폴더 삭제' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '폴더 삭제' })).toBeNull()
    expect(onTrashFolder).not.toHaveBeenCalled()
  })

  it('폴더 이름은 메뉴에서 고르면 그 자리에서 고친다', async () => {
    const onRenameFolder = vi.fn().mockResolvedValue(undefined)
    await renderSidebar({ tree: folderTree, onRenameFolder })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'HTTP 접기' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '이름 바꾸기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    const input = screen.getByRole('textbox', { name: 'HTTP 폴더 이름' })
    expect(input).toHaveProperty('value', 'HTTP')
    fireEvent.change(input, { target: { value: 'HTTP v1.1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onRenameFolder).toHaveBeenCalledWith('Specs/HTTP', 'HTTP v1.1'))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'HTTP 폴더 이름' })).toBeNull())
  })

  it('이름을 고치다 다른 곳을 누르면(포커스가 빠지면) 엔터 없이 바로 적용한다', async () => {
    const onRenameFolder = vi.fn().mockResolvedValue(undefined)
    await renderSidebar({ tree: folderTree, onRenameFolder })
    fireEvent.doubleClick(screen.getByRole('button', { name: 'HTTP 접기' }))
    const input = screen.getByRole('textbox', { name: 'HTTP 폴더 이름' })
    fireEvent.change(input, { target: { value: 'HTTP 바뀜' } })
    fireEvent.blur(input)
    await waitFor(() => expect(onRenameFolder).toHaveBeenCalledWith('Specs/HTTP', 'HTTP 바뀜'))
    expect(onRenameFolder).toHaveBeenCalledTimes(1)
  })

  it('폴더를 두 번 누르면 이름을 고치고, Esc 는 그대로 둔다', async () => {
    const onRenameFolder = vi.fn().mockResolvedValue(undefined)
    await renderSidebar({ tree: folderTree, onRenameFolder })
    fireEvent.doubleClick(screen.getByRole('button', { name: 'HTTP 접기' }))
    const input = screen.getByRole('textbox', { name: 'HTTP 폴더 이름' })
    fireEvent.change(input, { target: { value: '바뀜' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'HTTP 폴더 이름' })).toBeNull()
    expect(onRenameFolder).not.toHaveBeenCalled()
    fireEvent.doubleClick(screen.getByRole('button', { name: 'HTTP 접기' }))
    const again = screen.getByRole('textbox', { name: 'HTTP 폴더 이름' })
    fireEvent.change(again, { target: { value: '   ' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toContain('폴더 이름을 입력해 주세요')
  })

  it('앱에서는 폴더가 접힌 채로 시작하고, 펼친 폴더는 다시 열어도 기억한다', async () => {
    sidebarDefaults.expandAll = false
    try {
      window.localStorage.clear()
      const first = await renderSidebar({ tree: folderTree })
      expect(screen.queryByRole('button', { name: /첫 논문/ })).toBeNull()
      const toggles = screen.getAllByRole('button', { name: /펼치기$/ })
      fireEvent.click(toggles[0]!)
      first.unmount()
      await renderSidebar({ tree: folderTree })
      expect(screen.getAllByRole('button', { name: /접기$/ }).length).toBeGreaterThan(0)
    } finally {
      sidebarDefaults.expandAll = true
      window.localStorage.clear()
    }
  })

  it('모든 폴더 접기 버튼이 모든 폴더를 접고 다시 펼친다', async () => {
    await renderSidebar({ tree: folderTree })
    fireEvent.click(screen.getByRole('button', { name: '모든 폴더 접기' }))
    expect(screen.queryByRole('button', { name: /첫 논문/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Specs 펼치기' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '모든 폴더 펼치기' }))
    expect(screen.getByRole('button', { name: /둘째 논문/ })).toBeTruthy()
  })
})

describe('Sidebar — 서지 정보 메뉴', () => {
  it('PDF 메뉴에서 서지 정보를 열고 BibTeX을 복사한다', async () => {
    const onEditBibliography = vi.fn()
    const onCopyBibtex = vi.fn()
    await renderSidebar({ tree: emojiTree, onEditBibliography, onCopyBibtex })
    fireEvent.contextMenu(screen.getByRole('button', { name: /첫 논문/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '서지 정보…' }))
    expect(onEditBibliography).toHaveBeenCalledWith('doc-1')
    fireEvent.contextMenu(screen.getByRole('button', { name: /첫 논문/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'BibTeX 복사' }))
    expect(onCopyBibtex).toHaveBeenCalledWith('doc-1')
  })

  it('폴더 메뉴에는 서지 항목이 없다', async () => {
    await renderSidebar({ tree: emojiTree, onItemIconChange: vi.fn(), onEditBibliography: vi.fn() })
    fireEvent.contextMenu(screen.getByRole('button', { name: '논문 접기' }))
    expect(screen.queryByRole('menuitem', { name: '서지 정보…' })).toBeNull()
  })
})

describe('Sidebar — 검색 가능한 사본', () => {
  it('PDF 메뉴에서 검색 가능한 사본 만들기를 부른다', async () => {
    const onMakeSearchable = vi.fn()
    await renderSidebar({ tree: emojiTree, onMakeSearchable })
    fireEvent.contextMenu(screen.getByRole('button', { name: /첫 논문/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '검색 가능한 PDF 사본 만들기' }))
    expect(onMakeSearchable).toHaveBeenCalledWith('doc-1')
  })
})

/** jsdom 에는 elementFromPoint·레이아웃이 없어, 놓을 자리를 target 으로 흉내 내고 줄의 아래쪽에 놓는다 */
function dragTreeNode(source: HTMLElement, target: HTMLElement) {
  const original = document.elementFromPoint
  document.elementFromPoint = () => target
  try {
    fireEvent.pointerDown(source, { clientX: 10, clientY: 10, pointerId: 3, button: 0 })
    fireEvent.pointerMove(window, { clientX: 10, clientY: 40, pointerId: 3 })
    fireEvent.pointerUp(window, { clientX: 10, clientY: 40, pointerId: 3 })
  } finally {
    document.elementFromPoint = original
  }
}

describe('vaultFolderName', () => {
  it('Vault 경로에서 마지막 폴더 이름만 꺼낸다', () => {
    expect(vaultFolderName('C:/Workspace/IWAE_Vault')).toBe('IWAE_Vault')
    expect(vaultFolderName('C:\\Users\\me\\Notes\\')).toBe('Notes')
    expect(vaultFolderName('/home/me/vault')).toBe('vault')
  })
})

describe('SidebarFooter — Vault 메뉴', () => {
  it('지금 Vault 의 이름·경로와 할 일을 보이고, 설정 단추를 둔다', async () => {
    const { SidebarFooter } = await import('./Sidebar')
    const onOpenSettings = vi.fn()
    const onSwitchVault = vi.fn()
    render(<SidebarFooter vaultRoot="C:/Work/Research" recentVaultPaths={['C:/Work/Research', 'D:/Old']} onOpenSettings={onOpenSettings} onSwitchVault={onSwitchVault} />)

    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /Research/ }))
    const menu = screen.getByRole('menu', { name: 'Vault 메뉴' })
    expect(menu.textContent).toContain('C:/Work/Research')
    expect(screen.getByRole('menuitem', { name: '다른 폴더 열기…' })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: '예시 Vault 만들기' })).toBeDefined()
    // 지금 Vault 는 최근 목록에 다시 나오지 않는다
    expect(screen.queryAllByRole('menuitem', { name: /Research/ })).toHaveLength(0)
    expect(screen.getByRole('menuitem', { name: /^Old/ })).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: '시작 화면으로' }))
    expect(onSwitchVault).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
