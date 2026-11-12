// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PaneTabsMenu } from './PaneTabsMenu'
import { ScreenTabs } from './ScreenTabs'
import { fitEmptyPane } from './EmptyPane'
import { hasHiddenTabs } from './tabStripOverflow'

afterEach(cleanup)

const css = (name: string) => readFileSync(join(__dirname, '../ui', name), 'utf8').split(String.fromCharCode(13)).join('')

describe('맨 위 화면 탭', () => {
  const screens = [{ id: 'a', name: '읽기' }, { id: 'b', name: '실험' }]
  const noop = vi.fn()
  const renderTabs = () => render(
    <ScreenTabs screens={screens} activeId="a" lastId="b" templates={[]} onSelect={noop} onRename={noop} onReorder={noop} onClose={noop} onNew={noop} />,
  )

  it('바로 앞 화면에 「-」 표시를 달지 않는다(상태 줄에만 있다)', () => {
    const { container } = renderTabs()
    expect(container.textContent).not.toContain('-')
    expect(container.querySelector('.screen-tab-mark')).toBeNull()
  })

  it('아이콘 없이 번호 + 이름만 있고, 번호는 이름과 같은 글꼴로 그린다', () => {
    const { container } = renderTabs()
    const tab = container.querySelector('[role="tab"]')!
    expect(tab.querySelector('svg')).toBeNull()
    expect([...tab.children].map((child) => child.className)).toEqual(['screen-tab-index', 'screen-tab-name'])
    const rule = /\.screen-tab-index \{([^}]*)\}/u.exec(css('screens.css'))?.[1] ?? ''
    expect(rule).toContain('font: inherit')
    expect(rule).not.toContain('mono')
  })
})

describe('칸 머리', () => {
  it('빈 칸 머리에는 「열린 탭 없음」 글자가 없다(점 · 번호만, 이름은 접근성 이름)', () => {
    const { container } = render(
      <PaneTabsMenu state={{ tabs: [], activeId: null }} label="탭" onActivate={vi.fn()} onClose={vi.fn()} onCycleChannel={vi.fn()} paneNumber={3} />,
    )
    expect(screen.queryByText('열린 탭 없음')).toBeNull()
    expect(container.querySelector('.pane-tabs-empty')).toBeNull()
    expect(container.querySelector('.pane-channel-dot')).not.toBeNull()
    expect(container.querySelector('.pane-head-number')?.textContent).toBe('3')
    expect(screen.getByRole('group', { name: '열린 탭 없음' })).toBeDefined()
  })

  it('탭이 하나뿐이면 넘침 표시(⌄ n)를 숨긴다', () => {
    const { container } = render(
      <PaneTabsMenu state={{ tabs: [{ id: 'a', title: 'A', kind: 'pdf' }], activeId: 'a' }} label="탭" onActivate={vi.fn()} onClose={vi.fn()} />,
    )
    expect(container.querySelector('.pane-tabs-overflow')?.classList.contains('pane-tabs-overflow-idle')).toBe(true)
  })

  it('색 점 · 번호는 탭 줄 바닥에 붙여 탭 제목과 세로 가운데를 맞추고, 간격은 6px 이다', () => {
    const rules = css('screens.css')
    expect(rules).toContain('.pane-head .pane-tabs-menu > .pane-channel-dot { align-self: flex-end; width: 14px; height: 25px; margin: 0 3px 4px 0; }')
    expect(rules).toContain('.pane-head .pane-tabs-menu > .pane-head-number { align-self: flex-end;')
    expect(rules).toContain('margin: 0 -4px 4px 0')
  })
})

/** 탭 줄(strip)과 탭들의 자리를 흉내 낸다(jsdom 은 레이아웃이 없다) */
function place(left: number, right: number): () => DOMRect {
  return () => ({ left, right, top: 0, bottom: 0, width: right - left, height: 0, x: left, y: 0, toJSON: () => ({}) })
}
function fakeStrip(box: { left: number; right: number }, tabs: ReadonlyArray<{ left: number; right: number }>, padding = 10): HTMLElement {
  const strip = document.createElement('div')
  strip.style.paddingLeft = `${padding}px`
  strip.style.paddingRight = `${padding}px`
  strip.getBoundingClientRect = place(box.left, box.right)
  for (const spot of tabs) {
    const tab = document.createElement('div')
    tab.className = 'pane-top-tab'
    tab.getBoundingClientRect = place(spot.left, spot.right)
    strip.append(tab)
  }
  return strip
}

