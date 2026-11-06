// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PdfOverlayPalette } from './PdfOverlayPalette'
import { createLine, createTextBox } from '../core/pdfOverlays'
import type { OverlayStyle } from './PdfOverlayLayer'

const style: OverlayStyle = { color: '#d9363e', textSize: 9, lineWidth: 2, arrow: false, dashed: false }

describe('PdfOverlayPalette', () => {
  it('도구 단추는 도구줄에 있고 떠 있는 창은 서식만(화살표는 선의 서식)', () => {
    render(<PdfOverlayPalette tool="line" style={style} onToolChange={vi.fn()} onStyleChange={vi.fn()} onDone={vi.fn()} />)
    for (const name of ['글 상자', '펜', '지우개', '선']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('button', { name: '화살표 도구' })).toBeNull()
    expect(screen.getByRole('button', { name: '화살표' })).toBeDefined()
  })

  it('아무것도 안 고르면 새로 만들 것의 서식을 바꾼다', () => {
    const onStyleChange = vi.fn()
    render(<PdfOverlayPalette tool="line" style={style} onToolChange={vi.fn()} onStyleChange={onStyleChange} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '화살표' }))
    expect(onStyleChange).toHaveBeenCalledWith({ arrow: true })
    fireEvent.click(screen.getByRole('button', { name: '굵기 3' }))
    expect(onStyleChange).toHaveBeenCalledWith({ lineWidth: 3 })
  })

  it('고른 글 상자에는 색·굵게·바탕·지우기가 바로 걸린다', () => {
    const text = createTextBox(0, 10, 10, { text: '메모' })
    const onUpdate = vi.fn()
    const onRemove = vi.fn()
    render(<PdfOverlayPalette tool="text" style={style} onToolChange={vi.fn()} onStyleChange={vi.fn()} selected={text} onUpdateSelected={onUpdate} onRemoveSelected={onRemove} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '굵게' }))
    expect(onUpdate).toHaveBeenCalledWith({ bold: true })
    fireEvent.click(screen.getByRole('button', { name: '색 #1a73e8' }))
    expect(onUpdate).toHaveBeenCalledWith({ color: '#1a73e8' })
    fireEvent.click(screen.getByRole('button', { name: '흰 바탕(아래 글 가리기)' }))
    expect(onUpdate).toHaveBeenCalledWith({ fill: 'white' })
    fireEvent.click(screen.getByRole('button', { name: '고른 것 지우기' }))
    expect(onRemove).toHaveBeenCalled()
  })

  it('고른 선에는 점선이 걸린다', () => {
    const line = createLine(0, { x: 0, y: 0 }, { x: 10, y: 10 })
    const onUpdate = vi.fn()
    render(<PdfOverlayPalette tool="text" style={style} onToolChange={vi.fn()} onStyleChange={vi.fn()} selected={line} onUpdateSelected={onUpdate} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '점선' }))
    expect(onUpdate).toHaveBeenCalledWith({ dashed: true })
  })
})
