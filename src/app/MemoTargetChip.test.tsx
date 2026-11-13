// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChannelDot } from './ChannelDot'
import { MemoTargetChip } from './MemoTargetChip'
import { setChannelDragHost } from './channelDrag'
import { paneReactionOf, resetPaneReaction } from './paneReaction'
import { NO_WORKSPACE_LINK, PaneIdContext, WorkspaceContext, type WorkspaceLink } from './workspaceContext'

afterEach(() => {
  cleanup()
  setChannelDragHost(null)
  resetPaneReaction()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const link = (overrides: Partial<WorkspaceLink>): WorkspaceLink => ({ ...NO_WORKSPACE_LINK, ...overrides })

function chip(workspace: WorkspaceLink, pane: string | null = 'doc') {
  return render(
    <WorkspaceContext.Provider value={workspace}>
      <PaneIdContext.Provider value={pane}><MemoTargetChip /></PaneIdContext.Provider>
    </WorkspaceContext.Provider>,
  )
}

describe('MemoTargetChip — 새 메모가 갈 노트', () => {
  it('같은 색 노트 칸이 있으면 「→ 노트 이름」 을 흐리게 보이고 title 은 전체 이름이다', () => {
    chip(link({ memoNoteTargetFor: () => '노트/회의/긴 이름의 노트.iwnote', memoNoteTitleOf: () => '긴 이름의 노트' }))
    const element = document.querySelector<HTMLElement>('[data-memo-target]')!
    expect(element.textContent).toBe('→ 긴 이름의 노트')
    expect(element.getAttribute('title')).toBe('새 메모가 갈 노트: 긴 이름의 노트')
    expect(element.tagName).toBe('BUTTON')
    // 앞 도구와 떨어진 묶음: 구분선이 칩 바로 앞에 온다
    expect(element.previousElementSibling?.classList.contains('pane-toolbar-divider')).toBe(true)
  })

  it('칩을 누르면 그 노트가 있는 칸이 채널 색 윤곽으로 깜빡인다', () => {
    chip(link({
      channels: { doc: 'blue', note: 'blue' },
      memoNoteTargetFor: () => 'A.iwnote',
      memoNoteTargetPaneFor: () => 'note',
    }))
    expect(paneReactionOf('note')).toBeNull()
    fireEvent.click(document.querySelector('[data-memo-target]')!)
    expect(paneReactionOf('note')).toBe('blue')
    expect(paneReactionOf('doc')).toBeNull()
  })

  it('이름 풀이가 없으면 경로 끝 이름을 쓴다', () => {
    chip(link({ memoNoteTargetFor: () => '노트/회의/A.iwnote' }))
    expect(document.querySelector('[data-memo-target]')!.textContent).toBe('→ A')
  })

  it('같은 색 노트 칸이 없으면 아무것도 그리지 않는다', () => {
    chip(link({ memoNoteTargetFor: () => null }))
    expect(document.querySelector('[data-memo-target]')).toBeNull()
  })

  it('칸 틀 밖(칸 이름 없음)에서는 그리지 않는다', () => {
    chip(link({ memoNoteTargetFor: () => 'A.iwnote' }), null)
    expect(document.querySelector('[data-memo-target]')).toBeNull()
  })

  it('칸이 420px 보다 좁으면 숨긴다', () => {
    document.body.innerHTML = '<div class="pane-card" data-card-pane="doc"></div>'
    const card = document.querySelector<HTMLElement>('.pane-card')!
    let width = 320
    vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 400, left: 0, top: 0, right: width, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect)
    const view = render(
      <WorkspaceContext.Provider value={link({ memoNoteTargetFor: () => 'A.iwnote' })}>
        <PaneIdContext.Provider value="doc"><MemoTargetChip /></PaneIdContext.Provider>
      </WorkspaceContext.Provider>,
      { container: card.appendChild(document.createElement('div')) },
    )
    expect(view.container.querySelector('[data-memo-target]')).toBeNull()
    width = 480
    view.unmount()
    render(
      <WorkspaceContext.Provider value={link({ memoNoteTargetFor: () => 'A.iwnote' })}>
        <PaneIdContext.Provider value="doc"><MemoTargetChip /></PaneIdContext.Provider>
      </WorkspaceContext.Provider>,
      { container: card.appendChild(document.createElement('div')) },
    )
    expect(card.querySelector('[data-memo-target]')).not.toBeNull()
  })
})

describe('ChannelDot — 끌기와 클릭', () => {
  it('누름은 머리의 다른 처리로 올라가지 않는다(칸 끌기가 점에서 시작하지 않는다)', () => {
    const head = vi.fn()
    render(<div onPointerDown={head}><ChannelDot channel="blue" onCycle={vi.fn()} pane="a" /></div>)
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, clientX: 5, clientY: 5 })
    expect(head).not.toHaveBeenCalled()
  })

  it('끌지 않고 누르면 그대로 색 바꾸기(클릭)이다, 설명에 끌어서 연결가 있다', () => {
    const onCycle = vi.fn()
    render(<ChannelDot channel="blue" onCycle={onCycle} pane="a" />)
    const dot = screen.getByRole('button')
    expect(dot.getAttribute('title')).toContain('다른 칸으로 끌어서 연결')
    fireEvent.pointerDown(dot, { button: 0, clientX: 5, clientY: 5 })
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 })
    fireEvent.click(dot)
    expect(onCycle).toHaveBeenCalledTimes(1)
  })
})
