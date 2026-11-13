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
  it('한 줄: 형광펜 끝에서 곧게 가다가 카드 가장자리까지 곡선으로 이어지고, 길이는 높이 차를 따라 늘어난다', () => {
    const line = { key: 'k', id: 'h', active: false, side: 'right', target: 'n', distance: 4, crossing: [], startX: 100, y: 120, edgeX: 400, cardX: 440, cardY: 220 } as const
    // 높이 차 100 → 35px 지만 최소 72px: 경계와 카드 사이(40px)가 모자라 32px 일찍 꺾기 시작한다
    expect(linkLinePath(line)).toBe('M 100 120 H 368 C 404 120, 404 220, 440 220')
    // 충분히 벌어진(사이에 다른 칸이 있는) 선은 경계에서 바로 꺾는다
    expect(linkLinePath({ ...line, edgeX: 300, cardX: 620 })).toBe('M 100 120 H 300 C 460 120, 460 220, 620 220')
    // 카드가 아주 멀리(높이 차 1000) 있어도 세로 이동은 가장자리에서 최대 200px 안쪽에서 일어난다
    expect(linkLinePath({ ...line, cardY: 1120 })).toBe('M 100 120 H 240 C 340 120, 340 1120, 440 1120')
    // 형광펜 끝이 경계에 가까우면 형광펜 끝보다 앞에서 꺾지 않는다
    expect(linkLinePath({ ...line, startX: 396 })).toBe('M 396 120 H 396 C 418 120, 418 220, 440 220')
    // 노트가 왼쪽: 같은 식이지만 왼쪽으로 간다
    const left = { key: 'k', id: 'h', active: false, side: 'left', target: 'n', distance: 4, crossing: [], startX: 700, y: 120, edgeX: 404, cardX: 380, cardY: 220 } as const
    expect(linkLinePath(left)).toBe('M 700 120 H 452 C 416 120, 416 220, 380 220')
  })

  it('세로(노트가 위·아래): 형광펜에서 카드의 마주 보는 변까지 수직 S 곡선', () => {
    const down = { key: 'k', id: 'h', active: false, side: 'down', target: 'n', distance: 4, crossing: [], startX: 150, y: 134, edgeX: 150, cardX: 300, cardY: 330 } as const
    expect(linkLinePath(down)).toBe('M 150 134 C 150 232, 300 232, 300 330')
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
    // 선 하나는 path 하나, 점은 형광펜 쪽 하나뿐
    expect(groups[0]!.querySelectorAll('path')).toHaveLength(1)
    expect(groups[0]!.querySelectorAll('circle')).toHaveLength(1)
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
