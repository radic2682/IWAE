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
    expect(parseWindowMode('?role=extra&vault=D%3A%5CNotes')).toEqual({ role: 'extra', docId: null, page: null, zoom: null, vaultRoot: 'D:\\Notes', session: null, screen: null, screenId: null, client: null })
  })

  it('reads the session an app window is attached to, its screen and its letter', () => {
    const query = windowQuery({ role: 'extra', docId: null, page: null, vaultRoot: 'D:\\Notes', session: '논문 3장', screen: 1, client: 'B' })
    expect(parseWindowMode(`?${query}`)).toMatchObject({ role: 'extra', session: '논문 3장', screen: 1, client: 'B' })
    // 잘못된 값은 버린다
    expect(parseWindowMode('?role=extra&session=&screen=-1&client=bb')).toMatchObject({ session: null, screen: null, client: null })
  })

  it('reads the screen id of a torn-off tab\'s new screen and drops malformed ids', () => {
    const query = windowQuery({ role: 'extra', docId: null, page: null, vaultRoot: null, session: '기본', screenId: 'w7', client: 'C' })
    expect(parseWindowMode(`?${query}`)).toMatchObject({ role: 'extra', session: '기본', screenId: 'w7', client: 'C' })
    expect(parseWindowMode('?role=extra&screenid=a%20b%2Fc')).toMatchObject({ screenId: null })
  })
})

describe('session single writer', () => {
  it('app windows may own a session, detached PDF windows and session-less legacy windows never do', () => {
    expect(ownsSession(MAIN_WINDOW)).toBe(true)
    expect(ownsSession(parseWindowMode('?role=extra&session=a'))).toBe(true)
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

  it('an app window attached to a session starts from that session as saved', () => {
    expect(sessionForWindow(parseWindowMode('?role=extra&session=a'), saved)).toBe(saved)
  })

  it('a session-less legacy window starts without tabs but keeps the saved layout widths', () => {
    const session = sessionForWindow(parseWindowMode('?role=extra'), saved)
    expect(session.pdfTabIds).toEqual([])
    expect(session.panes).toBeUndefined()
    expect(session.sidebarPx).toBe(300)
  })

  it('the main window restores the saved session unchanged', () => {
    expect(sessionForWindow(MAIN_WINDOW, saved)).toBe(saved)
  })
})
