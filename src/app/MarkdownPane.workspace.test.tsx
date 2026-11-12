// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EMPTY_MEMO_NOTE, type MemoNote } from '../core/memoNote'
import { MemoNoteContext, type MemoNoteApi } from '../pdf/memoNoteContext'
import { MarkdownPane } from './MarkdownPane'
import { PaneIdContext, WorkspaceContext, getAttachRequest, getRoutedMemoDraft, setAttachRequest, setRoutedMemoDraft, type WorkspaceLink } from './workspaceContext'
import { DEFAULT_CHANNELS } from './workspaceChannels'
import { resetPointSignals } from './workspaceSignal'

const NOTE = '노트/N.iwnote'

beforeEach(() => {
  resetPointSignals()
  setRoutedMemoDraft(null)
  setAttachRequest(null)
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10, toJSON: () => ({}) }) as DOMRect
})
afterEach(cleanup)

const noteApi = (overrides: Partial<MemoNoteApi> = {}): MemoNoteApi => ({
  entries: [{ path: NOTE, title: 'N' }],
  openPath: null,
  openTitle: null,
  openNote: null,
  open: vi.fn(),
  create: vi.fn().mockResolvedValue(null),
  updateOpen: vi.fn(),
  noteAt: () => EMPTY_MEMO_NOTE,
  updateNoteAt: vi.fn(),
  notesOf: () => [],
  ...overrides,
})

const link = (overrides: Partial<WorkspaceLink> = {}): WorkspaceLink => ({
  channels: DEFAULT_CHANNELS,
  memoNoteTargetFor: () => null,
  visibleNotePathsFor: () => [],
  pinTab: vi.fn(),
  openNoteBeside: vi.fn().mockResolvedValue(null),
  revealMemo: vi.fn(),
  ...overrides,
})

function mount(api: MemoNoteApi, workspace: WorkspaceLink, onCreated = vi.fn()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoNoteContext.Provider value={api}>
      <WorkspaceContext.Provider value={workspace}>
        <PaneIdContext.Provider value="left">{children}</PaneIdContext.Provider>
      </WorkspaceContext.Provider>
    </MemoNoteContext.Provider>
  )
  return render(
    <MarkdownPane sourceFileId="md-id" path="docs/guide.md" title="Guide" source={'## 중요한 제목\n\n본문입니다.'} interactionMode="text" onBoxHighlightCreated={onCreated} boxHighlights={[]} />,
    { wrapper },
  )
}

const selectHeading = () => {
  const heading = screen.getByRole('heading', { name: '중요한 제목' })
  const range = document.createRange()
  range.selectNodeContents(heading)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  fireEvent.mouseUp(screen.getByRole('article', { name: 'Guide' }))
}

describe('MarkdownPane — 새 메모는 노트 탭으로 간다(노트 바는 없다)', () => {
  it('같은 색 창에 노트 탭이 보이면 그 노트로 초안을 보낸다', async () => {
    const workspace = link({ memoNoteTargetFor: () => NOTE })
    mount(noteApi(), workspace)
    selectHeading()
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    expect(getRoutedMemoDraft()!.path).toBe(NOTE)
    expect(workspace.openNoteBeside).not.toHaveBeenCalled()
  })

  it('보이는 노트가 없으면 노트를 옆에 열고 그 노트로 초안을 보낸다', async () => {
    const workspace = link({ openNoteBeside: vi.fn().mockResolvedValue(NOTE) })
    mount(noteApi(), workspace)
    selectHeading()
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    expect(workspace.openNoteBeside).toHaveBeenCalledWith('left')
    expect(getRoutedMemoDraft()!.path).toBe(NOTE)
    expect(getRoutedMemoDraft()!.highlight.anchor.quote).toBe('중요한 제목')
  })

  it('노트를 열 수 없으면 초안을 만들지 않는다', async () => {
    const workspace = link({ openNoteBeside: vi.fn().mockResolvedValue(null) })
    mount(noteApi(), workspace)
    selectHeading()
    await waitFor(() => expect(workspace.openNoteBeside).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(getRoutedMemoDraft()).toBeNull()
  })

  it('쓰지 않고 비워 두면 아무것도 남지 않고, 글을 쓰면 형광펜을 만들고 그 노트에 끼운다', async () => {
    const created = vi.fn()
    const api = noteApi()
    mount(api, link({ openNoteBeside: vi.fn().mockResolvedValue(NOTE) }), created)
    selectHeading()
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    act(() => getRoutedMemoDraft()!.cancel())
    await waitFor(() => expect(getRoutedMemoDraft()).toBeNull())
    expect(created).not.toHaveBeenCalled()

    selectHeading()
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    act(() => getRoutedMemoDraft()!.save({ text: '쓴 글', html: '' }, undefined, 0))
    expect(created).toHaveBeenCalledTimes(1)
    expect(api.updateNoteAt).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.updateNoteAt).mock.calls[0]![0]).toBe(NOTE)
    const next = vi.mocked(api.updateNoteAt).mock.calls[0]![1]({ version: 1, blocks: [] } as MemoNote)
    expect(next.blocks.map((block) => block.kind)).toEqual(['memo'])
  })

  it('원문 더하기 요청이 있으면 고른 글은 새 메모가 아니라 그 카드의 원문이 된다', async () => {
    const created = vi.fn()
    const api = noteApi()
    const workspace = link({ openNoteBeside: vi.fn().mockResolvedValue(NOTE) })
    mount(api, workspace, created)
    setAttachRequest({ path: NOTE, key: 'card' })
    selectHeading()
    await waitFor(() => expect(api.updateNoteAt).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.updateNoteAt).mock.calls[0]![0]).toBe(NOTE)
    expect(created).toHaveBeenCalledTimes(1)
    expect(getAttachRequest()).toBeNull()
    expect(getRoutedMemoDraft()).toBeNull()
    expect(workspace.openNoteBeside).not.toHaveBeenCalled()
  })
})

describe('MarkdownPane — 메모 위 마우스 올림 보고는 떠나거나 사라지면 기다리던 프레임을 거둔다', () => {
  const stubFrames = () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let next = 1
    const request = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { const id = next++; callbacks.set(id, callback); return id })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { callbacks.delete(id) })
    return { callbacks, request, cancel }
  }
  afterEach(() => vi.restoreAllMocks())

  it('포인터가 칸을 떠나면 기다리던 프레임을 취소한다', () => {
    const frames = stubFrames()
    mount(noteApi(), link())
    const article = screen.getByRole('article', { name: 'Guide' })
    const before = new Set(frames.callbacks.keys())
    fireEvent.pointerMove(article, { clientX: 5, clientY: 5 })
    const pending = [...frames.callbacks.keys()].filter((id) => !before.has(id))
    expect(pending).toHaveLength(1)
    fireEvent.pointerLeave(article)
    expect(frames.cancel).toHaveBeenCalledWith(pending[0])
    expect(frames.callbacks.has(pending[0]!)).toBe(false)
  })

  it('칸이 사라지면 기다리던 프레임을 취소한다', () => {
    const frames = stubFrames()
    const view = mount(noteApi(), link())
    const before = new Set(frames.callbacks.keys())
    fireEvent.pointerMove(screen.getByRole('article', { name: 'Guide' }), { clientX: 5, clientY: 5 })
    const pending = [...frames.callbacks.keys()].filter((id) => !before.has(id))
    expect(pending).toHaveLength(1)
    view.unmount()
    expect(frames.cancel).toHaveBeenCalledWith(pending[0])
  })
})
