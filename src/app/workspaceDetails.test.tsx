// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PaneTabsMenu } from './PaneTabsMenu'
import { ScreenTabs } from './ScreenTabs'
import { fitEmptyPane } from './EmptyPane'
import { hasHiddenTabs, subFitsInTitle } from './tabStripOverflow'
import { floatBoxOnScreen, floatOutgrowsAnchor } from './floatingPanes'
import { relayoutMessage } from './workspaceCommands'
import { fitFormatClusters } from '../pdf/MemoEditor'
import { KeysHelpSheet } from './KeysHelpSheet'

afterEach(cleanup)

const css = (name: string) => readFileSync(join(__dirname, '../ui', name), 'utf8').split(String.fromCharCode(13)).join('')

describe('맨 위 화면 탭', () => {
  const screens = [{ id: 'a', name: '읽기' }, { id: 'b', name: '실험' }]
  const noop = vi.fn()
  const renderTabs = () => render(
    <ScreenTabs screens={screens} activeId="a" lastId="b" templates={[]} onSelect={noop} onRename={noop} onReorder={noop} onClose={noop} onNew={noop} />,
  )

  it('바로 앞 화면에 「-」 표시를 달지 않는다(아래 상태 줄은 없앴고, 표시는 어디에도 없다)', () => {
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

  it('색 점 · 번호는 머리 높이(--bar-h)의 세로 가운데에 서고, 점은 28px 높이의 누르는 자리에 8px 점이다', () => {
    const rules = css('workspace-surface.css')
    expect(rules).toMatch(/\.pane-head \.pane-tabs-menu > \.pane-channel-dot,[^{]*\{[^}]*align-self: center;[^}]*width: 20px; height: var\(--icon-btn\); margin: 0 0 0 -6px;/u)
    expect(rules).toMatch(/\.pane-head \.pane-tabs-menu > \.pane-head-number,[^{]*\{[^}]*align-self: center; display: inline-flex; align-items: center; height: var\(--icon-btn\); margin: 0 var\(--space-2\) 0 0; font-family: inherit; font-size: 12.5px; font-variant-numeric: tabular-nums;/u)
    expect(css('screens.css')).toContain('.pane-head .pane-channel-dot-mark { width: 8px; height: 8px; }')
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

  it('번역기 창은 앱 창 위에 고정되고 머리 줄은 --bar-h, 결과 칸은 최소 2줄이다', () => {
    const rules = css('translator-panel.css')
    expect(rules).toMatch(/\.translator-window \{[^}]*position: fixed;/u)
    expect(rules).toMatch(/\.translator-window-head \{[^}]*flex: 0 0 var\(--bar-h\);/u)
    expect(rules).toContain('.translator-panel-result:not(:empty) { min-height: 48px; }')
    expect(rules).toContain('.translator-panel-result:empty { height: 0; min-height: 0; padding: 0; overflow: hidden; }')
  })
})

describe('라운드 2', () => {
  it('키 도움말: 상태 칸이 없고(표는 3열) × 는 머리 오른쪽 끝이다', () => {
    render(<KeysHelpSheet onClose={vi.fn()} currentKeys={[]} />)
    expect(document.querySelectorAll('.keys-help-state')).toHaveLength(0)
    expect([...document.querySelectorAll('.keys-help-table th')].map((cell) => cell.textContent)).toEqual(['키', '동작', '명령'])
    const rules = css('keys-help.css')
    expect(rules).toContain('.keys-help .sko-close { margin-left: auto; }')
    expect(rules).not.toContain('nth-child(4)')
  })

  it('떠 있는 칸은 붙은 칸보다 크면(가로든 세로든) 화면 사각형에 가둔다', () => {
    const float = { x: 0.55, y: 0.05, w: 340, h: 300, collapsed: false }
    expect(floatOutgrowsAnchor(float, { width: 652, height: 430 })).toBe(false)
    expect(floatOutgrowsAnchor(float, { width: 652, height: 230 })).toBe(true)
    expect(floatOutgrowsAnchor(float, { width: 250, height: 800 })).toBe(true)
    expect(floatOutgrowsAnchor({ ...float, collapsed: true }, { width: 652, height: 100 })).toBe(false)
    // 아래 230px 칸에 붙은 번역기: 칸 위로 올라오되 화면 안에 있다
    const anchor = { left: 0, top: 600, width: 652, height: 230 }
    const box = floatBoxOnScreen(float, anchor, { width: 1300, height: 860 })
    expect(box.h).toBe(300)
    expect(box.y + box.h).toBeLessThanOrEqual(860)
    expect(box.x + box.w).toBeLessThanOrEqual(1300)
    // 250px 폭 칸: 폭을 줄이지 않고(340) 화면 오른쪽 가장자리 안에 둔다
    const narrow = floatBoxOnScreen({ ...float, x: 0.9 }, { left: 1100, top: 0, width: 250, height: 800 }, { width: 1300, height: 860 })
    expect(narrow.w).toBe(340)
    expect(narrow.x + narrow.w).toBe(1300)
  })

  it('배치 알림 글은 사람 말이다', () => {
    expect(relayoutMessage('even-horizontal')).toBe('배치: 나란히')
    expect(relayoutMessage('even-vertical')).toBe('배치: 위아래로')
    expect(relayoutMessage('main-vertical')).toBe('배치: 큰 칸 + 세로')
    expect(relayoutMessage('main-horizontal')).toBe('배치: 큰 칸 + 가로')
    expect(relayoutMessage('tiled')).toBe('배치: 바둑판')
  })

  it('서식 줄: 들어가는 만큼만 줄에 두고 나머지는 ⋯ 로, 첫 묶음은 늘 남는다', () => {
    const widths = [76, 170, 80, 170]
    expect(fitFormatClusters(widths, 600, 34)).toBe(4)
    expect(fitFormatClusters(widths, 400, 34)).toBe(3)
    expect(fitFormatClusters(widths, 300, 34)).toBe(2)
    expect(fitFormatClusters(widths, 130, 34)).toBe(1)
    expect(fitFormatClusters(widths, 10, 34)).toBe(1)
  })

  it('보조 글은 제목과 함께 통째로 들어갈 때만 보인다', () => {
    const make = (clientWidth: number, label: number, sub: number) => {
      const title = document.createElement('div')
      Object.defineProperty(title, 'clientWidth', { value: clientWidth })
      const part = (className: string, scroll: number, width: number) => {
        const element = document.createElement('span')
        element.className = className
        Object.defineProperty(element, 'scrollWidth', { value: scroll })
        element.getBoundingClientRect = () => ({ width }) as DOMRect
        title.append(element)
      }
      part('pane-top-tab-kind', 14, 14)
      part('pane-top-tab-label', label, label)
      part('pane-top-tab-sep', 4, 4)
      part('pane-top-tab-sub', sub, sub)
      return title
    }
    expect(subFitsInTitle(make(300, 94, 16))).toBe(true)
    expect(subFitsInTitle(make(120, 94, 16))).toBe(false)
    expect(subFitsInTitle(make(0, 94, 16))).toBe(true)
  })

  it('PDF 아래 막대는 좁으면 쪽 넘기기까지 ⋯ 로 접는다(쪽 입력 · ⋯ 만 남는다)', () => {
    const source = readFileSync(join(__dirname, 'PdfBottomBar.tsx'), 'utf8')
    expect(source).toContain("'zoomInput', 'zoomStep', 'pageStep']")
  })
})
