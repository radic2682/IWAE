// @vitest-environment jsdom
import { useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoNoteContext, clearBlockReveal, peekBlockReveal, type MemoNoteApi } from './memoNoteContext'
import { MemoNoteTabView } from './MemoNoteTabView'
import type { MemoNote } from '../core/memoNote'
import type { PersistentPdfHighlight } from './persistentHighlight'
import { PaneIdContext, WorkspaceContext, getAttachRequest, setAttachRequest, setRoutedMemoDraft, type WorkspaceLink } from '../app/workspaceContext'
import { DEFAULT_CHANNELS } from '../app/workspaceChannels'
import { resetPointSignals, subscribePointSignal, type DeliveredSignal } from '../app/workspaceSignal'

const PATH = '노트/전원.iwnote'
const OTHER = '노트/통신.iwnote'

const highlight = (id: string, note: string, quote = id, docId = 'doc-a'): PersistentPdfHighlight => ({
  id, color: 'green' as const, note,
  anchor: { docId, page: 2, coordSpace: 'pdfium-page' as const, rects: [{ x: 1, y: 1, w: 1, h: 1 }], charRange: [0, 1] as const, quote, prefix: '', suffix: '' },
}) as PersistentPdfHighlight
const HIGHLIGHTS = [
  highlight('h1', '켜는 순서 확인', '전원은 순서대로 켠다'),
  highlight('h2', '차단기 메모', '차단기는 마지막'),
  highlight('h3', '통신 속도는 115200', '보율', 'doc-b'),
  highlight('h4', '노트에 없는 순서 메모', '떠돌이', 'doc-b'),
]

const notes: Record<string, MemoNote> = {
  [PATH]: { version: 1, docId: 'doc-a', blocks: [{ id: 'm1', kind: 'memo', highlightId: 'h1' }, { id: 'm2', kind: 'memo', highlightId: 'h2' }] } as MemoNote,
  [OTHER]: { version: 1, blocks: [{ id: 'c1', kind: 'memo', highlightId: 'h3' }] } as MemoNote,
}
const owners: Record<string, string[]> = { h1: [PATH], h2: [PATH], h3: [OTHER] }

interface Spies {
  readonly openInTab: ReturnType<typeof vi.fn>
  readonly createForDoc: ReturnType<typeof vi.fn>
  readonly create: ReturnType<typeof vi.fn>
  readonly trashNote: ReturnType<typeof vi.fn>
  readonly updateNoteAt: Mock<(path: string, change: unknown) => void>
  readonly onJump: ReturnType<typeof vi.fn>
}
const makeSpies = (): Spies => ({
  openInTab: vi.fn(),
  createForDoc: vi.fn().mockResolvedValue('노트/새.iwnote'),
  create: vi.fn().mockResolvedValue('노트/새 노트.iwnote'),
  trashNote: vi.fn().mockResolvedValue(undefined),
  updateNoteAt: vi.fn<(path: string, change: unknown) => void>(),
  onJump: vi.fn(),
})

function Harness({ spies, withLink = true, path = PATH }: { readonly spies: Spies; readonly withLink?: boolean; readonly path?: string }) {
  const [state, setState] = useState<Record<string, MemoNote>>(notes)
  const api = useMemo<MemoNoteApi>(() => ({
    entries: [{ path: PATH, title: '전원', docId: 'doc-a' }, { path: OTHER, title: '통신' }],
    openPath: null,
    openTitle: null,
    openNote: null,
    open: vi.fn(),
    create: spies.create as never,
    updateOpen: vi.fn(),
    noteAt: (target) => state[target] ?? null,
    updateNoteAt: (target, change) => { spies.updateNoteAt(target, change); setState((current) => ({ ...current, [target]: change(current[target]!) })) },
    notesOf: (id) => owners[id] ?? [],
    openInTab: spies.openInTab as never,
    createForDoc: spies.createForDoc as never,
    trashNote: spies.trashNote as never,
    docOwner: (docId) => (docId === 'doc-a' ? 'doc-a' : null),
    docLabel: (docId) => (docId === 'doc-a' ? '전원 설계서' : docId),
    rename: vi.fn(),
  }), [spies, state])
  const link: WorkspaceLink = { channels: DEFAULT_CHANNELS, memoNoteTargetFor: () => null, visibleNotePathsFor: () => [], pinTab: vi.fn(), openNoteBeside: vi.fn().mockResolvedValue(null), revealMemo: vi.fn() }
  const view = (
    <MemoNoteContext.Provider value={api}>
      <MemoNoteTabView path={path} highlights={HIGHLIGHTS} docTitles={{ 'doc-a': '전원 설계서', 'doc-b': '통신 설계서' }} onJump={spies.onJump as never} />
    </MemoNoteContext.Provider>
  )
  return withLink ? (
    <WorkspaceContext.Provider value={link}>
      <PaneIdContext.Provider value="right">{view}</PaneIdContext.Provider>
    </WorkspaceContext.Provider>
  ) : view
}

