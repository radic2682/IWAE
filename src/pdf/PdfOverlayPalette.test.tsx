// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PdfOverlayPalette } from './PdfOverlayPalette'
import { createLine, createShape, createTextBox } from '../core/pdfOverlays'
import type { OverlayStyle } from './PdfOverlayLayer'

const style: OverlayStyle = { color: '#d9363e', textSize: 12, lineWidth: 2, bold: false, textFill: 'none', border: false, textBorderColor: '', textFont: '', dash: 'solid', arrowStart: false, arrowEnd: false, fill: false }

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
    // 글자색 · 바탕색은 노트 · 캔버스와 같은 서식 줄의 색 단추 → 팔레트
    fireEvent.click(screen.getByRole('button', { name: '글자색 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '글자색 #1a73e8' }))
    expect(onUpdate).toHaveBeenCalledWith({ color: '#1a73e8' })
    expect(screen.queryByRole('dialog', { name: '글자색 팔레트' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '바탕색 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '바탕색 흰 바탕(아래 글 가리기)' }))
    expect(onUpdate).toHaveBeenCalledWith({ fill: 'white' })
    fireEvent.click(screen.getByRole('button', { name: '바탕색 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '바탕 없음' }))
    expect(onUpdate).toHaveBeenLastCalledWith({ fill: undefined })
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

describe('PdfOverlayPalette 글 상자 서식(글꼴·크기·색·서식 가져오기)', () => {
  const text = createTextBox(0, 10, 10, { text: '메모', size: 9.5, font: 'batang' })
  // jsdom 에는 scrollIntoView 가 없다(Select 가 부른다)
  Element.prototype.scrollIntoView = vi.fn()

  it('글꼴 목록에서 고르면 고른 상자에 font 가 걸리고, 기본으로 돌리면 지운다', () => {
    const onUpdate = vi.fn()
    render(<PdfOverlayPalette tool="text" style={style} onStyleChange={vi.fn()} selected={text} onUpdateSelected={onUpdate} onDone={vi.fn()} />)
    const font = screen.getByRole('combobox', { name: '글꼴' })
    expect(font.textContent).toContain('바탕(명조)')
    fireEvent.click(font)
    fireEvent.click(screen.getByRole('option', { name: 'Times New Roman' }))
    expect(onUpdate).toHaveBeenCalledWith({ font: 'times' })
    fireEvent.click(font)
    fireEvent.click(screen.getByRole('option', { name: '기본(맑은 고딕)' }))
    expect(onUpdate).toHaveBeenCalledWith({ font: undefined })
  })

  it('가져온 설치 글꼴 이름은 목록에 더해 보인다', () => {
    const custom = createTextBox(0, 0, 0, { text: 'x', font: 'Noto Serif KR' })
    render(<PdfOverlayPalette tool="text" style={style} onStyleChange={vi.fn()} selected={custom} onUpdateSelected={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: '글꼴' }).textContent).toContain('Noto Serif KR')
  })

  it('글자 크기: 9.5 처럼 직접 쓰고 Enter, ↑↓ 는 0.5 씩, 범위 밖은 4~144 로', () => {
    const onUpdate = vi.fn()
    render(<PdfOverlayPalette tool="text" style={style} onStyleChange={vi.fn()} selected={text} onUpdateSelected={onUpdate} onDone={vi.fn()} />)
    const size = screen.getByRole('spinbutton', { name: '글자 크기' }) as HTMLInputElement
    expect(size.value).toBe('9.5')
    fireEvent.change(size, { target: { value: '10,5' } })
    fireEvent.keyDown(size, { key: 'Enter' })
    expect(onUpdate).toHaveBeenLastCalledWith({ size: 10.5 })
    fireEvent.keyDown(size, { key: 'ArrowUp' })
    expect(onUpdate).toHaveBeenLastCalledWith({ size: 10 })
    fireEvent.keyDown(size, { key: 'ArrowDown', shiftKey: true })
    expect(onUpdate).toHaveBeenLastCalledWith({ size: 4.5 })
    fireEvent.change(size, { target: { value: '500' } })
    fireEvent.blur(size)
    expect(onUpdate).toHaveBeenLastCalledWith({ size: 144 })
  })

  it('자주 쓰는 크기 목록에서도 고른다', () => {
    const onStyleChange = vi.fn()
    render(<PdfOverlayPalette tool="text" style={style} onStyleChange={onStyleChange} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '자주 쓰는 크기' }))
    fireEvent.click(screen.getByRole('option', { name: '7 pt' }))
    expect(onStyleChange).toHaveBeenCalledWith({ textSize: 7 })
  })

  it('바탕색·테두리색을 직접 고른다. 테두리 색 칸은 테두리가 켜졌을 때만', () => {
    const onUpdate = vi.fn()
    const { rerender } = render(<PdfOverlayPalette tool="text" style={style} onStyleChange={vi.fn()} selected={text} onUpdateSelected={onUpdate} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '바탕색 선택' }))
    fireEvent.change(screen.getByLabelText('바탕색 직접 고르기'), { target: { value: '#ffeecc' } })
    expect(onUpdate).toHaveBeenCalledWith({ fill: '#ffeecc' })
    expect(screen.queryByLabelText('테두리 색 직접 고르기')).toBeNull()
    const bordered = { ...text, border: true as const }
    rerender(<PdfOverlayPalette tool="text" style={style} onStyleChange={vi.fn()} selected={bordered} onUpdateSelected={onUpdate} onDone={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('테두리 색 직접 고르기'), { target: { value: '#336699' } })
    expect(onUpdate).toHaveBeenCalledWith({ borderColor: '#336699' })
  })

  it('고른 것이 없으면 도구 서식(새 글 상자)을 바꾼다', () => {
    const onStyleChange = vi.fn()
    render(<PdfOverlayPalette tool="text" style={style} onStyleChange={onStyleChange} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('combobox', { name: '글꼴' }))
    fireEvent.click(screen.getByRole('option', { name: '궁서' }))
    expect(onStyleChange).toHaveBeenCalledWith({ textFont: 'gungsuh' })
    fireEvent.click(screen.getByRole('button', { name: '바탕색 선택' }))
    fireEvent.change(screen.getByLabelText('바탕색 직접 고르기'), { target: { value: '#ddeeff' } })
    expect(onStyleChange).toHaveBeenCalledWith({ textFill: '#ddeeff' })
  })

  it('서식 가져오기 단추는 켜고 끄며, Esc 는 도구가 아니라 서식 가져오기만 끈다', () => {
    const onDone = vi.fn()
    render(<PdfOverlayPalette tool="text" style={style} onStyleChange={vi.fn()} onDone={onDone} />)
    const pick = screen.getByRole('button', { name: '서식 가져오기' })
    expect(pick.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(pick)
    expect(pick.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(pick.getAttribute('aria-pressed')).toBe('false')
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