describe('넘친 탭 판단(hasHiddenTabs)', () => {
  it('탭이 하나면 아무리 넓어도 숨겨진 탭이 아니다', () => {
    expect(hasHiddenTabs(fakeStrip({ left: 0, right: 150 }, [{ left: 10, right: 250 }]))).toBe(false)
  })
  it('탭이 다 들어가면 아니다(곡선 자리 여백은 빼고 잰다)', () => {
    expect(hasHiddenTabs(fakeStrip({ left: 0, right: 260 }, [{ left: 10, right: 130 }, { left: 130, right: 250 }]))).toBe(false)
  })
  it('마지막 탭이 줄 밖으로 나가면 가려진 탭이 있다', () => {
    expect(hasHiddenTabs(fakeStrip({ left: 0, right: 200 }, [{ left: 10, right: 130 }, { left: 130, right: 250 }]))).toBe(true)
  })
})

describe('빈 칸 높이 맞춤(fitEmptyPane)', () => {
  // 줄 31px · 「최근」 제목 33px
  it('들어가면 그대로 둔다', () => {
    expect(fitEmptyPane(400, 404, 4, 31, 33)).toEqual({ recents: 4, hint: true })
  })
  it('넘치면 「최근」 을 아래 줄부터 덜고 안내 줄은 남긴다', () => {
    expect(fitEmptyPane(440, 404, 4, 31, 33)).toEqual({ recents: 2, hint: true })
  })
  it('다 덜어도 넘치면 「최근」 제목도 안내 줄도 덜어 낸다', () => {
    expect(fitEmptyPane(406, 260, 3, 31, 33)).toEqual({ recents: 0, hint: false })
  })
})

describe('CSS 규칙', () => {
  it('상태 줄 접두키 칩은 다른 글자와 같은 11px 이고, 「·」 뒤 공백을 따로 두지 않는다', () => {
    const rules = css('screens.css')
    expect(rules).toMatch(/\.status-bar-prefix \{[^}]*font: inherit; font-size: 11px; line-height: 1;/u)
    expect(rules).toContain(".status-bar-panes::before { content: '·'; margin-right: 12px; }")
    expect(rules).not.toContain("content: '· '")
  })

  it('노트 도구줄 오른쪽 단추(검색 · ＋ · 접기)는 테두리가 없다', () => {
    const rule = /\.pane-doc \.memo-note-tab-actions \.pdf-memo-header-button \{([^}]*)\}/u.exec(css('memo-note-tab.css'))?.[1] ?? ''
    expect(rule).toContain('border: 0')
    expect(rule).toContain('background: transparent')
  })

  it('어두운 화면의 틈은 칸 바탕보다 어둡다(밝은 화면 규칙은 건드리지 않는다)', () => {
    const rules = css('screens.css')
    expect(rules).toContain(":root[data-theme='dark'] .panes.panes-tree {\n  background: var(--tabstrip, var(--workspace));")
    expect(rules).toContain(":root[data-theme='dark'] .panes-tree > .pane-grid-cell:not(.pane-float) { background: transparent; }")
  })

  it('글 블록도 메모 카드와 같은 종이 카드다', () => {
    expect(css('whale-theme.css')).toContain(':root :is(.pdf-memo-bar-body, .markdown-memo-bar-body) .pdf-memo-card-flow {')
    expect(css('note-ticket.css')).toContain('.note-block.pdf-memo-card-flow.note-text-card {')
  })

  it('소제목 아래 간격은 카드 사이(24px)보다 좁다', () => {
    expect(css('note-ticket.css')).toContain('.pane-doc .note-block.note-section + .note-gap { height: 14px; }')
  })

  it('원문 따옴표 색은 45% 이고 줄임 칩 글자에도 입힌다', () => {
    const wide = css('note-wide.css')
    expect(wide).toContain('color-mix(in srgb, var(--hlc-dot) 45%, transparent)')
    expect(wide).toContain(':is(.note-source-quote, .note-source-chip-text)')
  })

  it('「→ 문서」 링크는 원문 줄의 왼쪽 선에 맞추고 위 간격이 좁다', () => {
    expect(css('memo-note-tab.css')).toContain('margin: -3px 0 0 -6px;')
  })

  it('번역기 탭은 본문이 칸을 채우고 결과 칸은 최소 2줄이다', () => {
    const rules = css('translator-panel.css')
    expect(rules).toContain('.pane-body:has(> .translator-panel) { display: flex; flex-direction: column; }')
    expect(rules).toContain('.translator-panel-result { min-height: 48px; }')
  })
})
