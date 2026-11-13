// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { WorkspaceLinkLayer, linkLinePath } from './WorkspaceLinkLayer'
import { registerPaneLinks, resetPaneLinks, type LinkItem, type LinkRect, type PaneLinkSnapshot } from './workspaceLinks'

const rect = (left: number, top: number, right: number, bottom: number): LinkRect => ({ left, top, right, bottom })
const snapshot = (frame: LinkRect, items: LinkItem[], activeIds: string[] = []): PaneLinkSnapshot => ({ frame, body: frame, items, activeIds })

beforeEach(() => {
  resetPaneLinks()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WorkspaceLinkLayer', () => {
  it('곡선은 문서 창 경계에서 카드 가장자리로, 점선은 형광펜 끝에서 경계로 간다', () => {
    const line = { key: 'k', id: 'h', active: false, side: 'right', startX: 220, y: 120, edgeX: 400, cardX: 440, cardY: 220 } as const
    expect(linkLinePath(line)).toEqual({
      lead: 'M 220 120 H 400',
      curve: 'M 400 120 C 420 120, 420 220, 440 220',
    })
    // 노트가 왼쪽: 같은 식이지만 왼쪽으로 간다
    const left = { key: 'k', id: 'h', active: false, side: 'left', startX: 500, y: 120, edgeX: 404, cardX: 380, cardY: 220 } as const
    expect(linkLinePath(left).curve).toBe('M 404 120 C 392 120, 392 220, 380 220')
  })

  it('짝이 맺히면 선을 그리고(포인터는 지나간다) 가리키는 선은 활성 클래스를 갖는다', () => {
    const { container } = render(<WorkspaceLinkLayer />)
    const mark = (id: string, y: number): LinkItem => ({ id, color: 'green', rect: rect(100, y, 200, y + 14), y })
    const card = (id: string, y: number): LinkItem => ({ id, rect: rect(420, y - 18, 780, y + 62), y })
    act(() => {
      registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(rect(0, 0, 400, 600), [mark('h1', 100), mark('h2', 200)]))
      registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, () => snapshot(rect(404, 0, 800, 600), [card('h1', 120), card('h2', 220)], ['h2']))
    })
    const svg = container.querySelector('svg.workspace-link-layer')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    const groups = [...svg.querySelectorAll('g.workspace-link')]
    expect(groups.map((group) => group.getAttribute('data-hl'))).toEqual(['green', 'green'])
    expect(groups.map((group) => group.classList.contains('workspace-link-active'))).toEqual([false, true])
    expect(groups[0]!.querySelectorAll('path')).toHaveLength(2)
  })

  it('노트 탭이 닫히면 선이 사라진다', () => {
    const { container } = render(<WorkspaceLinkLayer />)
    let stop: () => void = () => undefined
    act(() => {
      registerPaneLinks({ pane: 'left', role: 'document', channel: 'blue', docId: 'a' }, () => snapshot(rect(0, 0, 400, 600), [{ id: 'h', rect: rect(100, 100, 200, 114), y: 100 }]))
      stop = registerPaneLinks({ pane: 'right', role: 'note', channel: 'blue' }, () => snapshot(rect(404, 0, 800, 600), [{ id: 'h', rect: rect(420, 90, 780, 170), y: 108 }]))
    })
    expect(container.querySelectorAll('g.workspace-link')).toHaveLength(1)
    act(() => stop())
    expect(container.querySelectorAll('g.workspace-link')).toHaveLength(0)
  })
})
