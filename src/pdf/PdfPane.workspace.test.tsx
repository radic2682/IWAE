// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Anchor } from '../core/anchor'
import { EMPTY_MEMO_NOTE, type MemoNote } from '../core/memoNote'
import { PaneIdContext, WorkspaceContext, getAttachRequest, getRoutedMemoDraft, setAttachRequest, setRoutedMemoDraft, type WorkspaceLink } from '../app/workspace/workspaceContext'
import { DEFAULT_CHANNELS } from '../app/workspace/workspaceChannels'
import { emitPointSignal, resetPointSignals, subscribePointSignal, type DeliveredSignal } from '../app/workspace/workspaceSignal'
import { PdfPane } from './PdfPane'
import { MemoNoteContext, type MemoNoteApi } from './memoNoteContext'
import type { PersistentPdfHighlight } from './persistentHighlight'

vi.mock('../bridge/pdf', async (importOriginal) => {
  const original = await importOriginal<typeof import('../bridge/pdf')>()
  return {
    ...original,
    pageTextIndex: vi.fn().mockResolvedValue({ text: 'A', chars: [{ c: 'A', x: 10, y: 10, w: 10, h: 10 }] }),
    pdfPageLinks: vi.fn().mockResolvedValue([]),
  }
})

const DOC = '0123456789ab'
const anchor = (x: number): Anchor => ({ docId: DOC, page: 0, coordSpace: 'pdfium-page', rects: [{ x, y: 0, w: 100, h: 100 }], charRange: [x, x + 1], quote: String(x), prefix: '', suffix: '' })
const make = (id: string, x: number): PersistentPdfHighlight => ({ id, color: 'yellow', note: id, anchor: anchor(x) }) as PersistentPdfHighlight
const NOTE_A = '노트/A.iwnote'
const NOTE_Z = '노트/Z.iwnote'

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
  resetPointSignals()
  setRoutedMemoDraft(null)
  setAttachRequest(null)
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  vi.restoreAllMocks()
})

/** 노트 하나: 그 노트가 담은 형광펜 id 들 */
const noteOf = (...ids: string[]): MemoNote => ({ ...EMPTY_MEMO_NOTE, blocks: ids.map((id) => ({ id: `b-${id}`, kind: 'memo' as const, highlightId: id })) })

const noteApi = (overrides: Partial<MemoNoteApi> = {}): MemoNoteApi => ({
  entries: [{ path: NOTE_A, title: 'A' }, { path: NOTE_Z, title: 'Z' }],
  openPath: NOTE_A,
  openTitle: 'A',
  openNote: EMPTY_MEMO_NOTE,
  open: vi.fn(),
  create: vi.fn().mockResolvedValue(null),
  updateOpen: vi.fn(),
  noteAt: () => null,
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

function mountPane(options: { api: MemoNoteApi; link: WorkspaceLink; highlights?: readonly PersistentPdfHighlight[]; onlyOpenNotes?: boolean; onCreated?: (highlight: PersistentPdfHighlight) => void; pane?: 'left' | 'right'; onUpdated?: (id: string, patch: unknown) => void }) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoNoteContext.Provider value={options.api}>
      <WorkspaceContext.Provider value={options.link}>
        <PaneIdContext.Provider value={options.pane ?? 'left'}>{children}</PaneIdContext.Provider>
      </WorkspaceContext.Provider>
    </MemoNoteContext.Provider>
  )
  return render(
    <PdfPane
      docId={DOC}
      pageSizes={[[612, 792], [612, 792]]}
      hasText
      persistentHighlights={options.highlights}
      onPersistentHighlightUpdated={options.onUpdated as never ?? vi.fn()}
      onPersistentHighlightCreated={options.onCreated as never}
      onlyOpenNotes={options.onlyOpenNotes}
    />,
    { wrapper },
  )
}

