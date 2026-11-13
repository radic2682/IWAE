// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoNotesSection, memoFolderIconKey, memoNoteIconKey } from './MemoNotesSection'

/** 노트 목록 구역의 자리를 정한다(jsdom 은 자리를 모른다). 목록 밖 판정이 이것으로 이뤄진다 */
function placeSection(container: HTMLElement): void {
  container.querySelector('.side-memo-notes')!.getBoundingClientRect = () => ({ top: 0, height: 200, bottom: 200, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}) })
}

describe('MemoNotesSection', () => {
  const entries = [{ path: '노트/TODO.iwnote', title: 'TODO' }]

  it('노트를 열고, 다른 항목처럼 우클릭으로 이모지·이름 바꾸기·지우기를 한다', () => {
    const onOpen = vi.fn()
    const onPickIcon = vi.fn()
    const onClearIcon = vi.fn()
    const onTrash = vi.fn().mockResolvedValue(undefined)
    const key = memoNoteIconKey('노트/TODO.iwnote')
    render(<MemoNotesSection entries={entries} openPath="노트/TODO.iwnote" onOpen={onOpen} onCreate={vi.fn()} onRename={vi.fn()} onTrash={onTrash}
      icons={{ [key]: '📘' }} onPickIcon={onPickIcon} onClearIcon={onClearIcon} />)
    const item = screen.getByRole('button', { name: /TODO/ })
    expect(item.textContent).toContain('📘')
    expect(item.getAttribute('aria-current')).toBe('true')
    fireEvent.click(item)
    expect(onOpen).toHaveBeenCalledWith('노트/TODO.iwnote')
    fireEvent.contextMenu(item)
    fireEvent.click(screen.getByRole('menuitem', { name: '이모지 바꾸기…' }))
    expect(onPickIcon).toHaveBeenCalledWith(key, expect.any(Number), expect.any(Number))
    fireEvent.contextMenu(item)
    fireEvent.click(screen.getByRole('menuitem', { name: '이모지 지우기' }))
    expect(onClearIcon).toHaveBeenCalledWith(key)
    fireEvent.contextMenu(item)
    fireEvent.click(screen.getByRole('menuitem', { name: '휴지통으로 이동' }))
    expect(onTrash).toHaveBeenCalledWith('노트/TODO.iwnote')
  })

  it('우클릭 메뉴의 「탭으로 열기」는 노트 바의 열린 노트와 따로 그 노트를 탭으로 연다. 기능이 없으면 항목도 없다', () => {
    const onOpen = vi.fn()
    const onOpenInTab = vi.fn()
    const { unmount } = render(<MemoNotesSection entries={entries} openPath={null} onOpen={onOpen} onOpenInTab={onOpenInTab} onCreate={vi.fn()} onRename={vi.fn()} onTrash={vi.fn()} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /TODO/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '탭으로 열기' }))
    expect(onOpenInTab).toHaveBeenCalledWith('노트/TODO.iwnote')
    expect(onOpen).not.toHaveBeenCalled()
    unmount()
    render(<MemoNotesSection entries={entries} openPath={null} onOpen={onOpen} onCreate={vi.fn()} onRename={vi.fn()} onTrash={vi.fn()} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /TODO/ }))
    expect(screen.queryByRole('menuitem', { name: '탭으로 열기' })).toBeNull()
  })

  it('노트 아이콘을 누르면 노트를 열지 않고 바로 이모지를 고른다', () => {
    const onOpen = vi.fn()
    const onPickIcon = vi.fn()
    render(<MemoNotesSection entries={entries} openPath={null} onOpen={onOpen} onCreate={vi.fn()} onRename={vi.fn()} onTrash={vi.fn()} onPickIcon={onPickIcon} />)
    const item = screen.getByRole('button', { name: /TODO/ })
    fireEvent.click(item.querySelector('[data-emoji-pick]')!)
    expect(onPickIcon).toHaveBeenCalledWith(memoNoteIconKey('노트/TODO.iwnote'), expect.any(Number), expect.any(Number))
    expect(onOpen).not.toHaveBeenCalled()
  })

  const three = [
    { path: '노트/A.iwnote', title: 'A' },
    { path: '노트/B.iwnote', title: 'B' },
    { path: '노트/C.iwnote', title: 'C' },
  ]

  it('노트를 끌어 다른 자리에 놓으면 새 차례를 알리고, 끈 뒤에는 노트를 열지 않는다', () => {
    const onOpen = vi.fn()
    const onReorder = vi.fn()
    const { container } = render(<MemoNotesSection entries={three} openPath={null} onOpen={onOpen} onCreate={vi.fn()} onRename={vi.fn()} onTrash={vi.fn()} onReorder={onReorder} />)
    container.querySelectorAll('.side-memo-note-list > li').forEach((item, index) => {
      item.getBoundingClientRect = () => ({ top: index * 30, height: 30, bottom: index * 30 + 30, left: 0, right: 200, width: 200, x: 0, y: index * 30, toJSON: () => ({}) })
    })
    placeSection(container)
    const first = screen.getByRole('button', { name: 'A' })
    fireEvent.pointerDown(first, { button: 0, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 40, pointerId: 1 })
    fireEvent.pointerMove(window, { clientY: 85, pointerId: 1 })
    expect(container.querySelector('.side-memo-drop-after')).not.toBeNull()
    fireEvent.pointerUp(window, { clientY: 85, pointerId: 1 })
    fireEvent.click(first)
    expect(onReorder).toHaveBeenCalledWith(['노트/B.iwnote', '노트/C.iwnote', '노트/A.iwnote'])
    expect(onOpen).not.toHaveBeenCalled()
    expect(container.querySelector('.side-memo-drop-after')).toBeNull()
  })

  it('끄는 알약이 뜨고, 포인터가 목록 밖으로 나가면 놓을 자리 줄이 사라지고 놓아도 차례는 그대로다', () => {
    const onReorder = vi.fn()
    const { container } = render(<MemoNotesSection entries={three} openPath={null} onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onTrash={vi.fn()} onReorder={onReorder} />)
    container.querySelectorAll('.side-memo-note-list > li').forEach((item, index) => {
      item.getBoundingClientRect = () => ({ top: index * 30, height: 30, bottom: index * 30 + 30, left: 0, right: 200, width: 200, x: 0, y: index * 30, toJSON: () => ({}) })
    })
    placeSection(container)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'A' }), { button: 0, clientX: 20, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 20, clientY: 85, pointerId: 1 })
    expect(container.ownerDocument.querySelector('.tab-drag-ghost .pane-top-tab-label')!.textContent).toBe('A')
    expect(container.querySelector('.side-memo-drop-after')).not.toBeNull()
    fireEvent.pointerMove(window, { clientX: 500, clientY: 85, pointerId: 1 })
    expect(container.querySelector('.side-memo-drop-after')).toBeNull()
    expect(container.querySelector('[class*="side-memo-drop"], .side-tree-drop-before, .side-tree-drop-after, .side-tree-drop-inside')).toBeNull()
    fireEvent.pointerUp(window, { clientX: 500, clientY: 85, pointerId: 1 })
    expect(onReorder).not.toHaveBeenCalled()
    expect(container.ownerDocument.querySelector('.tab-drag-ghost')).toBeNull()
    expect(document.body.classList.contains('dock-dragging')).toBe(false)
  })

  it('끄는 중의 Esc 는 끌기만 취소하고 다른 곳(바깥의 Esc 듣는 것)으로 가지 않는다. 끌기 전의 Esc 는 그대로 지나간다', () => {
    const onReorder = vi.fn()
    const { container } = render(<MemoNotesSection entries={three} openPath={null} onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onTrash={vi.fn()} onReorder={onReorder} />)
    container.querySelectorAll('.side-memo-note-list > li').forEach((item, index) => {
      item.getBoundingClientRect = () => ({ top: index * 30, height: 30, bottom: index * 30 + 30, left: 0, right: 200, width: 200, x: 0, y: index * 30, toJSON: () => ({}) })
    })
    placeSection(container)
    const outside = vi.fn()
    document.addEventListener('keydown', outside)
    try {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'A' }), { button: 0, clientX: 20, clientY: 10, pointerId: 1 })
      // 아직 끌기 전(움직이지 않았다): Esc 는 막지 않는다
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(outside).toHaveBeenCalledTimes(1)
      fireEvent.pointerDown(screen.getByRole('button', { name: 'A' }), { button: 0, clientX: 20, clientY: 10, pointerId: 1 })
      fireEvent.pointerMove(window, { clientX: 20, clientY: 85, pointerId: 1 })
      expect(container.ownerDocument.querySelector('.tab-drag-ghost')).not.toBeNull()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      // 끌기는 취소되고 Esc 는 아무 데도 더 가지 않았다
      expect(container.ownerDocument.querySelector('.tab-drag-ghost')).toBeNull()
      expect(outside).toHaveBeenCalledTimes(1)
      fireEvent.pointerUp(window, { clientX: 20, clientY: 85, pointerId: 1 })
      expect(onReorder).not.toHaveBeenCalled()
    } finally { document.removeEventListener('keydown', outside) }
  })

  it('칸 위에 놓으면 그 자리로 노트를 열고, 목록의 차례는 건드리지 않는다.', () => {
    const open = vi.fn()
    const onReorder = vi.fn()
    const { container } = render(<MemoNotesSection entries={three} openPath={null} onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onTrash={vi.fn()} onReorder={onReorder} paneDrop={{ edgesFor: () => [], open }} />)
    placeSection(container)
    const panes = document.createElement('div')
    panes.className = 'panes'
    panes.innerHTML = '<div class="pane-grid-cell"><div class="pane-card" data-card-pane="p1"><div class="pane-grid-body"></div></div></div>'
    document.body.append(panes)
    const cell = panes.querySelector<HTMLElement>('.pane-grid-cell')!
    const rect = (x: number, y: number, w: number, h: number) => () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) }) as DOMRect
    cell.getBoundingClientRect = rect(300, 0, 400, 400)
    panes.querySelector<HTMLElement>('.pane-card')!.getBoundingClientRect = rect(303, 3, 394, 394)
    document.elementFromPoint = () => panes.querySelector('.pane-grid-body')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'B' }), { button: 0, clientX: 20, clientY: 40, pointerId: 1 })
    fireEvent.pointerMove(window, { clientX: 400, clientY: 200, pointerId: 1 })
    expect(document.querySelector('.tab-dock-preview-on')).not.toBeNull()
    expect(document.body.classList.contains('dock-drop-ok')).toBe(true)
    fireEvent.pointerUp(window, { clientX: 400, clientY: 200, pointerId: 1 })
    expect(open).toHaveBeenCalledWith({ kind: 'note', path: '노트/B.iwnote' }, { kind: 'body', pane: 'p1', zone: 'center' })
    expect(onReorder).not.toHaveBeenCalled()
    panes.remove()
  })

  it('Alt+↑/↓ 로 한 칸씩 옮긴다', () => {
    const onReorder = vi.fn()
    render(<MemoNotesSection entries={three} openPath={null} onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onTrash={vi.fn()} onReorder={onReorder} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'B' }), { key: 'ArrowUp', altKey: true })
    expect(onReorder).toHaveBeenLastCalledWith(['노트/B.iwnote', '노트/A.iwnote', '노트/C.iwnote'])
    fireEvent.keyDown(screen.getByRole('button', { name: 'B' }), { key: 'ArrowDown', altKey: true })
    expect(onReorder).toHaveBeenLastCalledWith(['노트/A.iwnote', '노트/C.iwnote', '노트/B.iwnote'])
  })

  describe('폴더', () => {
    const tree = [
      { path: '노트/A.iwnote', title: 'A' },
      { path: '노트/회의/B.iwnote', title: 'B' },
    ]
    const base = { openPath: null, onOpen: vi.fn(), onCreate: vi.fn(), onRename: vi.fn(), onTrash: vi.fn() }

    it('하위 폴더는 접혀 있다가 누르면 펼쳐 그 안의 노트를 보이고, 펼친 것을 기억한다', () => {
      window.localStorage.removeItem('memo-expanded-test')
      const first = render(<MemoNotesSection {...base} entries={tree} folders={['노트/회의']} expandedStorageKey="memo-expanded-test" />)
      expect(screen.queryByRole('button', { name: 'B' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: '회의 펼치기' }))
      expect(screen.getByRole('button', { name: 'B' })).toBeTruthy()
      first.unmount()
      render(<MemoNotesSection {...base} entries={tree} folders={['노트/회의']} expandedStorageKey="memo-expanded-test" />)
      expect(screen.getByRole('button', { name: 'B' })).toBeTruthy()
    })

    it('노트를 폴더 줄 가운데에 끌어 놓으면 그 폴더로 옮긴다', () => {
      const onMove = vi.fn().mockResolvedValue(undefined)
      const { container } = render(<MemoNotesSection {...base} entries={tree} folders={['노트/회의']} onMove={onMove} />)
      container.querySelectorAll('.side-memo-note-list > li').forEach((item, index) => {
        item.getBoundingClientRect = () => ({ top: index * 30, height: 30, bottom: index * 30 + 30, left: 0, right: 200, width: 200, x: 0, y: index * 30, toJSON: () => ({}) })
      })
      placeSection(container)
      // 줄 차례: 회의(폴더), A
      const note = screen.getByRole('button', { name: 'A' })
      fireEvent.pointerDown(note, { button: 0, clientY: 45, pointerId: 1 })
      fireEvent.pointerMove(window, { clientY: 30, pointerId: 1 })
      fireEvent.pointerMove(window, { clientY: 15, pointerId: 1 })
      expect(container.querySelector('.side-tree-drop-inside')).not.toBeNull()
      fireEvent.pointerUp(window, { clientY: 15, pointerId: 1 })
      expect(onMove).toHaveBeenCalledWith('노트/A.iwnote', '노트/회의', undefined)
    })

    it('우클릭 메뉴로 다른 폴더에 옮기고, 탐색기에서 보고, 경로를 복사한다', () => {
      const onMove = vi.fn().mockResolvedValue(undefined)
      const onReveal = vi.fn()
      const onCopyPath = vi.fn()
      render(<MemoNotesSection {...base} entries={tree} folders={['노트/회의']} onMove={onMove} onReveal={onReveal} onCopyPath={onCopyPath} />)
      const note = screen.getByRole('button', { name: 'A' })
      fireEvent.contextMenu(note)
      const group = screen.getByRole('group', { name: '폴더로 옮기기' })
      expect(within(group).queryByRole('menuitem', { name: /노트 \(맨 위\)/ })).toBeNull()
      fireEvent.click(within(group).getByRole('menuitem', { name: '회의' }))
      expect(onMove).toHaveBeenCalledWith('노트/A.iwnote', '노트/회의')
      fireEvent.contextMenu(note)
      fireEvent.click(screen.getByRole('menuitem', { name: '탐색기에서 보기' }))
      expect(onReveal).toHaveBeenCalledWith('노트/A.iwnote')
      fireEvent.contextMenu(note)
      fireEvent.click(screen.getByRole('menuitem', { name: '경로 복사' }))
      expect(onCopyPath).toHaveBeenCalledWith('노트/A.iwnote')
    })

    it('줄의 색 단추와 우클릭으로 노트·폴더 색을 바꾸고, 색을 고르면 아이콘이 그 색으로 칠해진다', () => {
      const onColorChange = vi.fn()
      const { rerender } = render(<MemoNotesSection {...base} entries={tree} folders={['노트/회의']} onColorChange={onColorChange} />)
      fireEvent.click(screen.getByRole('button', { name: 'A 색 바꾸기' }))
      fireEvent.click(screen.getByRole('menuitemradio', { name: '노트 색 초록' }))
      expect(onColorChange).toHaveBeenCalledWith(memoNoteIconKey('노트/A.iwnote'), 'green')
      fireEvent.contextMenu(screen.getByRole('button', { name: '회의 펼치기' }))
      fireEvent.click(screen.getByRole('menuitemradio', { name: '폴더 색 보라' }))
      expect(onColorChange).toHaveBeenCalledWith(memoFolderIconKey('노트/회의'), 'purple')
      rerender(<MemoNotesSection {...base} entries={tree} folders={['노트/회의']} onColorChange={onColorChange} colors={{ [memoNoteIconKey('노트/A.iwnote')]: 'green' }} />)
      expect(screen.getByRole('button', { name: 'A' }).querySelector('.side-memo-note-colored')).not.toBeNull()
    })

    it('폴더 메뉴: 이 폴더에 새 노트, 새 하위 폴더, 폴더 지우기(확인 뒤)', async () => {
      const onCreateIn = vi.fn()
      const onCreateFolder = vi.fn().mockResolvedValue(undefined)
      const onTrashFolder = vi.fn().mockResolvedValue(undefined)
      render(<MemoNotesSection {...base} entries={tree} folders={['노트/회의']} onCreateIn={onCreateIn} onCreateFolder={onCreateFolder} onTrashFolder={onTrashFolder} />)
      const folder = screen.getByRole('button', { name: '회의 펼치기' })
      fireEvent.contextMenu(folder)
      fireEvent.click(screen.getByRole('menuitem', { name: '이 폴더에 새 노트' }))
      expect(onCreateIn).toHaveBeenCalledWith('노트/회의')
      fireEvent.contextMenu(screen.getByRole('button', { name: /^회의 (접기|펼치기)$/ }))
      fireEvent.click(screen.getByRole('menuitem', { name: '새 하위 폴더…' }))
      const input = screen.getByRole('textbox', { name: '새 노트 폴더 이름' })
      fireEvent.change(input, { target: { value: '2026' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onCreateFolder).toHaveBeenCalledWith('노트/회의', '2026')
      fireEvent.contextMenu(screen.getByRole('button', { name: /^회의 (접기|펼치기)$/ }))
      fireEvent.click(screen.getByRole('menuitem', { name: '휴지통으로 이동…' }))
      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toContain('문서 1개')
      fireEvent.click(within(dialog).getByRole('button', { name: '휴지통으로 이동' }))
      expect(onTrashFolder).toHaveBeenCalledWith('노트/회의')
    })
  })
})
