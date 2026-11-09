// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PdfOverlayPalette } from './PdfOverlayPalette'
import { createLine, createShape, createTextBox } from '../core/pdfOverlays'
import type { OverlayStyle } from './PdfOverlayLayer'

const style: OverlayStyle = { color: '#d9363e', textSize: 12, lineWidth: 2, bold: false, textFill: 'none', border: false, dash: 'solid', arrowStart: false, arrowEnd: false, fill: false }

describe('PdfOverlayPalette (서식 띠)', () => {
  it('도구 단추는 도구줄에 있고 띠에는 지금 도구 칩과 서식만', () => {
    render(<PdfOverlayPalette tool="line" style={style} onStyleChange={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByRole('toolbar', { name: '선' })).toBeDefined()
    for (const name of ['글 상자', '펜', '지우개']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getByRole('button', { name: '끝에 화살촉' })).toBeDefined()
    expect(screen.getByRole('button', { name: '짧은 점선' })).toBeDefined()
  })

  it('아무것도 안 고르면 그 도구로 새로 만들 것의 서식을 바꾼다', () => {
    const onStyleChange = vi.fn()
    render(<PdfOverlayPalette tool="line" style={style} onStyleChange={onStyleChange} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '양쪽 화살촉' }))
    expect(onStyleChange).toHaveBeenCalledWith({ arrowEnd: true, arrowStart: true })
    fireEvent.click(screen.getByRole('button', { name: '굵기 3' }))
    expect(onStyleChange).toHaveBeenCalledWith({ lineWidth: 3 })
    fireEvent.click(screen.getByRole('button', { name: '점선' }))
    expect(onStyleChange).toHaveBeenCalledWith({ dash: 'dash' })
  })

  it('고른 글 상자에는 색·굵게·바탕·지우기가 바로 걸린다', () => {
    const text = createTextBox(0, 10, 10, { text: '메모' })
    const onUpdate = vi.fn()
    const onRemove = vi.fn()
    render(<PdfOverlayPalette tool="text" style={style} onStyleChange={vi.fn()} selected={text} onUpdateSelected={onUpdate} onRemoveSelected={onRemove} onDone={vi.fn()} />)
    expect(screen.getByRole('toolbar', { name: '고른 글 상자' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '굵게' }))
    expect(onUpdate).toHaveBeenCalledWith({ bold: true })
    fireEvent.click(screen.getByRole('button', { name: '색 #1a73e8' }))
    expect(onUpdate).toHaveBeenCalledWith({ color: '#1a73e8' })
    fireEvent.click(screen.getByRole('button', { name: '흰 바탕(아래 글 가리기)' }))
    expect(onUpdate).toHaveBeenCalledWith({ fill: 'white' })
    fireEvent.click(screen.getByRole('button', { name: '고른 것 지우기' }))
    expect(onRemove).toHaveBeenCalled()
  })

  it('고른 선·도형: 화살촉·선 모양·칠하기', () => {
    const onUpdate = vi.fn()
    const line = createLine(0, { x: 0, y: 0 }, { x: 50, y: 50 })
    const { unmount } = render(<PdfOverlayPalette tool="line" style={style} onStyleChange={vi.fn()} selected={line} onUpdateSelected={onUpdate} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '끝에 화살촉' }))
    expect(onUpdate).toHaveBeenCalledWith({ arrow: true, arrowStart: undefined })
    fireEvent.click(screen.getByRole('button', { name: '짧은 점선' }))
    expect(onUpdate).toHaveBeenCalledWith({ dashed: undefined, dotted: true })
    unmount()
    const shape = createShape(0, 'rect', { x: 0, y: 0 }, { x: 40, y: 30 })
    render(<PdfOverlayPalette tool="rect" style={style} onStyleChange={vi.fn()} selected={shape} onUpdateSelected={onUpdate} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '안을 옅게 칠하기' }))
    expect(onUpdate).toHaveBeenCalledWith({ fill: true })
  })

  it('칩·닫기 단추·Esc 로 도구를 끈다', () => {
    const onDone = vi.fn()
    render(<PdfOverlayPalette tool="pen" style={style} onStyleChange={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: '펜 닫기' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDone).toHaveBeenCalledTimes(2)
  })
})
