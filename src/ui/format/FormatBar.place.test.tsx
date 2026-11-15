// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FormatBar } from './FormatBar'
import { getPlace, resetPlacesForTest, setPlace } from './formatBarPlace'

beforeEach(() => resetPlacesForTest())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const bar = (kind: 'notes' | 'canvas' | 'textbox' = 'notes') => <FormatBar label="서식" hostKind={kind} marks={{ bold: { onToggle: vi.fn() } }} />
/** 주인 종류를 안 넘긴 줄(앱의 노트 서식 줄과 같다): 놓인 자리를 보고 종류를 알아낸다 */
const detectedBar = () => <FormatBar label="서식" marks={{ bold: { onToggle: vi.fn() } }} />
const grip = () => screen.getByRole('button', { name: '서식바 옮기기' })

describe('FormatBar — 손잡이', () => {
  it('왼쪽 끝에 손잡이가 있고 누를 때 초점을 가져오지 않는다(pointerdown 기본 동작 막기)', () => {
    render(bar())
    const toolbar = screen.getByRole('toolbar', { name: '서식' })
    expect(toolbar.firstElementChild).toBe(grip())
    expect(fireEvent.pointerDown(grip(), { button: 0 })).toBe(false)
    fireEvent.pointerUp(window)
  })

  it('Enter 로 뗐다 붙였다 하고, 떠 있으면 붙이기 단추가 있다', () => {
    render(bar())
    fireEvent.keyDown(grip(), { key: 'Enter' })
    expect(getPlace('notes').mode).toBe('float')
    expect(screen.getByRole('button', { name: '서식바 붙이기' })).toBeDefined()
    fireEvent.keyDown(grip(), { key: ' ' })
    expect(getPlace('notes')).toEqual({ mode: 'left' })
    expect(screen.queryByRole('button', { name: '서식바 붙이기' })).toBeNull()
  })

  it('붙이기 단추 한 번으로 붙는다', () => {
    setPlace('notes', { mode: 'float', x: 100, y: 120 })
    render(bar())
    fireEvent.click(screen.getByRole('button', { name: '서식바 붙이기' }))
    expect(getPlace('notes')).toEqual({ mode: 'left' })
  })

  it('떠 있는 줄은 방향키로 8px 씩 움직이고, 붙어 있을 때 좌우 방향키는 왼쪽 ↔ 가운데', () => {
    setPlace('notes', { mode: 'float', x: 100, y: 120 })
    render(bar())
    // jsdom 은 크기를 0 으로 재므로 창(1024×768) 안에 있는 좌표는 그대로다
    fireEvent.keyDown(grip(), { key: 'ArrowRight' })
    expect(getPlace('notes')).toMatchObject({ mode: 'float', x: 108 })
    fireEvent.keyDown(grip(), { key: 'ArrowUp' })
    expect(getPlace('notes')).toMatchObject({ mode: 'float', y: 112 })
    act(() => setPlace('notes', { mode: 'left' }))
    fireEvent.keyDown(grip(), { key: 'ArrowRight' })
    expect(getPlace('notes')).toEqual({ mode: 'center' })
    expect(screen.getByRole('toolbar', { name: '서식' }).className).toContain('format-bar-center')
  })

  it('자리는 종류별: 캔버스를 띄워도 노트는 그대로', () => {
    setPlace('canvas', { mode: 'float', x: 10, y: 10 })
    render(bar('notes'))
    expect(screen.queryByRole('button', { name: '서식바 붙이기' })).toBeNull()
  })

  it('끌어서 문턱(6px)을 넘기면 뜨고, 놓은 자리가 저장된다', () => {
    render(bar())
    fireEvent.pointerDown(grip(), { button: 0, clientX: 50, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 53, clientY: 22 })
    expect(document.querySelector('.format-bar-float')).toBeNull()
    fireEvent.pointerMove(window, { clientX: 300, clientY: 400 })
    expect(document.querySelector('.format-bar-float')).not.toBeNull()
    fireEvent.pointerUp(window, { clientX: 300, clientY: 400 })
    expect(getPlace('notes').mode).toBe('float')
    expect(document.body.classList.contains('format-bar-dragging')).toBe(false)
  })
})

/** 상단바 도구줄 자리의 모양: 손잡이(상단바가 가진다) · 주인 칩 · 서식 줄이 앉는 자리 */
const topBarHost = (floating = false) => (
  <div className="topbar-toolbar-host" data-testid="host" data-floating={floating ? '' : undefined}>
    <span className="topbar-owner-chip" />
    <div className="pane-toolbar topbar-toolbar-slot"><div className="note-format-dock">{detectedBar()}</div></div>
  </div>
)

describe('FormatBar — 상단바 도구줄 안에서는 손잡이도 자기 자리도 없다(상단바의 묶음 손잡이가 대신한다)', () => {
  it('줄에도 손잡이 자리에도 서식바 손잡이가 없고, 줄의 첫 자식은 묶음이다', () => {
    render(topBarHost())
    expect(screen.queryByRole('button', { name: '서식바 옮기기' })).toBeNull()
    expect(screen.getByRole('toolbar', { name: '서식' }).firstElementChild?.classList.contains('format-bar-cluster')).toBe(true)
  })

  it('도구줄 묶음이 떠 있어도(카드) 줄은 카드 안에서 그냥 묶음을 그린다: 자기 떠 있는 카드도 붙이기 단추도 없다', () => {
    setPlace('toolbar', { mode: 'float', x: 100, y: 100 })
    setPlace('notes', { mode: 'float', x: 10, y: 10 })
    render(topBarHost(true))
    expect(document.querySelector('.format-bar-float')).toBeNull()
    expect(screen.queryByRole('button', { name: '서식바 붙이기' })).toBeNull()
    expect(screen.getByRole('toolbar', { name: '서식' }).className).not.toContain('format-bar-floating')
  })

  it('가운데 붙음 저장값이 있어도 상단바 안에서는 가운데로 가지 않는다', () => {
    setPlace('notes', { mode: 'center' })
    setPlace('toolbar', { mode: 'center' })
    render(topBarHost())
    expect(screen.getByRole('toolbar', { name: '서식' }).className).not.toContain('format-bar-center')
  })

  it('상단바 밖의 같은 줄(종류 notes)은 그대로 손잡이가 있고 뜬다', () => {
    setPlace('toolbar', { mode: 'float', x: 5, y: 5 })
    render(bar('notes'))
    expect(grip()).toBeDefined()
    expect(screen.queryByRole('button', { name: '서식바 붙이기' })).toBeNull()
  })
})
