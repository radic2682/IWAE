// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BlockContextMenu } from './BlockContextMenu'

describe('BlockContextMenu', () => {
  it('삭제 메뉴는 삭제 액션을 전달한다', () => {
    const onAction = vi.fn()
    render(<BlockContextMenu x={40} y={60} canOpenSource canTranslate onAction={onAction} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('menuitem', { name: '삭제' }))
    expect(onAction).toHaveBeenCalledWith('delete')
  })

  it('연결된 블록에서만 연결 해제 메뉴를 사용할 수 있다', () => {
    const onAction = vi.fn()
    const view = render(<BlockContextMenu x={40} y={60} canOpenSource={false} canTranslate={false} onAction={onAction} onClose={vi.fn()} />)
    expect((screen.getByRole('menuitem', { name: '연결 해제' }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<BlockContextMenu x={40} y={60} canOpenSource={false} canTranslate={false} canDisconnect onAction={onAction} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('menuitem', { name: '연결 해제' }))
    expect(onAction).toHaveBeenCalledWith('disconnect')
  })

  it('선택한 블록을 사용자 프리셋으로 저장한다', () => {
    const onAction = vi.fn()
    render(<BlockContextMenu x={40} y={60} canOpenSource canTranslate canSavePreset onAction={onAction} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('menuitem', { name: '프리셋으로 추가' }))
    expect(onAction).toHaveBeenCalledWith('savePreset')
  })

  it('블록 스타일 초기화 액션을 전달한다', () => {
    const onAction = vi.fn()
    render(<BlockContextMenu x={40} y={60} canOpenSource canTranslate onAction={onAction} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('menuitem', { name: '스타일 초기화' }))
    expect(onAction).toHaveBeenCalledWith('resetStyle')
  })

  it('출처나 텍스트가 없으면 관련 액션을 비활성화한다', () => {
    render(<BlockContextMenu x={40} y={60} canOpenSource={false} canTranslate={false} onAction={vi.fn()} onClose={vi.fn()} />)
    expect((screen.getByRole('menuitem', { name: '원문 열기' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('menuitem', { name: '번역 블록 만들기' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Escape로 메뉴를 닫는다', () => {
    const onClose = vi.fn()
    render(<BlockContextMenu x={40} y={60} canOpenSource canTranslate onAction={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
