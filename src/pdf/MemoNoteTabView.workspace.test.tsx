// @vitest-environment jsdom
import { useMemo, useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoNoteContext, type MemoNoteApi } from './memoNoteContext'
import { MemoNoteTabView } from './MemoNoteTabView'
import type { MemoNote } from '../core/memoNote'
import type { PersistentPdfHighlight } from './persistentHighlight'
import { PaneIdContext, WorkspaceContext, setRoutedMemoDraft, type RoutedMemoDraft, type WorkspaceLink } from '../app/workspaceContext'
import { DEFAULT_CHANNELS } from '../app/workspaceChannels'
import { emitPointSignal, resetPointSignals, subscribePointSignal, type DeliveredSignal } from '../app/workspaceSignal'

const PATH = '노트/전원.iwnote'
const highlight = (id: string, note: string): PersistentPdfHighlight => ({
  id, color: 'green' as const, note,
  anchor: { docId: 'doc-a', page: 2, coordSpace: 'pdfium-page' as const, rects: [{ x: 1, y: 1, w: 1, h: 1 }], charRange: [0, 1] as const, quote: id, prefix: '', suffix: '' },
}) as PersistentPdfHighlight
const HIGHLIGHTS = [highlight('h1', '첫째'), highlight('h2', '둘째')]
const start = (): MemoNote => ({
  version: 1,
  blocks: [{ id: 's1', kind: 'section', title: '전원부', collapsed: true }, { id: 'm1', kind: 'memo', highlightId: 'h1' }, { id: 'm2', kind: 'memo', highlightId: 'h2' }],
}) as MemoNote

function Harness({ children, pinTab = vi.fn(), pane = 'right' }: { readonly children: ReactNode; readonly pinTab?: (id: string) => void; readonly pane?: 'left' | 'right' }) {
  const [note, setNote] = useState<MemoNote>(start())
  const api = useMemo<MemoNoteApi>(() => ({
    entries: [{ path: PATH, title: '전원' }], openPath: null, openTitle: null, openNote: null, open: vi.fn(), create: vi.fn(), updateOpen: vi.fn(),
    noteAt: (path) => (path === PATH ? note : null),
    updateNoteAt: (path, change) => { if (path === PATH) setNote((current) => change(current)) },
    notesOf: () => [],
  }), [note])
  const link: WorkspaceLink = { channels: DEFAULT_CHANNELS, memoNoteTargetFor: () => null, visibleNotePathsFor: () => [], pinTab, openNoteBeside: vi.fn().mockResolvedValue(null), revealMemo: vi.fn() }
  return (
    <MemoNoteContext.Provider value={api}>
      <WorkspaceContext.Provider value={link}>
        <PaneIdContext.Provider value={pane}>{children}</PaneIdContext.Provider>
      </WorkspaceContext.Provider>
    </MemoNoteContext.Provider>
  )
}

beforeEach(() => {
  resetPointSignals()
  setRoutedMemoDraft(null)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MemoNoteTabView — 가리키기 신호', () => {
  it('같은 색 창이 보낸 메모 신호면 그 카드를 활성으로 하고 접힌 소제목도 펼친다', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { container } = render(<Harness><MemoNoteTabView path={PATH} highlights={HIGHLIGHTS} onJump={vi.fn()} /></Harness>)
    // 접힌 소제목 안의 카드는 아직 없다
    expect(container.querySelector('[data-note-block="m2"]')).toBeNull()
    act(() => { emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'h2' }, reason: 'click', origin: 'document' }) })
    expect(container.querySelector('[data-note-block="m2"]')).not.toBeNull()
    expect(scrollIntoView).toHaveBeenCalled()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('이 노트에 없는 메모의 신호, 다른 색·자기 창의 신호는 무시한다', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(<Harness><MemoNoteTabView path={PATH} highlights={HIGHLIGHTS} onJump={vi.fn()} /></Harness>)
    act(() => { emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'nope' }, reason: 'click' }) })
    act(() => { emitPointSignal({ from: 'left', channel: 'green', target: { kind: 'memo', memoId: 'h1' }, reason: 'click' }) })
    act(() => { emitPointSignal({ from: 'right', channel: 'blue', target: { kind: 'memo', memoId: 'h1' }, reason: 'click' }) })
    expect(scrollIntoView).not.toHaveBeenCalled()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('어느 노트인지 정해진 신호(티켓의 다른 자리)는 그 노트만 받고, 정해진 블록으로 간다', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { container } = render(<Harness><MemoNoteTabView path={PATH} highlights={HIGHLIGHTS} onJump={vi.fn()} /></Harness>)
    act(() => { emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'h1', notePath: '노트/다른.iwnote', blockId: 'm1' }, reason: 'click' }) })
    expect(scrollIntoView).not.toHaveBeenCalled()
    act(() => { emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'h1', notePath: PATH, blockId: 'm2' }, reason: 'click' }) })
    expect(container.querySelector('[data-note-block="m2"]')).not.toBeNull()
    expect(scrollIntoView).toHaveBeenCalled()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('카드를 누르면 이 창의 채널로 메모 신호(노트 화면에서 보냄)를 보낸다', () => {
    const received: DeliveredSignal[] = []
    subscribePointSignal((signal) => received.push(signal))
    const { container } = render(<Harness><MemoNoteTabView path={PATH} highlights={HIGHLIGHTS} onJump={vi.fn()} /></Harness>)
    act(() => { emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'h2' }, reason: 'click' }) })
    received.length = 0
    fireEvent.click(container.querySelector('[data-note-block="m2"]')!)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ from: 'right', channel: 'blue', target: { kind: 'memo', memoId: 'h2' }, origin: 'note' })
  })
})

