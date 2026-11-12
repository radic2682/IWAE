// @vitest-environment jsdom
import { useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoNoteContext, type MemoNoteApi } from './memoNoteContext'
import { MemoNoteTabView, MEMO_NOTE_WIDE_MIN } from './MemoNoteTabView'
import type { MemoNote } from '../core/memoNote'
import type { PersistentPdfHighlight, PersistentPdfHighlightPatch } from './persistentHighlight'

const PATH = '노트/전원.iwnote'

const highlight = (id: string, quote: string, note: string): PersistentPdfHighlight => ({
  id, color: 'green' as const, note,
  anchor: { docId: 'doc-a', page: 2, coordSpace: 'pdfium-page' as const, rects: [{ x: 1, y: 1, w: 1, h: 1 }], charRange: [0, 1] as const, quote, prefix: '', suffix: '' },
}) as PersistentPdfHighlight
const HIGHLIGHTS = [highlight('h1', '전원은 순서대로 켠다', '켜는 순서 확인'), highlight('h2', '차단기는 마지막', '차단기 메모')]

const initialNote = (): MemoNote => ({
  version: 1,
  blocks: [
    { id: 's1', kind: 'section', title: '전원부' },
    { id: 'm1', kind: 'memo', highlightId: 'h1' },
    { id: 'm2', kind: 'memo', highlightId: 'h2' },
  ],
}) as MemoNote

type Change = (note: MemoNote) => MemoNote
interface Spies {
  readonly updateNoteAt: Mock<(path: string, change: Change) => void>
  readonly updateOpen: Mock<(change: Change) => void>
  readonly onHighlightUpdated: Mock<(id: string, patch: PersistentPdfHighlightPatch) => void>
  readonly onJump: Mock<(highlight: PersistentPdfHighlight) => void>
}

function Harness({ spies, openPath = null, start = initialNote() }: { readonly spies: Spies; readonly openPath?: string | null; readonly start?: MemoNote }) {
  // 하나의 저장소를 흉내 낸다: noteAt 이 읽고 updateNoteAt 이 쓴다
  const [note, setNote] = useState<MemoNote>(start)
  const api = useMemo<MemoNoteApi>(() => ({
    entries: [{ path: PATH, title: '전원' }],
    openPath,
    openTitle: openPath === null ? null : '전원',
    openNote: openPath === null ? null : note,
    open: vi.fn(),
    create: vi.fn(),
    updateOpen: (change) => { spies.updateOpen(change); setNote((current) => change(current)) },
    noteAt: (path) => (path === PATH ? note : null),
    updateNoteAt: (path, change) => { spies.updateNoteAt(path, change); if (path === PATH) setNote((current) => change(current)) },
    notesOf: () => [],
  }), [note, openPath, spies])
  return (
    <MemoNoteContext.Provider value={api}>
      <MemoNoteTabView
        path={PATH}
        highlights={HIGHLIGHTS}
        docTitles={{ 'doc-a': '전원 설계서 · 2026' }}
        onHighlightUpdated={spies.onHighlightUpdated}
        onJump={spies.onJump}
      />
    </MemoNoteContext.Provider>
  )
}

const makeSpies = (): Spies => ({ updateNoteAt: vi.fn<(path: string, change: Change) => void>(), updateOpen: vi.fn<(change: Change) => void>(), onHighlightUpdated: vi.fn<(id: string, patch: PersistentPdfHighlightPatch) => void>(), onJump: vi.fn<(highlight: PersistentPdfHighlight) => void>() })

// 폭은 시험이 정한다(jsdom 은 레이아웃이 없다)
const size = { width: 380 }
const observers: Array<(entries: unknown[]) => void> = []
const resizeTo = (width: number) => {
  size.width = width
  act(() => { for (const callback of observers) callback([{ contentRect: { width } }]) })
}

