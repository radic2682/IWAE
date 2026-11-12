// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requestTitleEdit } from '../pdf/memoNoteContext'
import { PaneTabsMenu } from './PaneTabsMenu'
import type { TabsState } from './tabs'

afterEach(cleanup)

const two: TabsState = {
  tabs: [
    { id: 'spec', title: 'HTTP Semantics Guide', kind: 'pdf' },
    { id: 'book', title: 'Rust Handbook', kind: 'pdf' },
  ],
  activeId: 'book',
}
const one: TabsState = { tabs: [{ id: 'spec', title: 'HTTP Semantics Guide', kind: 'pdf' }], activeId: 'spec' }
const note: TabsState = { tabs: [{ id: '노트/전원.iwnote', title: '전원', kind: 'memoNote' }], activeId: '노트/전원.iwnote' }

const base = { label: 'PDF', onActivate: vi.fn(), onClose: vi.fn() }

describe('PaneTabsMenu — 보조 글은 제목 바로 뒤, 같은 알약 안', () => {
  it('보는 탭의 제목 뒤에 「·」 와 보조 글이 같은 탭 안에 붙고, 탭 이름(접근성)에는 들어가지 않는다', () => {
    const { container } = render(<PaneTabsMenu {...base} state={one} secondary="p.4" />)
    const pill = container.querySelector('.pane-top-tab')!
    const title = pill.querySelector('.pane-top-tab-title')!
    expect(title.querySelector('.pane-top-tab-sep')?.textContent).toBe('·')
    expect(title.querySelector('.pane-top-tab-sub')?.textContent).toBe('p.4')
    // 제목 → 「·」 → 보조 글 → (닫기 ×) 차례: 보조 글이 × 보다 앞에 있다
    const order = [...pill.querySelectorAll('.pane-top-tab-label, .pane-top-tab-sep, .pane-top-tab-sub, .pane-top-tab-close')].map((element) => element.className.split(' ')[0])
    expect(order).toEqual(['pane-top-tab-label', 'pane-top-tab-sep', 'pane-top-tab-sub', 'pane-top-tab-close'])
    expect(screen.getByRole('tab', { name: 'HTTP Semantics Guide' })).toBeDefined()
  })

  it('탭이 둘 이상이면 보는 탭에만 보조 글이 붙는다', () => {
    const { container } = render(<PaneTabsMenu {...base} state={two} secondary="p.9" />)
    const pills = [...container.querySelectorAll('.pane-top-tab')]
    expect(pills.map((pill) => pill.querySelector('.pane-top-tab-sub')?.textContent ?? null)).toEqual([null, 'p.9'])
  })

  it('보조 글이 없으면 「·」 도 없다', () => {
    const { container } = render(<PaneTabsMenu {...base} state={one} secondary={null} />)
    expect(container.querySelector('.pane-top-tab-sep')).toBeNull()
    expect(container.querySelector('.pane-top-tab-sub')).toBeNull()
  })

  it('닫기 ×(.pane-top-tab-close)는 각 알약의 끝에 있다', () => {
    const { container } = render(<PaneTabsMenu {...base} state={two} secondary="p.1" />)
    for (const pill of container.querySelectorAll('.pane-top-tab')) expect(pill.lastElementChild?.classList.contains('pane-top-tab-close')).toBe(true)
  })
})

describe('칸 머리 탭은 예전 탭 모양(알약 스타일 없음)', () => {
  const css = readFileSync(join(__dirname, '../ui/screens.css'), 'utf8').split(String.fromCharCode(13)).join('')

  it('알약 규칙(고른 탭 연한 바탕 · × 숨김 · 칸 머리 높이 30px)이 없고 탭은 예전 .topbar-panetab-zone 규칙을 쓴다', () => {
    expect(css).not.toContain('pane-top-tab.pane-top-tab')
    expect(css).not.toContain('.pane-head .pane-top-tab .pane-top-tab-close')
    expect(css).not.toContain('.pane-top-tab-title { height: 100%')
    expect(css).not.toContain('flex: 0 0 30px')
    expect(css).not.toContain('Herdr')
  })

  it('탭 줄 마크업은 예전 그대로: 탭 > 제목 단추(아이콘 · 이름) + ×, 알약 클래스는 없다', () => {
    const { container } = render(<PaneTabsMenu {...base} state={two} />)
    expect(container.innerHTML).not.toContain('pill')
    const tab = container.querySelector('.pane-top-tab.pane-top-tab-active')!
    expect([...tab.children].map((child) => child.className.split(' ')[0])).toEqual(['pane-top-tab-title', 'pane-top-tab-close'])
    expect(tab.querySelector('.pane-top-tab-kind')).not.toBeNull()
  })

  it('보조 글은 칸 머리 바깥 따로 요소(.pane-head-sub)가 아니라 알약 안(.pane-top-tab-sub)에 있다', () => {
    expect(css).not.toContain('.pane-head-sub')
    expect(css).toContain('.pane-head .pane-top-tab-sub')
  })
})

