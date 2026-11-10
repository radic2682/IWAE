import { describe, expect, it } from 'vitest'
import { MAIN_WINDOW, ownsSession, parseWindowMode, sessionForWindow, windowQuery } from './windowMode'
import { emptySession, type SessionState } from './session'

describe('window mode', () => {
  it('is the main window without parameters', () => {
    expect(parseWindowMode('')).toEqual(MAIN_WINDOW)
    expect(parseWindowMode('?role=bogus')).toEqual(MAIN_WINDOW)
    // 문서 없는 detached 는 의미가 없다
    expect(parseWindowMode('?role=detached')).toEqual(MAIN_WINDOW)
  })

  it('round-trips a detached window with page and zoom', () => {
    const query = windowQuery({ role: 'detached', docId: 'abc123', page: 7, zoom: { fit: null, actual: 125 }, vaultRoot: 'C:\\Vault One' })
    expect(parseWindowMode(`?${query}`)).toEqual({
      role: 'detached',
      docId: 'abc123',
      page: 7,
      zoom: { fit: null, actual: 125 },
      vaultRoot: 'C:\\Vault One',
    })
  })

  it('keeps a fit mode', () => {
    const query = windowQuery({ role: 'detached', docId: 'd', page: 1, zoom: { fit: 'page', actual: 100 }, vaultRoot: null })
    expect(parseWindowMode(`?${query}`).zoom).toEqual({ fit: 'page', actual: 100 })
  })

  it('reads an extra window', () => {
    expect(parseWindowMode('?role=extra&vault=D%3A%5CNotes')).toEqual({ role: 'extra', docId: null, page: null, zoom: null, vaultRoot: 'D:\\Notes' })
  })
})

describe('session single writer', () => {
  it('only the main window owns session.json', () => {
    expect(ownsSession(MAIN_WINDOW)).toBe(true)
    expect(ownsSession(parseWindowMode('?role=detached&doc=a'))).toBe(false)
    expect(ownsSession(parseWindowMode('?role=extra'))).toBe(false)
  })

  const saved: SessionState = {
    ...emptySession,
    pdfTabIds: ['a', 'b'],
    noteTabIds: ['n.canvas'],
    activePdfTabId: 'a',
    activeNoteTabId: 'n.canvas',
    sidebarPx: 300,
    panes: { left: ['a', 'b'], right: ['n.canvas'], activeLeft: 'a', activeRight: 'n.canvas' },
  }

  it('a detached window starts with only its document and no left bar', () => {
    const session = sessionForWindow(parseWindowMode('?role=detached&doc=b'), saved)
    expect(session.pdfTabIds).toEqual(['b'])
    expect(session.activePdfTabId).toBe('b')
    expect(session.noteTabIds).toEqual([])
    expect(session.sidebarCollapsed).toBe(true)
  })

  it('a new window starts without tabs but keeps the saved layout widths', () => {
    const session = sessionForWindow(parseWindowMode('?role=extra'), saved)
    expect(session.pdfTabIds).toEqual([])
    expect(session.panes).toBeUndefined()
    expect(session.sidebarPx).toBe(300)
  })

  it('the main window restores the saved session unchanged', () => {
    expect(sessionForWindow(MAIN_WINDOW, saved)).toBe(saved)
  })
})