const selectionLayer = (container: HTMLElement) => waitFor(() => {
  const found = container.querySelector('[data-testid="selection-layer"]')
  if (found === null) throw new Error('선택 레이어가 아직 없다')
  return found
})

const dragSelect = (layer: Element) => {
  fireEvent.pointerDown(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
  fireEvent.pointerMove(layer, { clientX: 200, clientY: 34, pointerId: 1 })
  fireEvent.pointerUp(layer, { button: 0, clientX: 200, clientY: 34, pointerId: 1 })
}

const clickAt = (layer: Element) => {
  fireEvent.pointerDown(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
  fireEvent.pointerUp(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
}

describe('PdfPane — 열린 노트 표시만 보기와 색 채널', () => {
  const inA = make('in-a', 0)
  const inZ = make('in-z', 200)
  const loose = make('no-note', 400)
  const owners: Record<string, string[]> = { 'in-a': [NOTE_A], 'in-z': [NOTE_Z] }
  const drawn = async (container: HTMLElement) => {
    await selectionLayer(container)
    return [...container.querySelectorAll('.selection-persistent-highlight')]
  }

  it('같은 색 창에 보이는 노트(들)의 형광펜만 보인다 — 마지막으로 만진 노트(openPath)는 더하지 않는다', async () => {
    const { container } = mountPane({
      api: noteApi({ notesOf: (id) => owners[id] ?? [] }),
      link: link({ visibleNotePathsFor: () => [NOTE_Z] }),
      highlights: [inA, inZ, loose],
      onlyOpenNotes: true,
    })
    expect((await drawn(container)).length).toBe(1)
  })

  it('같은 색 창에 노트가 둘 보이면 둘의 형광펜이 모두 보인다', async () => {
    const { container } = mountPane({
      api: noteApi({ notesOf: (id) => owners[id] ?? [] }),
      link: link({ visibleNotePathsFor: () => [NOTE_A, NOTE_Z] }),
      highlights: [inA, inZ, loose],
      onlyOpenNotes: true,
    })
    expect((await drawn(container)).length).toBe(2)
  })

  it('같은 색 창에 보이는 노트가 없으면(다른 색) 예외 말고는 모두 감춘다', async () => {
    const { container } = mountPane({
      api: noteApi({ notesOf: (id) => owners[id] ?? [] }),
      link: link({ visibleNotePathsFor: () => [] }),
      highlights: [inA, inZ, loose],
      onlyOpenNotes: true,
    })
    expect((await drawn(container)).length).toBe(0)
  })

  it('끄면 모두 그려진다', async () => {
    const { container } = mountPane({
      api: noteApi({ notesOf: (id) => owners[id] ?? [] }),
      link: link({ visibleNotePathsFor: () => [NOTE_Z] }),
      highlights: [inA, inZ, loose],
      onlyOpenNotes: false,
    })
    expect((await drawn(container)).length).toBe(3)
  })
})

describe('PdfPane — 다른 노트 형광펜 표시(같은 색 창에 보이는 노트 기준)', () => {
  const inZ = make('in-z', 0)
  const inA = make('in-a', 200)
  const loose = make('no-note', 400)
  const owners: Record<string, string[]> = { 'in-z': [NOTE_Z], 'in-a': [NOTE_A] }
  const notes: Record<string, MemoNote> = { [NOTE_Z]: noteOf('in-z'), [NOTE_A]: noteOf('in-a') }
  const others = async (container: HTMLElement) => {
    await selectionLayer(container)
    return [...container.querySelectorAll('.selection-highlight-other')]
  }

  it('같은 색 창에 보이는 노트에 없는 형광펜(다른 노트·노트 없음)은 흐리게 보이고, 보이는 노트의 것은 그대로다', async () => {
    const { container } = mountPane({
      api: noteApi({ notesOf: (id) => owners[id] ?? [], noteAt: (path) => notes[path] ?? null }),
      link: link({ visibleNotePathsFor: () => [NOTE_Z] }),
      highlights: [inZ, inA, loose],
    })
    expect((await others(container)).length).toBe(2)
  })

  it('보이는 노트가 둘이면 둘 다 「이 노트에 있다」로 센다', async () => {
    const { container } = mountPane({
      api: noteApi({ notesOf: (id) => owners[id] ?? [], noteAt: (path) => notes[path] ?? null }),
      link: link({ visibleNotePathsFor: () => [NOTE_Z, NOTE_A] }),
      highlights: [inZ, inA, loose],
    })
    expect((await others(container)).length).toBe(1)
  })

  it('같은 색 창에 보이는 노트가 없으면 모두 보통으로 그린다', async () => {
    const { container } = mountPane({
      api: noteApi({ notesOf: (id) => owners[id] ?? [], noteAt: (path) => notes[path] ?? null }),
      link: link({ visibleNotePathsFor: () => [] }),
      highlights: [inZ, inA, loose],
    })
    expect((await others(container)).length).toBe(0)
  })
})

describe('PdfPane — 새 메모는 노트 탭으로 간다(노트 바는 없다)', () => {
  it('같은 색 창에 메모 노트 탭이 보이면 새 메모는 그 노트의 새 메모 카드로 간다(옆에 노트를 새로 열지 않는다)', async () => {
    const api = noteApi({ openPath: null, openTitle: null, openNote: null })
    const workspace = link({ memoNoteTargetFor: () => NOTE_Z })
    const { container } = mountPane({ api, link: workspace })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    expect(getRoutedMemoDraft()!.path).toBe(NOTE_Z)
    expect(api.create).not.toHaveBeenCalled()
    expect(workspace.openNoteBeside).not.toHaveBeenCalled()
  })

  it('보이는 노트가 없으면 노트를 옆에 열고(openNoteBeside) 그 노트로 초안을 보낸다', async () => {
    const api = noteApi()
    const workspace = link({ openNoteBeside: vi.fn().mockResolvedValue(NOTE_A) })
    const { container } = mountPane({ api, link: workspace })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    expect(workspace.openNoteBeside).toHaveBeenCalledWith('left')
    expect(getRoutedMemoDraft()!.path).toBe(NOTE_A)
    // 문서 창에는 새 메모 카드가 없다(노트 바가 없으므로 노트 탭이 그린다)
    expect(container.querySelector('[data-note-block="draft"]')).toBeNull()
  })

  it('노트를 열 수 없으면(만들지 못함) 초안도 만들지 않는다', async () => {
    const workspace = link({ openNoteBeside: vi.fn().mockResolvedValue(null) })
    const { container } = mountPane({ api: noteApi(), link: workspace })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(workspace.openNoteBeside).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(getRoutedMemoDraft()).toBeNull()
  })

  it('옆에 연 노트에서 글을 쓰고 저장하면 형광펜을 만들고 그 노트에 끼운다', async () => {
    const created = vi.fn()
    const api = noteApi()
    const { container } = mountPane({ api, link: link({ openNoteBeside: vi.fn().mockResolvedValue(NOTE_Z) }), onCreated: created })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    const draft = getRoutedMemoDraft()!
    act(() => draft.save({ text: '새 메모', html: '' }, undefined, 1))
    expect(created).toHaveBeenCalledTimes(1)
    expect(created.mock.calls[0]![0]).toMatchObject({ id: draft.highlight.id, note: '새 메모' })
    expect(api.updateNoteAt).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.updateNoteAt).mock.calls[0]![0]).toBe(NOTE_Z)
    const note: MemoNote = { version: 1, blocks: [{ id: 'b0', kind: 'text', text: '앞' }, { id: 'b1', kind: 'text', text: '뒤' }] } as MemoNote
    const next = vi.mocked(api.updateNoteAt).mock.calls[0]![1](note)
    expect(next.blocks.map((block) => block.kind)).toEqual(['text', 'memo', 'text'])
    // 열린 노트 경로(updateOpen)로는 고치지 않는다
    expect(api.updateOpen).not.toHaveBeenCalled()
    await waitFor(() => expect(getRoutedMemoDraft()).toBeNull())
  })

  it('쓰지 않고 비워 두면(취소) 칠한 것도 함께 버려진다 — 노트에도 저장소에도 아무것도 남지 않는다', async () => {
    const created = vi.fn()
    const api = noteApi()
    const { container } = mountPane({ api, link: link({ openNoteBeside: vi.fn().mockResolvedValue(NOTE_Z) }), onCreated: created })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    act(() => getRoutedMemoDraft()!.cancel())
    await waitFor(() => expect(getRoutedMemoDraft()).toBeNull())
    expect(created).not.toHaveBeenCalled()
    expect(api.updateNoteAt).not.toHaveBeenCalled()
  })

  it('비어 있는 글로 저장해도 같다(글이 없으면 버린다)', async () => {
    const created = vi.fn()
    const api = noteApi()
    const { container } = mountPane({ api, link: link({ openNoteBeside: vi.fn().mockResolvedValue(NOTE_Z) }), onCreated: created })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    act(() => getRoutedMemoDraft()!.save({ text: '  ', html: '' }, undefined, 0))
    expect(created).not.toHaveBeenCalled()
    expect(api.updateNoteAt).not.toHaveBeenCalled()
  })

  it('이미 칠한 곳을 다시 고르면 새로 칠하지 않고 그 메모를 노트에서 보인다', async () => {
    const existing = { ...make('h1', 0), anchor: { ...anchor(0), rects: [{ x: 0, y: 0, w: 612, h: 792 }], charRange: [0, 1000] as const } }
    const workspace = link({ visibleNotePathsFor: () => [NOTE_Z] })
    const api = noteApi({ notesOf: () => [NOTE_Z] })
    const received: DeliveredSignal[] = []
    subscribePointSignal((signal) => received.push(signal))
    const { container } = mountPane({ api, link: workspace, highlights: [existing] })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(received.length).toBeGreaterThan(0))
    expect(getRoutedMemoDraft()).toBeNull()
  })
})

