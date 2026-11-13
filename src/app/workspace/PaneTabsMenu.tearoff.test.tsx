// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PaneTabsMenu } from './PaneTabsMenu'
import type { Tab, TabsState } from './tabs'

afterEach(() => { cleanup(); delete (document as { elementFromPoint?: unknown }).elementFromPoint })

const tabs: Tab[] = [
  { id: 'doc', title: 'Paper', kind: 'pdf' },
  { id: 'notes/a.md', title: 'Note A', kind: 'memoNote' },
  { id: 'readme.md', title: 'Readme', kind: 'markdown' },
  { id: 'board', title: 'Board', kind: 'canvas' },
]
const state: TabsState = { tabs, activeId: 'doc' }

/** 탭을 잡아 창 밖(오른쪽 멀리)으로 끌고 나간다 */
function dragOut(title: string, onTearOffTab: (id: string) => Promise<boolean> | boolean): void {
  document.elementFromPoint = () => null
  if (typeof CSS === 'undefined') (globalThis as { CSS?: unknown }).CSS = { escape: (value: string) => value }
  else if (typeof CSS.escape !== 'function') (CSS as { escape?: unknown }).escape = (value: string) => value
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  render(<PaneTabsMenu state={state} label="탭" paneId="p1" onActivate={vi.fn()} onClose={vi.fn()} onTearOffTab={onTearOffTab} />)
  fireEvent.pointerDown(screen.getByRole('tab', { name: new RegExp(title) }), { button: 0, clientX: 40, clientY: 14 })
  fireEvent.pointerMove(window, { clientX: 90, clientY: 16 })
  fireEvent.pointerMove(window, { clientX: window.innerWidth + 200, clientY: 16 })
  fireEvent.pointerUp(window, { clientX: window.innerWidth + 200, clientY: 16 })
}

describe('탭을 창 밖으로 끌어 떼어 내기 — 어떤 탭이 떼어지는가', () => {
  it.each([['Paper', 'doc'], ['Note A', 'notes/a.md'], ['Readme', 'readme.md']])('%s 탭은 떼어 낼 수 있다(PDF · 메모 노트 · Markdown)', (title, id) => {
    const tear = vi.fn((_id: string) => true)
    dragOut(title, tear)
    expect(tear).toHaveBeenCalledTimes(1)
    expect(tear.mock.calls[0]![0]).toBe(id)
  })

  it('캔버스 탭은 아직 떼어 내지 못한다(끌기는 창 안에서만 된다)', () => {
    const tear = vi.fn((_id: string) => true)
    dragOut('Board', tear)
    expect(tear).not.toHaveBeenCalled()
  })
})

describe('창 전체를 끄는 탭(dragWindow) — 떼어 낸 PDF 창 · 노트 · Markdown 앱 창', () => {
  const drag = (only: Tab, dragWindow: boolean, onTearOffTab: (id: string) => boolean) => {
    document.elementFromPoint = () => null
    if (typeof CSS === 'undefined') (globalThis as { CSS?: unknown }).CSS = { escape: (value: string) => value }
    else if (typeof CSS.escape !== 'function') (CSS as { escape?: unknown }).escape = (value: string) => value
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
    render(<PaneTabsMenu state={{ tabs: [only], activeId: only.id }} label="탭" paneId="p1" onActivate={vi.fn()} onClose={vi.fn()} onTearOffTab={onTearOffTab} dragWindow={dragWindow} />)
    fireEvent.pointerDown(screen.getByRole('tab'), { button: 0, clientX: 40, clientY: 14 })
    fireEvent.pointerMove(window, { clientX: 70, clientY: 20 })
  }

  it.each([
    [{ id: 'doc', title: 'Paper', kind: 'pdf' } as Tab],
    [{ id: 'notes/a.md', title: 'Note A', kind: 'memoNote' } as Tab],
    [{ id: 'readme.md', title: 'Readme', kind: 'markdown' } as Tab],
  ])('탭이 하나뿐이면 조금만 움직여도 바로 창이 따라간다 (%o)', (only) => {
    const tear = vi.fn((_id: string) => true)
    drag(only, true, tear)
    expect(tear).toHaveBeenCalledTimes(1)
  })

  it('dragWindow 가 아니면 창 안에서는 떼어 내지 않는다', () => {
    const tear = vi.fn((_id: string) => true)
    drag({ id: 'notes/a.md', title: 'Note A', kind: 'memoNote' }, false, tear)
    expect(tear).not.toHaveBeenCalled()
  })
})