describe('MemoNoteTabView — 문서 창에서 만드는 새 메모', () => {
  const draftHighlight = { ...highlight('new1', ''), note: undefined } as PersistentPdfHighlight
  const routed = (overrides: Partial<RoutedMemoDraft> = {}): RoutedMemoDraft => ({ highlight: draftHighlight, path: PATH, save: vi.fn(), cancel: vi.fn(), patch: vi.fn(), ...overrides })

  it('이 노트로 오는 새 메모를 새 메모 카드로 그리고 바로 쓰게 하며, 미리보기 탭이면 고정을 알린다', async () => {
    const onEdited = vi.fn()
    const { container } = render(<Harness><MemoNoteTabView path={PATH} highlights={HIGHLIGHTS} onJump={vi.fn()} onEdited={onEdited} /></Harness>)
    expect(container.querySelector('[data-note-block="draft"]')).toBeNull()
    act(() => setRoutedMemoDraft(routed()))
    expect(container.querySelector('[data-note-block="draft"]')).not.toBeNull()
    expect(await screen.findByRole('textbox', { name: '메모' })).toBeTruthy()
    expect(onEdited).toHaveBeenCalled()
  })

  it('다른 노트로 가는 새 메모는 이 노트에 나타나지 않는다', () => {
    const { container } = render(<Harness><MemoNoteTabView path={PATH} highlights={HIGHLIGHTS} onJump={vi.fn()} /></Harness>)
    act(() => setRoutedMemoDraft(routed({ path: '노트/다른.iwnote' })))
    expect(container.querySelector('[data-note-block="draft"]')).toBeNull()
  })

  it('글을 쓰고 포커스를 잃으면 저장을 문서 창에 돌려주고(끼울 자리 포함), 비운 채 잃으면 취소한다', async () => {
    const save = vi.fn()
    const cancel = vi.fn()
    render(<Harness><MemoNoteTabView path={PATH} highlights={HIGHLIGHTS} onJump={vi.fn()} /></Harness>)
    act(() => setRoutedMemoDraft(routed({ save, cancel })))
    const box = await screen.findByRole('textbox', { name: '메모' })
    box.textContent = '새 메모 글'
    fireEvent.input(box)
    fireEvent.blur(box)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0]).toMatchObject({ text: '새 메모 글' })
    expect(typeof save.mock.calls[0]![2]).toBe('number')
    expect(cancel).not.toHaveBeenCalled()
  })

  it('글 없이 비운 채 포커스를 잃으면 취소를 돌려준다(저장하지 않는다)', async () => {
    const save = vi.fn()
    const cancel = vi.fn()
    render(<Harness><MemoNoteTabView path={PATH} highlights={HIGHLIGHTS} onJump={vi.fn()} /></Harness>)
    act(() => setRoutedMemoDraft(routed({ save, cancel })))
    const empty = await screen.findByRole('textbox', { name: '메모' })
    fireEvent.blur(empty)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
  })

  it('고치기 시작하면(저장된 카드의 메모를 고침) 미리보기 탭 고정을 알린다', () => {
    const onEdited = vi.fn()
    const onHighlightUpdated = vi.fn()
    const { container } = render(<Harness><MemoNoteTabView path={PATH} highlights={HIGHLIGHTS} onHighlightUpdated={onHighlightUpdated} onJump={vi.fn()} onEdited={onEdited} /></Harness>)
    act(() => { emitPointSignal({ from: 'left', channel: 'blue', target: { kind: 'memo', memoId: 'h1' }, reason: 'click' }) })
    expect(container.querySelector('[data-note-block="m1"]')).not.toBeNull()
    expect(onEdited).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: '메모 고치기' })[0]!)
    expect(onEdited).toHaveBeenCalled()
  })
})
