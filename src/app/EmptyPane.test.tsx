// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EmptyPane } from './EmptyPane'

afterEach(cleanup)

const all = () => ({ onPdf: vi.fn(), onMarkdown: vi.fn(), onNote: vi.fn(), onCanvas: vi.fn(), onTranslator: vi.fn(), onClose: vi.fn() })
const labels = () => screen.getAllByRole('button').map((button) => button.textContent)

describe('EmptyPane', () => {
  it('제목 · 한 줄 안내 · 명령 목록(아이콘 · 이름 · 오른쪽 키 힌트)을 그린다', () => {
    render(<EmptyPane prefixText="Ctrl+B" {...all()} />)
    expect(screen.getByText('빈 칸')).toBeDefined()
    expect(screen.getByText('문서를 열거나, 다른 칸의 탭을 끌어 오세요')).toBeDefined()
    expect(labels()).toEqual(['PDF 열기', 'Markdown 열기', '노트 열기', '캔버스 열기', '번역기 띄우기Ctrl+B w', '이 칸 닫기Ctrl+B x'])
    const translator = screen.getByRole('button', { name: /^번역기 띄우기/u })
    expect(translator.querySelector('.empty-pane-row-icon svg')).not.toBeNull()
    expect(translator.querySelector('kbd.empty-pane-row-hint')?.textContent).toBe('Ctrl+B w')
    // 키 힌트가 없는 줄에는 kbd 가 없다
    expect(screen.getByRole('button', { name: 'PDF 열기' }).querySelector('kbd')).toBeNull()
  })

  it('키 힌트는 접두키를 따른다(하드코딩이 아니다)', () => {
    render(<EmptyPane prefixText="⌃Space" {...all()} />)
    expect(screen.getByRole('button', { name: /^번역기 띄우기/u }).textContent).toBe('번역기 띄우기⌃Space w')
    expect(screen.getByRole('button', { name: /^이 칸 닫기/u }).textContent).toBe('이 칸 닫기⌃Space x')
  })

  it('이 칸 닫기는 onClose 가 있을 때(칸이 둘 이상)만 보이고, Vault 가 없으면 노트 · 캔버스 줄이 없다', () => {
    render(<EmptyPane prefixText="Ctrl+B" onPdf={vi.fn()} onMarkdown={vi.fn()} onTranslator={vi.fn()} />)
    expect(labels()).toEqual(['PDF 열기', 'Markdown 열기', '번역기 띄우기Ctrl+B w'])
  })

  it('줄을 누르면 그 동작이 불린다', () => {
    const handlers = all()
    render(<EmptyPane prefixText="Ctrl+B" {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'PDF 열기' }))
    fireEvent.click(screen.getByRole('button', { name: 'Markdown 열기' }))
    fireEvent.click(screen.getByRole('button', { name: '노트 열기' }))
    fireEvent.click(screen.getByRole('button', { name: '캔버스 열기' }))
    fireEvent.click(screen.getByRole('button', { name: /^번역기 띄우기/u }))
    fireEvent.click(screen.getByRole('button', { name: /^이 칸 닫기/u }))
    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1)
  })

  it('↑ ↓ Home End 로 줄을 오가고(끝에서 돌아 나간다), 처음 줄만 Tab 으로 들어온다', () => {
    render(<EmptyPane prefixText="Ctrl+B" {...all()} recents={[{ key: 'a', title: '논문 A', kind: 'pdf', onOpen: vi.fn() }]} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1])
    buttons[0]!.focus()
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(buttons[1])
    fireEvent.keyDown(buttons[1]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(buttons[6])
    fireEvent.keyDown(buttons[6]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(buttons[0]!, { key: 'End' })
    expect(document.activeElement).toBe(buttons[6])
    fireEvent.keyDown(buttons[6]!, { key: 'Home' })
    expect(document.activeElement).toBe(buttons[0])
  })

  it('Enter 는 단추의 기본 동작(클릭)으로 줄을 연다', () => {
    const handlers = all()
    render(<EmptyPane prefixText="Ctrl+B" {...handlers} />)
    const row = screen.getByRole('button', { name: '노트 열기' })
    row.focus()
    // 단추는 Enter 를 클릭으로 바꾼다(jsdom 은 직접 바꾸지 않아 click 으로 확인)
    fireEvent.click(row)
    expect(handlers.onNote).toHaveBeenCalled()
  })

  it('「최근」 은 문서가 있을 때만, 많아야 4 개 나오고 누르면 연다', () => {
    const { rerender } = render(<EmptyPane prefixText="Ctrl+B" {...all()} recents={[]} />)
    expect(screen.queryByText('최근')).toBeNull()
    const opens = [vi.fn(), vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    rerender(<EmptyPane prefixText="Ctrl+B" {...all()} recents={opens.map((onOpen, index) => ({ key: String(index), title: `문서 ${index}`, kind: index === 1 ? 'markdown' : 'pdf', onOpen }))} />)
    expect(screen.getByText('최근')).toBeDefined()
    expect(document.querySelectorAll('.empty-pane-recent .empty-pane-row')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: '문서 2' }))
    expect(opens[2]).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '문서 4' })).toBeNull()
  })
})

describe('EmptyPane 스타일', () => {
  const css = readFileSync(join(__dirname, '../ui/empty-pane.css'), 'utf8').split(String.fromCharCode(13)).join('')
  it('최대 360px 기둥이고, 움직임이 없으며, 낮은 칸 줄이기는 CSS 400px 기준이 아니라 실제 높이로 한다', () => {
    expect(css).toContain('max-width: 360px')
    expect(css).not.toMatch(/@container/u)
    expect(css).not.toMatch(/transition|animation|@keyframes/u)
  })
})
