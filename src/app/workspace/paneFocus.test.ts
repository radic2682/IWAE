// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { focusPaneMain, paneMainFocusTarget } from './paneFocus'

afterEach(() => { document.body.innerHTML = '' })

const card = (id: string, body: string) => `<div data-card-pane="${id}"><div class="pane-head"><button class="pane-top-tab-title" role="tab" aria-selected="true">탭</button></div><div class="pane-grid-body">${body}</div></div>`

describe('pane main focus target', () => {
  it('본문의 초점 자리가 먼저, 없으면 고른 탭이다', () => {
    document.body.innerHTML = card('p1', '<div class="pdf-pane" tabindex="0"></div>') + card('p2', '<div class="empty"></div>')
    expect(paneMainFocusTarget('p1')?.className).toBe('pdf-pane')
    expect(paneMainFocusTarget('p2')?.className).toBe('pane-top-tab-title')
    expect(paneMainFocusTarget('p9')).toBeNull()
  })

  it('캔버스 안의 요소는 고르지 않는다', () => {
    document.body.innerHTML = card('p1', '<div class="react-flow"><div class="react-flow__node" tabindex="0"></div></div>')
    expect(paneMainFocusTarget('p1')?.className).toBe('pane-top-tab-title')
  })

  it('초점을 옮기고, 이미 그 칸 안에 있으면 건드리지 않는다', () => {
    document.body.innerHTML = card('p1', '<div class="pdf-pane" tabindex="0"></div>') + card('p2', '<input id="x" />')
    expect(focusPaneMain('p1')).toBe(true)
    expect(document.activeElement?.className).toBe('pdf-pane')
    const input = document.getElementById('x') as HTMLInputElement
    input.focus()
    expect(focusPaneMain('p2')).toBe(false)
    expect(document.activeElement).toBe(input)
  })
})
