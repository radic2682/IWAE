import { describe, expect, it } from 'vitest'
import type { TabsState } from '../app/tabs'
import { captureSession, emptySession, parseSession } from './session'

const pdfTabs: TabsState = {
  tabs: [
    { id: 'doc-a', title: 'A', kind: 'pdf' },
    { id: 'doc-b', title: 'B', kind: 'pdf' },
  ],
  activeId: 'doc-b',
}

const noteTabs: TabsState = {
  tabs: [{ id: 'Specs/Link.canvas', title: 'Link', kind: 'note' }],
  activeId: 'Specs/Link.canvas',
}

const valid = {
  pdfTabIds: ['doc-a', 'doc-b'],
  noteTabIds: ['Specs/Link.canvas'],
  activePdfTabId: 'doc-b',
  activeNoteTabId: 'Specs/Link.canvas',
  sidebarCollapsed: true,
  sidebarPx: 312,
  leftFrac: 0.42,
}

describe('captureSession', () => {
  it('탭 제목을 저장하지 않고 id와 레이아웃만 압축한다', () => {
    expect(captureSession(pdfTabs, noteTabs, {
      sidebarCollapsed: true,
      sidebarPx: 312,
      leftFrac: 0.42,
    })).toEqual({
      ...valid,
      panes: { left: ['doc-a', 'doc-b'], right: ['Specs/Link.canvas'], activeLeft: 'doc-b', activeRight: 'Specs/Link.canvas' },
    })
  })

  it('패널마다 문서·캔버스가 섞여 있어도 종류별 목록과 패널 배치를 함께 남긴다', () => {
    const left: TabsState = {
      tabs: [{ id: 'doc-a', title: 'A', kind: 'pdf' }, { id: 'Specs/Link.canvas', title: 'Link', kind: 'note' }],
      activeId: 'Specs/Link.canvas',
    }
    const right: TabsState = { tabs: [{ id: 'doc-b', title: 'B', kind: 'pdf' }], activeId: 'doc-b' }
    const session = captureSession(left, right, { sidebarCollapsed: false, sidebarPx: 260, leftFrac: 0.5 })
    expect(session.pdfTabIds).toEqual(['doc-a', 'doc-b'])
    expect(session.noteTabIds).toEqual(['Specs/Link.canvas'])
    expect(session.panes).toEqual({ left: ['doc-a', 'Specs/Link.canvas'], right: ['doc-b'], activeLeft: 'Specs/Link.canvas', activeRight: 'doc-b' })
    expect(parseSession(JSON.parse(JSON.stringify(session)))).toEqual(session)
  })
})

describe('parseSession', () => {
  it('정상 입력을 그대로 복원한다', () => {
    expect(parseSession(valid)).toEqual(valid)
  })

  it.each([
    ['빈 객체', {}],
    ['null', null],
    ['필드 일부 누락', { ...valid, activeNoteTabId: undefined }],
    ['문자열이어야 할 배열 항목', { ...valid, pdfTabIds: ['doc-a', 4] }],
    ['잘못된 접힘 값', { ...valid, sidebarCollapsed: 'yes' }],
    ['유한하지 않은 폭', { ...valid, sidebarPx: Number.NaN }],
    ['범위를 벗어난 패널 비율', { ...valid, leftFrac: 2 }],
  ])('%s이면 빈 세션으로 안전하게 떨어진다', (_name, raw) => {
    expect(parseSession(raw)).toEqual(emptySession)
  })
})
