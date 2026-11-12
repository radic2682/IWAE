// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Anchor } from '../core/anchor'
import type { MemoNote } from '../core/memoNote'
import { PaneIdContext, WorkspaceContext, getRoutedMemoDraft, setRoutedMemoDraft, type WorkspaceLink } from '../app/workspaceContext'
import { DEFAULT_CHANNELS } from '../app/workspaceChannels'
import { emitPointSignal, resetPointSignals, subscribePointSignal, type DeliveredSignal } from '../app/workspaceSignal'
import { PdfPane } from './PdfPane'
import { resetMemoStore } from './memoStore'
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
  resetMemoStore()
  resetPointSignals()
  setRoutedMemoDraft(null)
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  vi.restoreAllMocks()
})

const noteApi = (overrides: Partial<MemoNoteApi> = {}): MemoNoteApi => ({
  entries: [{ path: NOTE_A, title: 'A' }, { path: NOTE_Z, title: 'Z' }],
  openPath: NOTE_A,
  openTitle: 'A',
  openNote: { version: 1, blocks: [] },
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
  ...overrides,
})

function mountPane(options: { api: MemoNoteApi; link: WorkspaceLink; highlights?: readonly PersistentPdfHighlight[]; onlyOpenNotes?: boolean; onCreated?: (highlight: PersistentPdfHighlight) => void; pane?: 'left' | 'right' }) {
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
      onPersistentHighlightUpdated={vi.fn()}
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

describe('PdfPane — 열린 노트 표시만 보기와 색 채널', () => {
  const open = make('open-note', 0)
  const channelNote = make('channel-note', 200)
  const loose = make('no-note', 400)
  const owners: Record<string, string[]> = { 'open-note': [NOTE_A], 'channel-note': [NOTE_Z] }
  const drawn = async (container: HTMLElement) => {
    await selectionLayer(container)
    return [...container.querySelectorAll('.selection-persistent-highlight')]
  }

  it('같은 색 창에 보이는 노트의 형광펜도 노트 바의 열린 노트와 함께 보인다', async () => {
    const { container } = mountPane({
      api: noteApi({ notesOf: (id) => owners[id] ?? [] }),
      link: link({ visibleNotePathsFor: () => [NOTE_Z] }),
      highlights: [open, channelNote, loose],
      onlyOpenNotes: true,
    })
    expect((await drawn(container)).length).toBe(2)
  })

  it('노트 바에 열린 노트가 없으면 같은 색 창의 노트만 센다', async () => {
    const { container } = mountPane({
      api: noteApi({ openPath: null, openTitle: null, openNote: null, closed: true, notesOf: (id) => owners[id] ?? [] }),
      link: link({ visibleNotePathsFor: () => [NOTE_Z] }),
      highlights: [open, channelNote, loose],
      onlyOpenNotes: true,
    })
    const marks = await drawn(container)
    expect(marks.length).toBe(1)
  })

  it('같은 색 창에 보이는 노트가 없으면(다른 색) 바의 노트만 센다', async () => {
    const { container } = mountPane({
      api: noteApi({ notesOf: (id) => owners[id] ?? [] }),
      link: link({ visibleNotePathsFor: () => [] }),
      highlights: [open, channelNote, loose],
      onlyOpenNotes: true,
    })
    expect((await drawn(container)).length).toBe(1)
  })
})

describe('PdfPane — 새 메모를 같은 색 창의 메모 노트 탭으로', () => {
  it('같은 색 창에 메모 노트 탭이 보이면 새 메모는 노트 바가 아니라 그 노트의 새 메모 카드로 간다', async () => {
    const api = noteApi({ openPath: null, openTitle: null, openNote: null })
    const { container } = mountPane({ api, link: link({ memoNoteTargetFor: () => NOTE_Z }) })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    expect(getRoutedMemoDraft()!.path).toBe(NOTE_Z)
    // 노트 바는 쓰지 않는다: 새 노트를 만들지 않고, 바에는 새 메모 카드가 없다
    expect(api.create).not.toHaveBeenCalled()
    expect(container.querySelector('[data-note-block="draft"]')).toBeNull()
  })

  it('글을 쓰고 저장하면 형광펜을 만들고, 노트 탭이 정한 자리(index)에 그 노트로 메모 블록을 끼운다', async () => {
    const created = vi.fn()
    const api = noteApi({ openPath: null, openTitle: null, openNote: null })
    const { container } = mountPane({ api, link: link({ memoNoteTargetFor: () => NOTE_Z }), onCreated: created })
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
    // 저장하면 초안은 거둔다
    await waitFor(() => expect(getRoutedMemoDraft()).toBeNull())
  })

  it('쓰지 않고 비워 두면(취소) 칠한 것도 함께 버려진다 — 노트에도 저장소에도 아무것도 남지 않는다', async () => {
    const created = vi.fn()
    const api = noteApi({ openPath: null, openTitle: null, openNote: null })
    const { container } = mountPane({ api, link: link({ memoNoteTargetFor: () => NOTE_Z }), onCreated: created })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    act(() => getRoutedMemoDraft()!.cancel())
    await waitFor(() => expect(getRoutedMemoDraft()).toBeNull())
    expect(created).not.toHaveBeenCalled()
    expect(api.updateNoteAt).not.toHaveBeenCalled()
    expect(api.updateOpen).not.toHaveBeenCalled()
  })

  it('비어 있는 글로 저장해도 같다(글이 없으면 버린다)', async () => {
    const created = vi.fn()
    const api = noteApi({ openPath: null, openTitle: null, openNote: null })
    const { container } = mountPane({ api, link: link({ memoNoteTargetFor: () => NOTE_Z }), onCreated: created })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(getRoutedMemoDraft()).not.toBeNull())
    act(() => getRoutedMemoDraft()!.save({ text: '  ', html: '' }, undefined, 0))
    expect(created).not.toHaveBeenCalled()
    expect(api.updateNoteAt).not.toHaveBeenCalled()
  })

  it('같은 색 창에 노트 탭이 안 보이면 예전 그대로 노트 바로 간다(초안은 바 안의 새 메모 카드)', async () => {
    const api = noteApi()
    const { container } = mountPane({ api, link: link({ memoNoteTargetFor: () => null }) })
    dragSelect(await selectionLayer(container))
    await waitFor(() => expect(container.querySelector('[data-note-block="draft"]')).not.toBeNull())
    expect(getRoutedMemoDraft()).toBeNull()
  })
})

describe('PdfPane — 가리키기 신호', () => {
  const memo = make('h1', 0)

  it('형광펜을 누르면 이 창의 채널로 메모 신호를 보낸다(같은 색 창에 노트 탭이 보이면 노트 바는 건드리지 않는다)', async () => {
    const api = noteApi()
    const received: DeliveredSignal[] = []
    subscribePointSignal((signal) => received.push(signal))
    const { container } = mountPane({
      api,
      link: link({ memoNoteTargetFor: () => NOTE_Z }),
      highlights: [{ ...memo, anchor: { ...memo.anchor, rects: [{ x: 0, y: 0, w: 612, h: 792 }] } }],
    })
    const layer = await selectionLayer(container)
    fireEvent.pointerDown(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(layer, { button: 0, clientX: 30, clientY: 30, pointerId: 1 })
    await waitFor(() => expect(received.length).toBeGreaterThan(0))
    expect(received[0]).toMatchObject({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'h1' }, reason: 'click', origin: 'document' })
    expect(api.open).not.toHaveBeenCalled()
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
