// @vitest-environment jsdom
import { useMemo, useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { MemoNoteContext, type MemoNoteApi } from './memoNoteContext'
import { MemoNoteTabView } from './MemoNoteTabView'
import type { MemoNote } from '../core/memoNote'
import type { PersistentPdfHighlight } from './persistentHighlight'
import { PaneIdContext, WorkspaceContext, setRoutedMemoDraft, type WorkspaceLink } from '../app/workspaceContext'
import { DEFAULT_CHANNELS } from '../app/workspaceChannels'
import { resetPointSignals, subscribePointSignal, type DeliveredSignal } from '../app/workspaceSignal'
import {
  currentLinkPairs,
  flushPaneLinks,
  getLinkLayerState,
  registerPaneLinks,
  resetPaneLinks,
  usePaneLinkedToNote,
  type LinkItem,
  type PaneLinkSnapshot,
} from '../app/workspaceLinks'

const PATH = '노트/전원.iwnote'
const highlight = (id: string, docId = 'doc-a', page = 2): PersistentPdfHighlight => ({
  id, color: 'green' as const, note: id,
  anchor: { docId, page, coordSpace: 'pdfium-page' as const, rects: [{ x: 1, y: 1, w: 1, h: 1 }], charRange: [0, 1] as const, quote: id, prefix: '', suffix: '' },
}) as PersistentPdfHighlight

function Harness({ children, count, channel = 'blue' }: { readonly children: ReactNode; readonly count: number; readonly channel?: 'blue' | 'green' | null }) {
  const [note, setNote] = useState<MemoNote>(() => ({
    version: 1,
    blocks: Array.from({ length: count }, (_, index) => ({ id: `m${index}`, kind: 'memo', highlightId: `h${index}` })),
  }) as MemoNote)
  const api = useMemo<MemoNoteApi>(() => ({
    entries: [{ path: PATH, title: '전원' }], openPath: null, openTitle: null, openNote: null, open: vi.fn(), create: vi.fn(), updateOpen: vi.fn(),
    noteAt: (path) => (path === PATH ? note : null),
    updateNoteAt: (path, change) => { if (path === PATH) setNote((current) => change(current)) },
    notesOf: () => [],
  }), [note])
  const link: WorkspaceLink = { channels: { ...DEFAULT_CHANNELS, right: channel }, memoNoteTargetFor: () => null, visibleNotePathsFor: () => [], pinTab: vi.fn() }
  return (
    <MemoNoteContext.Provider value={api}>
      <WorkspaceContext.Provider value={link}>
        <PaneIdContext.Provider value="right">{children}</PaneIdContext.Provider>
      </WorkspaceContext.Provider>
    </MemoNoteContext.Provider>
  )
}

const ZERO = { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect
const box = (left: number, top: number, right: number, bottom: number): DOMRect => ({ ...ZERO, x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top })
let cardReads = 0
const original = Element.prototype.getBoundingClientRect

/** 노트 창은 오른쪽 칸(404~800 × 0~600), 스크롤 몸통은 위 300px 만 보이고 카드는 100px 간격 */
function stubLayout(): void {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this instanceof HTMLElement) {
      if (this.dataset.memoNoteTab !== undefined) return box(404, 0, 800, 600)
      if (this.classList.contains('pdf-memo-bar-scroll')) return box(404, 0, 800, 300)
      const id = this.dataset.memoId
      if (id !== undefined) {
        cardReads += 1
        const index = Number(id.slice(1))
        return box(420, index * 100, 780, index * 100 + 90)
      }
    }
    return ZERO
  }
}

const docSnapshot = (items: LinkItem[]): PaneLinkSnapshot => ({ frame: box(0, 0, 400, 600), body: box(0, 0, 400, 600), items, activeIds: [] })
const mark = (id: string, y: number): LinkItem => ({ id, color: 'green', rect: box(100, y, 200, y + 14), y })

beforeEach(() => {
  resetPointSignals()
  resetPaneLinks()
  setRoutedMemoDraft(null)
  cardReads = 0
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  stubLayout()
})
afterEach(() => {
  cleanup()
  Element.prototype.getBoundingClientRect = original
  vi.unstubAllGlobals()
})

