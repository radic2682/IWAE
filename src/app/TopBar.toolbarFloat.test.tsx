// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TopBar } from './TopBar'
import type { ToolbarOwner } from './topBarToolbar'
import { dockZoneOf } from './toolbarFloat'
import { floatingExtraWidth } from '../ui/format/floatingToolbar'
import { getPlace, resetPlacesForTest, setPlace } from '../ui/format/formatBarPlace'

const props = { sidebarCollapsed: false, onToggleSidebar: vi.fn(), sidebarMode: 'library' as const, onSidebarModeChange: vi.fn(), sidebarPx: 240 }
const pdf: ToolbarOwner = { channel: 'blue', number: 0, kind: 'pdf' }
const markdown: ToolbarOwner = { channel: 'green', number: 1, kind: 'markdown' }
const note: ToolbarOwner = { channel: 'blue', number: 2, kind: 'memoNote' }

beforeEach(() => {
  localStorage.clear()
  resetPlacesForTest()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const host = (container: HTMLElement) => container.querySelector('.topbar-toolbar-host') as HTMLElement
const placeholder = (container: HTMLElement) => container.querySelector('.topbar-toolbar-placeholder') as HTMLElement | null
const grip = () => screen.getByRole('button', { name: '도구줄 옮기기' })

describe('TopBar — 도구줄 묶음 손잡이(PDF · Markdown · 노트가 하나를 같이 쓴다)', () => {
  it('주인이 있으면 묶음 맨 왼쪽(주인 칩 앞)에 손잡이가 하나 있다. 주인이 없으면 손잡이도 없다', () => {
    const { container, rerender } = render(<TopBar {...props} toolbarOwner={pdf} />)
    const chip = container.querySelector('.topbar-owner-chip') as HTMLElement
    expect(host(container).firstElementChild).toBe(grip())
    expect(grip().nextElementSibling).toBe(chip)
    expect(screen.getAllByRole('button', { name: '도구줄 옮기기' })).toHaveLength(1)
    rerender(<TopBar {...props} toolbarOwner={note} />)
    expect(screen.getAllByRole('button', { name: '도구줄 옮기기' })).toHaveLength(1)
    expect(host(container).firstElementChild).toBe(grip())
    rerender(<TopBar {...props} toolbarOwner={null} />)
    expect(screen.queryByRole('button', { name: '도구줄 옮기기' })).toBeNull()
  })

  it('붙어 있으면 창 끌기 자리("deep")이고 떠 있는 표시 · 자리 틀 · 붙이기 단추가 없다', () => {
    const { container } = render(<TopBar {...props} toolbarOwner={pdf} />)
    expect(host(container).hasAttribute('data-floating')).toBe(false)
    expect(host(container).getAttribute('data-tauri-drag-region')).toBe('deep')
    expect(placeholder(container)).toBeNull()
    expect(screen.queryByRole('button', { name: '도구줄 붙이기' })).toBeNull()
  })

  it('손잡이는 누를 때 초점을 가져오지 않는다(pointerdown 기본 동작 막기)', () => {
    render(<TopBar {...props} toolbarOwner={pdf} />)
    expect(fireEvent.pointerDown(grip(), { button: 0 })).toBe(false)
    fireEvent.pointerUp(window)
  })

  it('떠 있으면 같은 요소가 카드가 되고(창 끌기 자리 아님 "false"), 상단바에는 자리 틀이 host 바로 뒤에 남으며, 붙이기 단추가 생긴다', () => {
    setPlace('toolbar', { mode: 'float', x: 120, y: 200 })
    const slotRef = vi.fn()
    const { container } = render(<TopBar {...props} toolbarOwner={pdf} toolbarSlotRef={slotRef} />)
    const card = host(container)
    expect(card.hasAttribute('data-floating')).toBe(true)
    expect(card.getAttribute('data-tauri-drag-region')).toBe('false')
    expect(card.style.left).toBe('120px')
    expect(card.style.top).toBe('200px')
    const frame = placeholder(container)
    expect(frame).not.toBeNull()
    expect(card.nextElementSibling).toBe(frame)
    expect(frame?.hasAttribute('data-owned')).toBe(true)
    expect(screen.getByRole('button', { name: '도구줄 붙이기' })).toBeDefined()
    // 칸들이 도구를 넣는 자리 요소는 그대로 host 안에 있다
    expect(slotRef).toHaveBeenCalledWith(card.querySelector('.topbar-toolbar-slot'))
  })

  it('떠 있는 채로 칸 종류가 바뀌어도(PDF → 노트 → Markdown) 자리는 그대로다(내용만 바뀐다)', () => {
    setPlace('toolbar', { mode: 'float', x: 140, y: 220 })
    const { container, rerender } = render(<TopBar {...props} toolbarOwner={pdf} />)
    for (const owner of [note, markdown, pdf]) {
      rerender(<TopBar {...props} toolbarOwner={owner} />)
      expect(host(container).hasAttribute('data-floating')).toBe(true)
      expect(host(container).getAttribute('data-owner')).toBe(owner.kind)
      expect(host(container).style.left).toBe('140px')
      expect(host(container).style.top).toBe('220px')
    }
    expect(getPlace('toolbar')).toEqual({ mode: 'float', x: 140, y: 220 })
  })

  it('붙어 있는 채로 칸 종류가 바뀌어도 붙어 있다', () => {
    const { container, rerender } = render(<TopBar {...props} toolbarOwner={pdf} />)
    for (const owner of [note, markdown]) {
      rerender(<TopBar {...props} toolbarOwner={owner} />)
      expect(host(container).hasAttribute('data-floating')).toBe(false)
    }
  })

  it('도구줄이 없는 칸(주인 없음)이면 카드를 감추되(주인 표시 · 붙이기 단추 없음) 떠 있는 자리는 그대로 두고, 다시 주인이 생기면 같은 자리에 나온다', () => {
    setPlace('toolbar', { mode: 'float', x: 90, y: 110 })
    const { container, rerender } = render(<TopBar {...props} toolbarOwner={null} />)
    expect(host(container).hasAttribute('data-floating')).toBe(true)
    expect(host(container).hasAttribute('data-owner')).toBe(false)
    expect(placeholder(container)?.hasAttribute('data-owned')).toBe(false)
    expect(screen.queryByRole('button', { name: '도구줄 붙이기' })).toBeNull()
    expect(getPlace('toolbar')).toEqual({ mode: 'float', x: 90, y: 110 })
    rerender(<TopBar {...props} toolbarOwner={note} />)
    expect(host(container).style.left).toBe('90px')
    expect(host(container).style.top).toBe('110px')
    expect(placeholder(container)?.hasAttribute('data-owned')).toBe(true)
  })

  it('붙이기 단추 한 번으로 붙는다(자리는 왼쪽 붙음으로 저장된다)', () => {
    setPlace('toolbar', { mode: 'float', x: 90, y: 110 })
    const { container } = render(<TopBar {...props} toolbarOwner={pdf} />)
    fireEvent.click(screen.getByRole('button', { name: '도구줄 붙이기' }))
    expect(getPlace('toolbar')).toEqual({ mode: 'left' })
    expect(host(container).hasAttribute('data-floating')).toBe(false)
    expect(placeholder(container)).toBeNull()
  })

  it('옛 노트 서식 줄이 떠 있던 자리를 한 번 이어받아 시작한다', () => {
    localStorage.setItem('iwae:format-bar-place:v1', JSON.stringify({ notes: { mode: 'float', x: 70, y: 80 } }))
    resetPlacesForTest()
    const { container } = render(<TopBar {...props} toolbarOwner={note} />)
    expect(host(container).hasAttribute('data-floating')).toBe(true)
    expect(host(container).style.left).toBe('70px')
    expect(host(container).style.top).toBe('80px')
  })
})

describe('TopBar — 손잡이 키보드', () => {
  it('Enter · Space 는 뗐다 붙였다, 떠 있을 때 방향키는 8px 씩, 붙어 있을 때 방향키는 아무 일도 없다', () => {
    const { container } = render(<TopBar {...props} toolbarOwner={pdf} />)
    fireEvent.keyDown(grip(), { key: 'ArrowRight' })
    expect(getPlace('toolbar')).toEqual({ mode: 'left' })
    fireEvent.keyDown(grip(), { key: 'Enter' })
    expect(getPlace('toolbar').mode).toBe('float')
    expect(host(container).hasAttribute('data-floating')).toBe(true)
    // jsdom 은 크기를 0 으로 재므로 창(1024×768) 안의 좌표는 그대로다
    act(() => setPlace('toolbar', { mode: 'float', x: 100, y: 200 }))
    fireEvent.keyDown(grip(), { key: 'ArrowRight' })
    fireEvent.keyDown(grip(), { key: 'ArrowUp' })
    expect(getPlace('toolbar')).toEqual({ mode: 'float', x: 108, y: 192 })
    fireEvent.keyDown(grip(), { key: ' ' })
    expect(getPlace('toolbar')).toEqual({ mode: 'left' })
    expect(host(container).hasAttribute('data-floating')).toBe(false)
  })
})

describe('TopBar — 끌어서 떼고 붙이기', () => {
  it('손잡이를 문턱(6px) 넘게 끌면 카드가 되어 따라오고, 놓은 자리가 저장된다. Esc 는 끌기를 취소한다', () => {
    const { container } = render(<TopBar {...props} toolbarOwner={pdf} />)
    fireEvent.pointerDown(grip(), { button: 0, clientX: 50, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 53, clientY: 22 })
    expect(host(container).hasAttribute('data-floating')).toBe(false)
    fireEvent.pointerMove(window, { clientX: 300, clientY: 400 })
    expect(host(container).hasAttribute('data-floating')).toBe(true)
    expect(host(container).hasAttribute('data-dragging')).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(host(container).hasAttribute('data-floating')).toBe(false)
    expect(getPlace('toolbar')).toEqual({ mode: 'left' })
    fireEvent.pointerDown(grip(), { button: 0, clientX: 50, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 300, clientY: 400 })
    fireEvent.pointerUp(window, { clientX: 300, clientY: 400 })
    const placed = getPlace('toolbar')
    expect(placed.mode).toBe('float')
    expect(host(container).hasAttribute('data-dragging')).toBe(false)
    expect(document.body.classList.contains('format-bar-dragging')).toBe(false)
    expect(placeholder(container)).not.toBeNull()
  })

  it('떠 있는 카드를 상단바 자리 틀 위에 놓으면 붙는다(끄는 동안 자리 틀에 점선 윤곽과 앉을 자리 윤곽이 보인다)', () => {
    setPlace('toolbar', { mode: 'float', x: 300, y: 300 })
    const { container } = render(<TopBar {...props} toolbarOwner={pdf} />)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      const zone = this.classList.contains('topbar-toolbar-placeholder')
      const left = zone ? 400 : 0
      const width = zone ? 500 : 300
      return { x: left, y: 0, top: 0, left, right: left + width, bottom: 36, width, height: 36, toJSON: () => ({}) } as DOMRect
    })
    fireEvent.pointerDown(grip(), { button: 0, clientX: 310, clientY: 310 })
    fireEvent.pointerMove(window, { clientX: 500, clientY: 20 })
    expect(placeholder(container)?.hasAttribute('data-format-drop')).toBe(true)
    expect(container.querySelector('.format-bar-snap')).not.toBeNull()
    fireEvent.pointerUp(window, { clientX: 500, clientY: 20 })
    expect(getPlace('toolbar')).toEqual({ mode: 'left' })
    expect(host(container).hasAttribute('data-floating')).toBe(false)
    expect(container.querySelector('.format-bar-snap')).toBeNull()
  })

  it('자리 틀 밖에 놓으면 그 자리에 뜬다', () => {
    setPlace('toolbar', { mode: 'float', x: 300, y: 300 })
    render(<TopBar {...props} toolbarOwner={pdf} />)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      const zone = this.classList.contains('topbar-toolbar-placeholder')
      const left = zone ? 400 : 0
      return { x: left, y: 0, top: 0, left, right: left + 500, bottom: 36, width: 500, height: 36, toJSON: () => ({}) } as DOMRect
    })
    fireEvent.pointerDown(grip(), { button: 0, clientX: 310, clientY: 310 })
    fireEvent.pointerMove(window, { clientX: 500, clientY: 200 })
    fireEvent.pointerUp(window, { clientX: 500, clientY: 200 })
    expect(getPlace('toolbar').mode).toBe('float')
  })

  it('창 크기가 바뀌면 떠 있는 카드를 창 안으로 다시 가둔다(저장한 좌표는 그대로)', () => {
    setPlace('toolbar', { mode: 'float', x: 900, y: 600 })
    const { container } = render(<TopBar {...props} toolbarOwner={pdf} />)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: HTMLElement) {
      const card = this.classList.contains('topbar-toolbar-host')
      return { x: 0, y: 0, top: 0, left: 0, right: card ? 300 : 0, bottom: card ? 36 : 0, width: card ? 300 : 0, height: card ? 36 : 0, toJSON: () => ({}) } as DOMRect
    })
    vi.stubGlobal('innerWidth', 600)
    vi.stubGlobal('innerHeight', 400)
    act(() => { window.dispatchEvent(new Event('resize')) })
    // 600 − 300 − 8 = 292, 400 − 36 − 8 = 356
    expect(host(container).style.left).toBe('292px')
    expect(host(container).style.top).toBe('356px')
    expect(getPlace('toolbar')).toEqual({ mode: 'float', x: 900, y: 600 })
    vi.unstubAllGlobals()
  })
})

