// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cssRules, cssSource, declarationsOf, ruleDecl } from '../cssRules.testutil'
import { EmptyPane } from './EmptyPane'

afterEach(cleanup)

const all = () => ({ onPdf: vi.fn(), onMarkdown: vi.fn(), onNote: vi.fn(), onClose: vi.fn() })
const labels = () => screen.getAllByRole('button').map((button) => button.textContent)

describe('EmptyPane', () => {
  it('제목 · 한 줄 안내 · 명령 목록(아이콘 · 이름 · 오른쪽 키 힌트)을 그린다', () => {
    render(<EmptyPane prefixText="Ctrl+B" {...all()} />)
    expect(screen.getByText('빈 칸')).toBeDefined()
    expect(screen.getByText('문서를 열거나 다른 칸의 탭을 끌어 놓으세요')).toBeDefined()
    // 번역기 · 캔버스 줄은 없다(번역기는 창 전체에 떠 있는 창, 캔버스는 꺼 두었다)
    expect(labels()).toEqual(['PDF 열기', 'Markdown 열기', '노트 열기', '이 칸 닫기Ctrl+B x'])
    expect(screen.queryByRole('button', { name: /번역기/u })).toBeNull()
    expect(screen.queryByRole('button', { name: /캔버스/u })).toBeNull()
    const close = screen.getByRole('button', { name: /^이 칸 닫기/u })
    expect(close.querySelector('.empty-pane-row-icon svg')).not.toBeNull()
    expect(close.querySelector('kbd.empty-pane-row-hint')?.textContent).toBe('Ctrl+B x')
    // 키 힌트가 없는 줄에는 kbd 가 없다
    expect(screen.getByRole('button', { name: 'PDF 열기' }).querySelector('kbd')).toBeNull()
  })

  it('키 힌트는 접두키를 따른다(하드코딩이 아니다)', () => {
    render(<EmptyPane prefixText="⌃Space" {...all()} />)
    expect(screen.getByRole('button', { name: /^이 칸 닫기/u }).textContent).toBe('이 칸 닫기⌃Space x')
  })

  it('이 칸 닫기는 onClose 가 있을 때(칸이 둘 이상)만 보이고, Vault 가 없으면 노트 줄이 없다', () => {
    render(<EmptyPane prefixText="Ctrl+B" onPdf={vi.fn()} onMarkdown={vi.fn()} />)
    expect(labels()).toEqual(['PDF 열기', 'Markdown 열기'])
  })

  it('줄을 누르면 그 동작이 불린다', () => {
    const handlers = all()
    render(<EmptyPane prefixText="Ctrl+B" {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'PDF 열기' }))
    fireEvent.click(screen.getByRole('button', { name: 'Markdown 열기' }))
    fireEvent.click(screen.getByRole('button', { name: '노트 열기' }))
    fireEvent.click(screen.getByRole('button', { name: /^이 칸 닫기/u }))
    for (const handler of Object.values(handlers)) expect(handler).toHaveBeenCalledTimes(1)
  })

  it('↑ ↓ Home End 로 줄을 오가고(끝에서 돌아 나간다), 처음 줄만 Tab 으로 들어온다', () => {
    render(<EmptyPane prefixText="Ctrl+B" {...all()} recents={[{ key: 'a', title: '논문 A', kind: 'pdf', onOpen: vi.fn() }]} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1, -1])
    buttons[0]!.focus()
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(buttons[1])
    fireEvent.keyDown(buttons[1]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(buttons[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(buttons[4])
    fireEvent.keyDown(buttons[4]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(buttons[0]!, { key: 'End' })
    expect(document.activeElement).toBe(buttons[4])
    fireEvent.keyDown(buttons[4]!, { key: 'Home' })
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
  const read = (name: string) => readFileSync(join(__dirname, '../../ui', name), 'utf8').split(String.fromCharCode(13)).join('')
  const css = read('empty-pane.css')

  it('빈 칸은 자리(slot)다: 바탕 · 실선 · 채널 가장자리 없이 6/5 점선 윤곽 하나(1.5px, 카드와 같은 둥글기), 만지면 강조색 70%', () => {
    const surface = read('workspace-surface.css')
    expect(surface).toMatch(/--pane-edge-w: 2px;/u)
    expect(surface).toMatch(/--pane-edge-empty: var\(--divider-strong\);/u)
    // 같은 .pane-card 규칙(둥글기 --r-md · 두께 --pane-edge-w)에서 선 모양과 색만 바꾼다
    expect(ruleDecl('workspace-surface.css', '.panes-tree .pane-card', 'border')).toBe('var(--pane-edge-w) solid var(--pane-c)')
    expect(ruleDecl('workspace-surface.css', '.panes-tree .pane-card', 'border-radius')).toBe('var(--r-md)')
    expect(ruleDecl('workspace-surface.css', '.panes-tree .pane-card[data-empty]', 'border-color')).toBe('transparent')
    expect(ruleDecl('workspace-surface.css', '.panes-tree .pane-card[data-empty]', 'background')).toBe('transparent')
    expect(ruleDecl('workspace-surface.css', '.pane-slot-outline rect', 'rx')).toBe('calc(var(--r-md) - var(--pane-edge-w) / 2)')
    expect(ruleDecl('workspace-surface.css', '.pane-slot-outline rect', 'stroke-width')).toBe('var(--pane-edge-w)')
    expect(ruleDecl('workspace-surface.css', '.pane-slot-outline rect', 'stroke-dasharray')).toBe('6 5')
    expect(ruleDecl('workspace-surface.css', '.panes-tree .pane-card[data-empty].pane-card-active .pane-slot-outline', 'color')).toBe('color-mix(in srgb, var(--accent) 70%, transparent)')
    // 끌기 중에는 반응 표시가 꺼진다: 끄는 동안(body.pane-tab-dragging …) 반응하는 칸의 테두리는 쉴 때 색(--pane-c)으로 되돌려 둔다
    const dragging = cssRules(cssSource('workspace-surface.css')).find((rule) => rule.selectors.some((selector) => selector.includes('dragging) .panes-tree') && selector.endsWith('.pane-card[data-reacting]:not(.pane-card-active)')))
    expect(dragging).toBeDefined()
    expect(declarationsOf(dragging!.body)['border-color']).toBe('var(--pane-c)')
  })

  it('빈 칸 안 내용은 칸 한가운데에 서고(auto 여백), 위아래 치우침이 없다', () => {
    expect(ruleDecl('empty-pane.css', '.empty-pane', 'margin')).toBe('auto')
    expect(ruleDecl('empty-pane.css', '.pane-placeholder:has(> .empty-pane)', 'container-type')).toBe('size')
  })

  it('최대 280px 기둥이고, 움직임이 없으며, 낮은 칸 줄이기는 CSS 400px 기준이 아니라 실제 높이로 한다', () => {
    expect(ruleDecl('empty-pane.css', '.empty-pane', 'max-width')).toBe('280px')
    expect(css).not.toMatch(/@container/u)
    expect(css).not.toMatch(/transition|animation|@keyframes/u)
  })
})

describe('EmptyPane — 캔버스 줄은 onCanvas 를 줄 때만(CANVAS_ENABLED 를 켜면 되살아난다)', () => {
  it('onCanvas 가 없으면 없고, 있으면 노트 다음 · 칸 닫기 앞에 나와 누르면 불린다', () => {
    const { rerender } = render(<EmptyPane prefixText="Ctrl+B" onPdf={vi.fn()} onNote={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '캔버스 열기' })).toBeNull()
    const onCanvas = vi.fn()
    rerender(<EmptyPane prefixText="Ctrl+B" onPdf={vi.fn()} onNote={vi.fn()} onCanvas={onCanvas} onClose={vi.fn()} />)
    const rows = [...document.querySelectorAll('button[data-empty-row]')].map((row) => row.getAttribute('data-empty-row'))
    expect(rows).toEqual(['pdf', 'note', 'canvas', 'close'])
    fireEvent.click(screen.getByRole('button', { name: '캔버스 열기' }))
    expect(onCanvas).toHaveBeenCalledTimes(1)
  })
})

describe('EmptyPane — 키 힌트는 접두키 칩 · 명령 팔레트와 같은 키캡 모양(UI 글꼴)', () => {
  it('힌트가 고정폭 글꼴이 아니라 UI 글꼴 키캡이고, 접두키 칩 · 팔레트 키 표시와 같은 테두리 · 둥글기다', () => {
    const css = readFileSync(join(__dirname, '../../ui/empty-pane.css'), 'utf8')
    const hint = css.slice(css.indexOf('.empty-pane-row-hint {'), css.indexOf('}', css.indexOf('.empty-pane-row-hint {')))
    expect(hint).not.toMatch(/monospace|font-mono/u)
    expect(hint).toContain('font: inherit;')
    expect(hint).toContain('border: 1px solid var(--divider-strong')
    expect(hint).toContain('border-radius: var(--r-xs);')
    const palette = readFileSync(join(__dirname, '../../ui/command-palette.css'), 'utf8')
    expect(palette).toMatch(/\.command-palette-kbd \{[^}]*border: 1px solid var\(--divider-strong\)[^}]*font: inherit;/u)
  })
})