describe('MemoNoteTabView — 「→ 문서」 링크', () => {
  const highlights = [highlight('h0'), highlight('h1', 'doc-b', 4)]
  const docTitles = { 'doc-a': '전원 설계 · 2026', 'doc-b': '부록 B' }

  it('원문 문서가 이웃한 같은 색 창에 보이지 않으면 카드마다 「→ 문서 이름 p.N」 을 보인다', () => {
    const { container } = render(<Harness count={2}><MemoNoteTabView path={PATH} highlights={highlights} docTitles={docTitles} onJump={vi.fn()} /></Harness>)
    const links = [...container.querySelectorAll<HTMLElement>('.note-far-link')]
    expect(links.map((link) => link.dataset.farMemo)).toEqual(['h0', 'h1'])
    expect(links[0]!.textContent).toContain('전원 설계')
    expect(links[0]!.textContent).toContain('p.3')
    expect(links[1]!.textContent).toContain('부록 B')
    expect(links[1]!.textContent).toContain('p.5')
  })

  it('원문 문서가 이웃한 같은 색 문서 창에 보이면 그 카드에는 링크를 달지 않는다(선이 대신 잇는다)', () => {
    const { container } = render(<Harness count={2}><MemoNoteTabView path={PATH} highlights={highlights} docTitles={docTitles} onJump={vi.fn()} /></Harness>)
    act(() => {
      registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'doc-a' }, () => docSnapshot([mark('h0', 20)]))
    })
    expect(currentLinkPairs()).toHaveLength(1)
    expect([...container.querySelectorAll<HTMLElement>('.note-far-link')].map((link) => link.dataset.farMemo)).toEqual(['h1'])
    expect(getLinkLayerState().lines.map((line) => line.id)).toEqual(['h0'])
  })

  it('채널이 없는 창에서는 링크를 달지 않는다(눌러도 받는 창이 없다)', () => {
    const { container } = render(<Harness count={2} channel={null}><MemoNoteTabView path={PATH} highlights={highlights} docTitles={docTitles} onJump={vi.fn()} /></Harness>)
    expect(container.querySelector('.note-far-link')).toBeNull()
  })

  it('링크를 누르면 이 창의 채널로 메모 신호(노트 화면에서 보냄)를 보낸다', () => {
    const received: DeliveredSignal[] = []
    subscribePointSignal((signal) => received.push(signal))
    const { container } = render(<Harness count={2}><MemoNoteTabView path={PATH} highlights={highlights} docTitles={docTitles} onJump={vi.fn()} /></Harness>)
    fireEvent.click(container.querySelector<HTMLElement>('[data-far-memo="h1"]')!)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ from: 'right', channel: 'blue', target: { kind: 'memo', memoId: 'h1' }, origin: 'note' })
  })
})

describe('MemoNoteTabView — 연결선 재료 내놓기', () => {
  it('노트 탭이 보이는 동안 등록되고, 탭이 바뀌어(언마운트) 사라지면 거둔다', () => {
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'doc-a' }, () => docSnapshot([mark('h0', 20)]))
    const { unmount } = render(<Harness count={2}><MemoNoteTabView path={PATH} highlights={[highlight('h0'), highlight('h1')]} onJump={vi.fn()} /></Harness>)
    expect(currentLinkPairs()).toEqual([{ doc: 'left', note: 'right', noteSide: 'right', docId: 'doc-a' }])
    unmount()
    expect(currentLinkPairs()).toEqual([])
    expect(getLinkLayerState().lines).toEqual([])
  })

  it('카드가 1,000 장이어도 보이는 카드(몸통 300px 안)만 내놓고, 읽는 카드 사각형도 몇 개뿐이다', () => {
    const highlights = Array.from({ length: 1000 }, (_, index) => highlight(`h${index}`))
    // 문서 쪽은 1,000 개 형광펜이 모두 몸통 세로 안에 걸쳐 있다고 해도(최악) 선은 보이는 카드 몫만 나온다
    const marks = Array.from({ length: 1000 }, (_, index) => mark(`h${index}`, 10 + (index % 500)))
    registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'doc-a' }, () => docSnapshot(marks))
    render(<Harness count={1000}><MemoNoteTabView path={PATH} highlights={highlights} onJump={vi.fn()} /></Harness>)
    expect(currentLinkPairs()).toHaveLength(1)
    expect(getLinkLayerState().lines.length).toBeLessThanOrEqual(4)
    expect(getLinkLayerState().lines.length).toBeGreaterThanOrEqual(3)
    cardReads = 0
    act(() => flushPaneLinks())
    // 카드 수가 아니라 보이는 몇 장에 비례한다(1,000 장을 모두 재지 않는다)
    expect(cardReads).toBeLessThan(40)
  }, 30000)
})

describe('legacy 노트 바 선 끄기 규칙 — usePaneLinkedToNote', () => {
  const noteSnapshot = (): PaneLinkSnapshot => ({ frame: box(404, 0, 800, 600), body: box(404, 0, 800, 600), items: [], activeIds: [] })
  const docFrame = () => docSnapshot([])

  it('이웃한 같은 색 메모 노트 창이 보이면 그 문서 창은 이어진 것(옛 선을 그리지 않는다)', () => {
    const { result } = renderHook(() => usePaneLinkedToNote('left'))
    expect(result.current).toBe(false)
    act(() => {
      registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, docFrame)
      registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, noteSnapshot)
    })
    expect(result.current).toBe(true)
  })

  it('노트 탭이 닫히면 다시 옛 선을 그린다', () => {
    const { result } = renderHook(() => usePaneLinkedToNote('left'))
    let stop: () => void = () => undefined
    act(() => {
      registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, docFrame)
      stop = registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, noteSnapshot)
    })
    expect(result.current).toBe(true)
    act(() => stop())
    expect(result.current).toBe(false)
  })

  it('채널이 다르거나 이웃하지 않은 노트 창, 노트가 없는 경우에는 옛 선을 그대로 둔다', () => {
    const { result } = renderHook(() => usePaneLinkedToNote('left'))
    act(() => {
      registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, docFrame)
      registerPaneLinks({ pane: 'right', role: 'note', channel: 'green' }, noteSnapshot)
    })
    expect(result.current).toBe(false)
    act(() => {
      registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, () => ({ frame: box(1000, 0, 1400, 600), body: box(1000, 0, 1400, 600), items: [], activeIds: [] }))
    })
    expect(result.current).toBe(false)
  })

  it('창 이름이 없는 곳(시험·단독)은 늘 옛 선', () => {
    const { result } = renderHook(() => usePaneLinkedToNote(null))
    expect(result.current).toBe(false)
  })
})