describe('PdfPane — 가리키기 신호', () => {
  const memo = make('h1', 0)
  const full = { ...memo, anchor: { ...memo.anchor, rects: [{ x: 0, y: 0, w: 612, h: 792 }] } }

  it('노트에 든 형광펜을 누르면, 같은 색 창에 노트가 보일 때 이 창의 채널로 메모 신호를 보낸다', async () => {
    const api = noteApi({ notesOf: () => [NOTE_Z] })
    const workspace = link({ visibleNotePathsFor: () => [NOTE_Z] })
    const received: DeliveredSignal[] = []
    subscribePointSignal((signal) => received.push(signal))
    const { container } = mountPane({ api, link: workspace, highlights: [full] })
    clickAt(await selectionLayer(container))
    await waitFor(() => expect(received.length).toBeGreaterThan(0))
    expect(received[0]).toMatchObject({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'h1' }, reason: 'click', origin: 'document' })
    expect(workspace.revealMemo).not.toHaveBeenCalled()
  })

  it('같은 색 창에 보이는 노트가 없으면 그 메모의 노트를 옆에 열고 보인다(revealMemo)', async () => {
    const api = noteApi({ notesOf: () => [NOTE_Z] })
    const workspace = link({ visibleNotePathsFor: () => [] })
    const received: DeliveredSignal[] = []
    subscribePointSignal((signal) => received.push(signal))
    const { container } = mountPane({ api, link: workspace, highlights: [full] })
    clickAt(await selectionLayer(container))
    await waitFor(() => expect(workspace.revealMemo).toHaveBeenCalledWith('left', 'h1'))
    expect(received).toEqual([])
  })

  it('색이 없는 창(채널 없음)에서도 노트를 옆에 열어 보인다', async () => {
    const api = noteApi({ notesOf: () => [NOTE_Z] })
    const workspace = link({ channels: { ...DEFAULT_CHANNELS, left: null }, visibleNotePathsFor: () => [] })
    const { container } = mountPane({ api, link: workspace, highlights: [full] })
    clickAt(await selectionLayer(container))
    await waitFor(() => expect(workspace.revealMemo).toHaveBeenCalledWith('left', 'h1'))
  })

  it('어느 노트에도 없는 형광펜은 노트를 열지 않고 작은 메뉴(색·지우기)를 보인다', async () => {
    const workspace = link()
    const { container } = mountPane({ api: noteApi(), link: workspace, highlights: [full] })
    clickAt(await selectionLayer(container))
    await waitFor(() => expect(document.querySelector('.highlight-popover')).not.toBeNull())
    expect(workspace.revealMemo).not.toHaveBeenCalled()
  })

  it('같은 색 창이 보낸 신호면 그 형광펜으로 굴려 가서 깜빡인다', async () => {
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    const { container } = mountPane({ api: noteApi(), link: link(), highlights: [memo], pane: 'left' })
    await selectionLayer(container)
    act(() => { emitPointSignal({ from: 'right', channel: 'blue', target: { kind: 'memo', memoId: 'h1' }, reason: 'click', origin: 'note' }) })
    await waitFor(() => expect(container.querySelector('.selection-highlight-flash')).not.toBeNull())
    expect(scrollTo).toHaveBeenCalled()
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  })

  it('다른 색이거나 채널이 없는 신호, 자기가 보낸 신호는 받지 않는다', async () => {
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    const { container } = mountPane({ api: noteApi(), link: link({ channels: { ...DEFAULT_CHANNELS, left: 'green' } }), highlights: [memo], pane: 'left' })
    await selectionLayer(container)
    act(() => { emitPointSignal({ from: 'right', channel: 'blue', target: { kind: 'memo', memoId: 'h1' }, reason: 'click' }) })
    act(() => { emitPointSignal({ from: 'right', channel: null, target: { kind: 'memo', memoId: 'h1' }, reason: 'click' }) })
    act(() => { emitPointSignal({ from: 'left', channel: 'green', target: { kind: 'memo', memoId: 'h1' }, reason: 'click' }) })
    expect(container.querySelector('.selection-highlight-flash')).toBeNull()
    expect(scrollTo).not.toHaveBeenCalled()
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
  })
})

