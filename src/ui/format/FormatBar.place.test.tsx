// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FormatBar } from './FormatBar'
import { getPlace, resetPlacesForTest, setPlace } from './formatBarPlace'

beforeEach(() => resetPlacesForTest())
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const bar = (kind: 'notes' | 'canvas' | 'textbox' = 'notes') => <FormatBar label="서식" hostKind={kind} marks={{ bold: { onToggle: vi.fn() } }} />
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

/** 상단바 도구줄 자리의 모양: 손잡이 자리(.topbar-grip-slot) · 주인 칩 · 서식 줄이 앉는 자리 */
const topBarHost = () => (
  <div className="topbar-toolbar-host" data-testid="host">
    <span className="topbar-grip-slot" data-testid="grip-slot" />
    <span className="topbar-owner-chip" />
    <div className="pane-toolbar topbar-toolbar-slot"><div className="note-format-dock">{bar()}</div></div>
  </div>
)

describe('FormatBar — 상단바에 붙으면 손잡이는 도구 묶음 맨 왼쪽', () => {
  it('붙어 있으면 손잡이가 줄 안이 아니라 손잡이 자리(주인 칩 앞)에 있고 줄의 첫 자식은 묶음이다', () => {
    render(topBarHost())
    const slot = screen.getByTestId('grip-slot')
    expect(within(slot).getByRole('button', { name: '서식바 옮기기' })).toBe(grip())
    expect(screen.getByRole('toolbar', { name: '서식' }).contains(grip())).toBe(false)
    expect(screen.getByRole('toolbar', { name: '서식' }).firstElementChild?.classList.contains('format-bar-cluster')).toBe(true)
    expect(slot.nextElementSibling?.classList.contains('topbar-owner-chip')).toBe(true)
    expect(screen.getAllByRole('button', { name: '서식바 옮기기' })).toHaveLength(1)
  })

  it('가운데 붙음에서도 손잡이는 맨 왼쪽 자리에 남는다', () => {
    setPlace('notes', { mode: 'center' })
    render(topBarHost())
    expect(within(screen.getByTestId('grip-slot')).getByRole('button', { name: '서식바 옮기기' })).toBe(grip())
    expect(screen.getByRole('toolbar', { name: '서식' }).className).toContain('format-bar-center')
  })

  it('손잡이 자리의 손잡이도 같은 동작을 한다: 누를 때 초점을 가져오지 않고, Enter 로 뜨면 손잡이가 줄 안으로 돌아오고 자리는 비며, 다시 Enter 로 붙으면 자리로 간다', () => {
    render(topBarHost())
    expect(fireEvent.pointerDown(grip(), { button: 0 })).toBe(false)
    fireEvent.pointerUp(window)
    fireEvent.keyDown(grip(), { key: 'Enter' })
    expect(getPlace('notes').mode).toBe('float')
    expect(screen.getByTestId('grip-slot').childNodes.length).toBe(0)
    const floating = document.querySelector('.format-bar-float') as HTMLElement
    expect(floating.querySelector('.format-bar')?.firstElementChild).toBe(grip())
    fireEvent.keyDown(grip(), { key: 'Enter' })
    expect(getPlace('notes').mode).toBe('left')
    expect(within(screen.getByTestId('grip-slot')).getByRole('button', { name: '서식바 옮기기' })).toBe(grip())
    expect(document.activeElement).toBe(grip())
  })

  it('끌어 떼면 손잡이가 줄 안으로 돌아온다(손잡이 자리는 비어 폭이 없다)', () => {
    render(topBarHost())
    fireEvent.pointerDown(grip(), { button: 0, clientX: 50, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 300, clientY: 400 })
    expect(screen.getByTestId('grip-slot').childNodes.length).toBe(0)
    expect(document.querySelector('.format-bar-float .format-bar')?.firstElementChild).toBe(grip())
    fireEvent.pointerUp(window, { clientX: 300, clientY: 400 })
  })
})
