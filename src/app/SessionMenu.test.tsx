// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { SessionMenu, type SessionMenuActions } from './SessionMenu'

const ok = async () => ({ ok: true, message: '' })

function setup(overrides: Partial<SessionMenuActions> = {}, rows = [
  { name: '기본', screenCount: 1, lastUsedAt: null as number | null },
  { name: '논문', screenCount: 3, lastUsedAt: Date.now() - 5 * 60_000 },
]) {
  const actions: SessionMenuActions = {
    list: vi.fn(async () => rows),
    onSwitch: vi.fn(ok),
    onNew: vi.fn(ok),
    onSaveAs: vi.fn(ok),
    onRename: vi.fn(ok),
    onDelete: vi.fn(),
    ...overrides,
  }
  const onClose = vi.fn()
  const anchor = createRef<HTMLElement>()
  render(<SessionMenu current="기본" left={10} top={10} anchorRef={anchor} actions={actions} onClose={onClose} />)
  return { actions, onClose }
}

const menu = () => screen.getByRole('menu', { name: '세션' })

describe('SessionMenu', () => {
  it('세션 목록에 화면 수와 마지막으로 쓴 때를 보이고, 지금 세션에 표시한다', async () => {
    setup()
    await waitFor(() => expect(within(menu()).getByRole('menuitem', { name: /논문/u })).toBeDefined())
    const now = within(menu()).getByRole('menuitem', { name: /기본/u })
    expect(now.getAttribute('aria-current')).toBe('true')
    expect(now.textContent).toContain('지금')
    const other = within(menu()).getByRole('menuitem', { name: /논문/u })
    expect(other.textContent).toContain('화면 3개')
    expect(other.textContent).toContain('5분 전')
  })

  it('다른 세션을 누르면 바꾸고 닫는다. 지금 세션을 누르면 그냥 닫는다', async () => {
    const { actions, onClose } = setup()
    await waitFor(() => screen.getByRole('menuitem', { name: /논문/u }))
    fireEvent.click(screen.getByRole('menuitem', { name: /기본/u }))
    expect(actions.onSwitch).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledWith(true)
    onClose.mockClear()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /논문/u })) })
    expect(actions.onSwitch).toHaveBeenCalledWith('논문')
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
  })

  it('새 세션: 이름 입력칸이 열리고, 겹치는 이름과 경로 구분자는 막고, 좋은 이름은 만든다', async () => {
    const { actions, onClose } = setup()
    await waitFor(() => screen.getByRole('menuitem', { name: /논문/u }))
    fireEvent.click(screen.getByRole('menuitem', { name: /새 세션/u }))
    const input = screen.getByRole('textbox', { name: '세션 이름' })
    fireEvent.change(input, { target: { value: '논문' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toContain('이미 있습니다')
    fireEvent.change(input, { target: { value: 'a/b' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert').textContent).toContain('쓸 수 없습니다')
    expect(actions.onNew).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '  발표  ' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(actions.onNew).toHaveBeenCalledWith('발표')
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
  })

  it('동작이 실패하면 메뉴를 닫지 않고 이유를 보인다', async () => {
    const { onClose } = setup({ onNew: async () => ({ ok: false, message: '디스크가 가득 찼습니다' }) })
    await waitFor(() => screen.getByRole('menuitem', { name: /논문/u }))
    fireEvent.click(screen.getByRole('menuitem', { name: /새 세션/u }))
    const input = screen.getByRole('textbox', { name: '세션 이름' })
    fireEvent.change(input, { target: { value: '발표' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(screen.getByRole('alert').textContent).toContain('디스크가 가득 찼습니다')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('다른 이름으로 저장 · 이름 바꾸기는 지금 이름을 채워 연다(이름 바꾸기는 자기 이름을 허용한다)', async () => {
    const { actions } = setup()
    await waitFor(() => screen.getByRole('menuitem', { name: /논문/u }))
    fireEvent.click(screen.getByRole('menuitem', { name: /다른 이름으로 저장/u }))
    const saveInput = screen.getByRole('textbox', { name: '세션 이름' }) as HTMLInputElement
    expect(saveInput.value).toContain('기본')
    await act(async () => { fireEvent.keyDown(saveInput, { key: 'Enter' }) })
    expect(actions.onSaveAs).toHaveBeenCalledOnce()
    // Esc 는 입력칸만 닫고 목록으로 돌아간다
    fireEvent.keyDown(saveInput, { key: 'Escape' })
    expect(screen.getByRole('menuitem', { name: /이름 바꾸기/u })).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: /이름 바꾸기/u }))
    const renameInput = screen.getByRole('textbox', { name: '세션 이름' }) as HTMLInputElement
    expect(renameInput.value).toBe('기본')
    await act(async () => { fireEvent.keyDown(renameInput, { key: 'Enter' }) })
    expect(actions.onRename).toHaveBeenCalledWith('기본')
  })

  it('삭제는 확인을 바깥에 맡기고, 세션이 하나뿐이면 꺼져 있다', async () => {
    const { actions, onClose } = setup()
    await waitFor(() => screen.getByRole('menuitem', { name: /논문/u }))
    fireEvent.click(screen.getByRole('menuitem', { name: /삭제/u }))
    expect(actions.onDelete).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('세션이 하나뿐이면 삭제가 꺼져 있고, 앱 창으로 띄우기는 「다음 단계」로 꺼져 있다', async () => {
    setup({}, [{ name: '기본', screenCount: 1, lastUsedAt: null }])
    await waitFor(() => screen.getByRole('menuitem', { name: /기본/u }))
    expect((screen.getByRole('menuitem', { name: /삭제/u }) as HTMLButtonElement).disabled).toBe(true)
    const detach = screen.getByRole('menuitem', { name: /앱 창으로 띄우기/u }) as HTMLButtonElement
    expect(detach.disabled).toBe(true)
    expect(detach.textContent).toContain('다음 단계')
  })
})