beforeEach(() => {
  size.width = 380
  observers.length = 0
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    return { x: 0, y: 0, top: 0, left: 0, right: size.width, bottom: 0, width: size.width, height: 0, toJSON: () => ({}) } as DOMRect
  })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: (entries: unknown[]) => void) { observers.push(callback) }
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MemoNoteTabView', () => {
  it('노트의 소제목과 메모 카드(메모 글)를 보인다 — 노트 바 없이 노트만', () => {
    render(<Harness spies={makeSpies()} />)
    expect(screen.getByText('전원부')).toBeTruthy()
    expect(screen.getByText('켜는 순서 확인')).toBeTruthy()
    expect(screen.getByText('차단기 메모')).toBeTruthy()
    // 좁을 때는 원문이 한 줄 출처 칩으로 접혀 있다
    expect(screen.getAllByTitle('원문에서 보기').length).toBe(2)
  })

  it('메모 글을 고치면 형광펜 저장소 콜백(노트 바와 같은 길)으로 저장한다', () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(screen.getAllByRole('button', { name: '메모 고치기' })[0]!)
    const box = screen.getByRole('textbox', { name: '메모' })
    box.textContent = '켜는 순서를 바꿨다'
    fireEvent.input(box)
    fireEvent.blur(box)
    expect(spies.onHighlightUpdated).toHaveBeenCalledWith('h1', { note: '켜는 순서를 바꿨다', noteHtml: '' })
  })

  it('원문(출처 칩)을 누르면 그 메모의 문서로 가는 콜백을 부른다', () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(screen.getAllByTitle('원문에서 보기')[1]!)
    expect(spies.onJump).toHaveBeenCalledTimes(1)
    expect(spies.onJump.mock.calls[0]![0]).toMatchObject({ id: 'h2' })
  })

  it('「글 블록 넣기」는 이 노트(updateNoteAt)에 글 블록을 더하고 바로 쓰게 한다', () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(screen.getByRole('button', { name: '글 블록 넣기' }))
    expect(spies.updateNoteAt).toHaveBeenCalledTimes(1)
    expect(spies.updateNoteAt.mock.calls[0]![0]).toBe(PATH)
    expect(spies.updateOpen).not.toHaveBeenCalled()
    const editor = screen.getByRole('textbox', { name: '글' })
    editor.textContent = '새 글'
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(screen.getByText('새 글')).toBeTruthy()
  })

  it('노트 바가 같은 노트를 열고 있으면 같은 저장소의 열린 노트(updateOpen)로 고친다', () => {
    const spies = makeSpies()
    render(<Harness spies={spies} openPath={PATH} />)
    fireEvent.click(screen.getByRole('button', { name: '글 블록 넣기' }))
    expect(spies.updateOpen).toHaveBeenCalledTimes(1)
    expect(spies.updateNoteAt).not.toHaveBeenCalled()
  })

  it('폭에 따라 모양이 바뀐다: 좁으면 카드 목록, 460px 이상이면 문서처럼(모드 스위치 없이)', () => {
    const { container } = render(<Harness spies={makeSpies()} />)
    const root = container.querySelector('.memo-note-tab')!
    expect(MEMO_NOTE_WIDE_MIN).toBe(460)
    expect(root.getAttribute('data-layout')).toBe('narrow')
    expect(container.querySelector('.note-wide')).toBeNull()
    expect(screen.getAllByTitle('원문에서 보기').length).toBe(2)

    resizeTo(MEMO_NOTE_WIDE_MIN - 1)
    expect(root.getAttribute('data-layout')).toBe('narrow')

    resizeTo(MEMO_NOTE_WIDE_MIN)
    expect(root.getAttribute('data-layout')).toBe('wide')
    expect(root.className).toContain('memo-note-tab-wide')
    expect(container.querySelector('.markdown-memo-bar-body.note-wide')).not.toBeNull()
    // 문서처럼 읽히는 폭에서는 원문을 모두 펼친다
    expect(screen.getByText('전원은 순서대로 켠다')).toBeTruthy()

    resizeTo(300)
    expect(root.getAttribute('data-layout')).toBe('narrow')
    expect(container.querySelector('.note-wide')).toBeNull()
  })

  it('처음부터 넓은 창이면 바로 문서처럼 보인다', () => {
    size.width = 900
    const { container } = render(<Harness spies={makeSpies()} />)
    expect(container.querySelector('.memo-note-tab')!.getAttribute('data-layout')).toBe('wide')
  })

  it('노트를 찾을 수 없으면(지워진 노트) 안내만 보이고 아무것도 쓰지 않는다', () => {
    const spies = makeSpies()
    const Missing = () => (
      <MemoNoteContext.Provider value={{ entries: [], openPath: null, openTitle: null, openNote: null, open: vi.fn(), create: vi.fn(), updateOpen: vi.fn(), noteAt: () => null, updateNoteAt: spies.updateNoteAt, notesOf: () => [] }}>
        <MemoNoteTabView path={PATH} highlights={HIGHLIGHTS} onJump={spies.onJump} />
      </MemoNoteContext.Provider>
    )
    render(<Missing />)
    expect(screen.getByText('노트를 불러올 수 없습니다')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '글 블록 넣기' })).toBeNull()
  })

  it('검색어를 쓰면 맞지 않는 카드는 흐려진다(이 노트 안에서만)', () => {
    const { container } = render(<Harness spies={makeSpies()} />)
    fireEvent.click(screen.getByRole('button', { name: '노트 검색' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '노트 검색' }), { target: { value: '차단기' } })
    expect(container.querySelectorAll('.pdf-memo-card-dim').length).toBeGreaterThan(0)
  })
})