describe('PdfPane — 노트 카드에 원문 더하기', () => {
  it('노트 탭이 원문 더하기를 요청한 동안 PDF 에서 고른 글은 새 메모가 아니라 그 카드의 원문이 된다', async () => {
    const created = vi.fn()
    const api = noteApi()
    const workspace = link({ openNoteBeside: vi.fn().mockResolvedValue(NOTE_Z) })
    const { container } = mountPane({ api, link: workspace, onCreated: created })
    setAttachRequest({ path: NOTE_Z, key: 'card-1' })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(api.updateNoteAt).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.updateNoteAt).mock.calls[0]![0]).toBe(NOTE_Z)
    const note = { version: 1, blocks: [{ id: 'card-1', kind: 'memo', highlightId: 'x' }] } as MemoNote
    const next = vi.mocked(api.updateNoteAt).mock.calls[0]![1](note)
    expect(next.blocks[0]).toMatchObject({ id: 'card-1', refs: [expect.any(String)] })
    expect(created).toHaveBeenCalledTimes(1)
    // 요청은 한 번 쓰면 끝나고, 새 메모는 만들지 않는다
    expect(getAttachRequest()).toBeNull()
    expect(getRoutedMemoDraft()).toBeNull()
    expect(workspace.openNoteBeside).not.toHaveBeenCalled()
  })
})