describe('PaneTabsMenu — 메모 노트 탭의 ⌄ 와 이름 바꾸기', () => {
  const props = { ...base, state: note, canRenameTab: (tab: { kind: string }) => tab.kind === 'memoNote' }

  it('renderTabExtra 는 보는 탭의 제목 뒤(× 앞)에 붙는다', () => {
    const { container } = render(<PaneTabsMenu {...props} renderTabExtra={() => <button type="button" data-testid="extra">⌄</button>} onRenameTab={vi.fn()} />)
    const pill = container.querySelector('.pane-top-tab')!
    const kids = [...pill.children].map((child) => child.className || child.getAttribute('data-testid'))
    expect(kids[0]).toBe('pane-top-tab-title')
    expect(kids[1]).toBe('extra')
    expect(kids[2]).toBe('pane-top-tab-close')
  })

  it('안 보이는 탭에는 붙지 않는다', () => {
    const tabs: TabsState = { tabs: [{ id: 'a', title: 'A', kind: 'memoNote' }, { id: 'b', title: 'B', kind: 'memoNote' }], activeId: 'b' }
    render(<PaneTabsMenu {...base} state={tabs} renderTabExtra={(tab) => <i data-testid={`extra-${tab.id}`} />} />)
    expect(screen.queryByTestId('extra-a')).toBeNull()
    expect(screen.queryByTestId('extra-b')).not.toBeNull()
  })

  it('제목을 두 번 누르면 그 자리에서 이름을 바꾼다(Enter 로 확정)', () => {
    const onRenameTab = vi.fn()
    render(<PaneTabsMenu {...props} onRenameTab={onRenameTab} />)
    fireEvent.doubleClick(screen.getByRole('tab', { name: '전원' }))
    const input = screen.getByRole('textbox', { name: '노트 이름' }) as HTMLInputElement
    expect(input.value).toBe('전원')
    fireEvent.change(input, { target: { value: '  전원 계통  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(onRenameTab).toHaveBeenCalledWith(note.tabs[0], '전원 계통')
    expect(screen.queryByRole('textbox', { name: '노트 이름' })).toBeNull()
  })

  it('Esc 는 취소, 같은 이름·빈 이름은 바꾸지 않는다', () => {
    const onRenameTab = vi.fn()
    render(<PaneTabsMenu {...props} onRenameTab={onRenameTab} />)
    fireEvent.doubleClick(screen.getByRole('tab', { name: '전원' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: '노트 이름' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: '노트 이름' })).toBeNull()
    fireEvent.doubleClick(screen.getByRole('tab', { name: '전원' }))
    fireEvent.blur(screen.getByRole('textbox', { name: '노트 이름' }))
    fireEvent.doubleClick(screen.getByRole('tab', { name: '전원' }))
    const input = screen.getByRole('textbox', { name: '노트 이름' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onRenameTab).not.toHaveBeenCalled()
  })

  it('이름을 바꿀 수 없는 탭(PDF)은 두 번 눌러도 입력칸이 열리지 않는다', () => {
    render(<PaneTabsMenu {...props} state={one} onRenameTab={vi.fn()} />)
    fireEvent.doubleClick(screen.getByRole('tab', { name: 'HTTP Semantics Guide' }))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('노트를 막 만들었다는 요청(requestTitleEdit)이 오면 이름 칸이 바로 열린다', () => {
    render(<PaneTabsMenu {...props} onRenameTab={vi.fn()} />)
    expect(screen.queryByRole('textbox', { name: '노트 이름' })).toBeNull()
    act(() => requestTitleEdit('노트/전원.iwnote'))
    expect(within(document.body).getByRole('textbox', { name: '노트 이름' })).toBeDefined()
  })
})
