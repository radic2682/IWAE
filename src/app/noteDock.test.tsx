// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoteDockContext, NOTE_BAR_TRANSITION_MS, useIsNoteHostPane, useNoteBarPresence } from './noteDock'

function Probe({ onHost }: { readonly onHost: (host: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  onHost(useIsNoteHostPane(ref))
  return <div ref={ref} />
}

describe('노트 바 칸', () => {
  afterEach(() => vi.useRealTimers())

  it('노트 바를 그리는 창은 host 로 정한 창 하나뿐이다', () => {
    const seen: Record<string, boolean> = {}
    render(
      <NoteDockContext.Provider value={{ dock: null, hostPane: 'right' }}>
        {(['left', 'right'] as const).map((pane) => (
          <div key={pane} data-pane-id={pane}><Probe onHost={(host) => { seen[pane] = host }} /></div>
        ))}
      </NoteDockContext.Provider>,
    )
    expect(seen).toEqual({ left: false, right: true })
  })

  it('칸이 없는 곳(단독 사용)에서는 늘 host 다', () => {
    let host = false
    render(<Probe onHost={(value) => { host = value }} />)
    expect(host).toBe(true)
  })

  it('닫을 때 전환이 끝날 때까지 그려 두고 exiting 으로 알린다', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ open }) => useNoteBarPresence(open), { initialProps: { open: true } })
    expect(result.current).toEqual({ rendered: true, exiting: false })
    rerender({ open: false })
    expect(result.current).toEqual({ rendered: true, exiting: true })
    act(() => { vi.advanceTimersByTime(NOTE_BAR_TRANSITION_MS + 5) })
    expect(result.current).toEqual({ rendered: false, exiting: false })
    rerender({ open: true })
    expect(result.current.rendered).toBe(true)
  })
})