describe('도구줄 카드 크기 계산', () => {
  it('붙는 자리가 너무 좁으면 왼쪽으로 넓혀 놓기 쉽게 하고, 넉넉하면 그대로다', () => {
    expect(dockZoneOf({ left: 800, top: 0, right: 803, bottom: 36 })).toEqual({ left: 683, top: 0, right: 803, bottom: 36 })
    const wide = { left: 100, top: 0, right: 700, bottom: 36 }
    expect(dockZoneOf(wide)).toBe(wide)
  })

  it('떠 있는 카드가 더 커질 수 있는 폭 = 창 − 여유 16px − 카드 폭. 붙어 있거나 카드 밖이면 0', () => {
    document.body.innerHTML = '<div class="topbar-toolbar-host" data-floating=""><div class="topbar-toolbar-slot"><span id="inside"></span></div></div><div class="topbar-toolbar-host"><span id="docked"></span></div>'
    const card = document.querySelector<HTMLElement>('.topbar-toolbar-host')!
    card.getBoundingClientRect = () => ({ width: 500, height: 36, x: 0, y: 0, top: 0, left: 0, right: 500, bottom: 36, toJSON: () => ({}) })
    expect(floatingExtraWidth(document.getElementById('inside')!, 1000)).toBe(484)
    expect(floatingExtraWidth(document.getElementById('inside')!, 400)).toBe(0)
    expect(floatingExtraWidth(document.getElementById('docked')!, 1000)).toBe(0)
  })
})