beforeEach(() => {
  resetPointSignals()
  setRoutedMemoDraft(null)
  setAttachRequest(null)
  clearBlockReveal()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const openSearch = () => {
  fireEvent.click(screen.getByRole('button', { name: '노트 검색' }))
  return screen.getByRole('searchbox', { name: '노트 검색' })
}

describe('MemoNoteTabView — 모든 메모에서 찾기', () => {
  it('검색 칸은 「모든 메모에서 찾기」이고, 이 노트뿐 아니라 다른 노트의 메모와 어느 노트에도 없는 메모도 결과에 나온다', () => {
    render(<Harness spies={makeSpies()} />)
    const input = openSearch()
    expect(input.getAttribute('placeholder')).toBe('모든 메모에서 찾기')
    fireEvent.change(input, { target: { value: '순서' } })
    const list = screen.getByRole('listbox', { name: '노트 검색 결과' })
    const texts = within(list).getAllByRole('option').map((option) => option.textContent)
    // 이 노트의 메모(h1), 어느 노트에도 없는 메모(h4)
    expect(texts.some((text) => text?.includes('켜는 순서 확인'))).toBe(true)
    expect(texts.some((text) => text?.includes('노트에 없는 순서 메모'))).toBe(true)
    // 다른 노트의 메모(h3)는 글에 「통신」이 들어 있어 따로 찾는다
    fireEvent.change(input, { target: { value: '115200' } })
    const other = within(screen.getByRole('listbox', { name: '노트 검색 결과' })).getAllByRole('option')
    expect(other).toHaveLength(1)
    // 어느 노트의 것인지 이름이 붙는다
    expect(other[0]!.textContent).toContain('통신 설계서')
    expect(other[0]!.textContent).toContain('통신')
  })

  it('원문이나 분류에서도 찾고, 없으면 「찾은 메모가 없습니다」', () => {
    render(<Harness spies={makeSpies()} />)
    const input = openSearch()
    fireEvent.change(input, { target: { value: '보율' } })
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(1)
    fireEvent.change(input, { target: { value: '없는말' } })
    expect(screen.getByText('찾은 메모가 없습니다')).toBeTruthy()
  })

  it('이 노트의 메모를 고르면 그 카드를 보이고 같은 색 창이 문서의 그 자리로 가게 신호를 보낸다', () => {
    const received: DeliveredSignal[] = []
    subscribePointSignal((signal) => received.push(signal))
    render(<Harness spies={makeSpies()} />)
    fireEvent.change(openSearch(), { target: { value: '차단기' } })
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option'))
    expect(received[0]).toMatchObject({ from: 'right', channel: 'blue', target: { kind: 'memo', memoId: 'h2' }, origin: 'note' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('다른 노트의 메모를 고르면 그 노트를 탭으로 열고 그 카드를 보이도록 맡긴다', () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.change(openSearch(), { target: { value: '115200' } })
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option'))
    expect(spies.openInTab).toHaveBeenCalledWith(OTHER)
    expect(peekBlockReveal()).toMatchObject({ path: OTHER, blockId: 'c1' })
  })

  it('어느 노트에도 없는 메모를 고르면 문서의 그 자리로 간다(onJump)', () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.change(openSearch(), { target: { value: '떠돌이' } })
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option'))
    expect(spies.onJump).toHaveBeenCalledTimes(1)
    expect(spies.onJump.mock.calls[0]![0]).toMatchObject({ id: 'h4' })
  })
})

describe('MemoNoteTabView — 노트 열기 메뉴(노트 바꾸기)', () => {
  const titleButton = () => screen.getByRole('button', { name: /노트 바꾸기: 전원/ })

  it('도구줄에 노트 이름이 보이고, 누르면 「노트 열기」 목록이 열려 다른 노트를 탭으로 연다', () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(titleButton())
    const menu = screen.getByRole('menu', { name: '노트 열기' })
    expect(within(menu).getByRole('menuitemradio', { name: '전원' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: '통신' }))
    expect(spies.openInTab).toHaveBeenCalledWith(OTHER)
    expect(screen.queryByRole('menu', { name: '노트 열기' })).toBeNull()
  })

  it('문서에 속한 노트에서는 「이 PDF에 노트 만들기」가 그 PDF 의 새 노트를 만들어 탭으로 연다', async () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(titleButton())
    fireEvent.click(screen.getByRole('menuitem', { name: '이 PDF에 노트 만들기' }))
    await waitFor(() => expect(spies.openInTab).toHaveBeenCalledWith('노트/새.iwnote'))
    expect(spies.createForDoc).toHaveBeenCalledWith('doc-a')
  })

  it('일반 노트에서는 「새 노트 만들기」가 새 노트를 만들어 탭으로 연다', async () => {
    const spies = makeSpies()
    render(<Harness spies={spies} path={OTHER} />)
    fireEvent.click(screen.getByRole('button', { name: /노트 바꾸기: 통신/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '새 노트 만들기' }))
    await waitFor(() => expect(spies.openInTab).toHaveBeenCalledWith('노트/새 노트.iwnote'))
  })

  it('「이 노트 휴지통으로 이동…」은 확인 창(취소에 초점)을 거쳐 이 노트를 옮긴다', async () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(titleButton())
    fireEvent.click(within(screen.getByRole('menu', { name: '노트 열기' })).getByRole('menuitem', { name: '이 노트 휴지통으로 이동…' }))
    const dialog = await screen.findByRole('dialog', { name: '노트 삭제' })
    expect(within(dialog).getByText('‘전원’ 노트를 휴지통으로 옮길까요?')).toBeDefined()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '취소' }))
    expect(spies.trashNote).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '휴지통으로 이동' }))
    await waitFor(() => expect(spies.trashNote).toHaveBeenCalledWith(PATH, 'note-tab-confirmed'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('취소하면 옮기지 않는다', async () => {
    const spies = makeSpies()
    render(<Harness spies={spies} />)
    fireEvent.click(titleButton())
    fireEvent.click(within(screen.getByRole('menu', { name: '노트 열기' })).getByRole('menuitem', { name: '이 노트 휴지통으로 이동…' }))
    fireEvent.click(await screen.findByRole('button', { name: '취소' }))
    expect(spies.trashNote).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('MemoNoteTabView — 원문 더하기', () => {
  it('카드 메뉴의 「원문 더하기」는 문서 창에 요청을 남기고, 「그만두기」나 Esc 로 거둔다', () => {
    const { container } = render(<Harness spies={makeSpies()} />)
    fireEvent.contextMenu(container.querySelector('[data-note-block="m1"]')!)
    fireEvent.click(screen.getByRole('menuitem', { name: /원문 더하기/ }))
    expect(getAttachRequest()).toEqual({ path: PATH, key: 'm1' })
    // 더하는 중인 카드에는 그만두기 단추가 보인다
    fireEvent.click(screen.getByRole('button', { name: '그만두기' }))
    expect(getAttachRequest()).toBeNull()
    fireEvent.contextMenu(container.querySelector('[data-note-block="m2"]')!)
    fireEvent.click(screen.getByRole('menuitem', { name: /원문 더하기/ }))
    expect(getAttachRequest()).toEqual({ path: PATH, key: 'm2' })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(getAttachRequest()).toBeNull()
  })

  it('다른 노트가 요청한 원문 더하기에는 반응하지 않는다', () => {
    setAttachRequest({ path: OTHER, key: 'c1' })
    render(<Harness spies={makeSpies()} />)
    expect(screen.queryByRole('button', { name: '그만두기' })).toBeNull()
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    // 이 노트의 요청이 아니므로 Esc 도 건드리지 않는다
    expect(getAttachRequest()).toEqual({ path: OTHER, key: 'c1' })
  })
})

describe('MemoNoteTabView — 확대·카드 신호', () => {
  it('카드 목록 모양에서는 Ctrl+휠이 바 배율(--bar-zoom)을 따른다', () => {
    const { container } = render(<Harness spies={makeSpies()} withLink={false} />)
    const section = container.querySelector('.memo-note-tab-bar') as HTMLElement
    expect(section.style.getPropertyValue('--bar-zoom')).not.toBe('')
  })

  it('메모 카드를 누르면 같은 색 창으로 신호를 보낸다', () => {
    const received: DeliveredSignal[] = []
    subscribePointSignal((signal) => received.push(signal))
    const { container } = render(<Harness spies={makeSpies()} />)
    fireEvent.click(container.querySelector('[data-memo-id="h1"]')!)
    expect(received[0]).toMatchObject({ from: 'right', channel: 'blue', target: { kind: 'memo', memoId: 'h1' }, origin: 'note' })
  })
})
