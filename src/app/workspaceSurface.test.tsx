// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_ENABLED } from '../core/features'
import { paneNode, splitLeaf } from '../core/layoutTree'
import { InputSettings } from './BehaviorSettings'
import { FloatLayer } from './FloatLayer'
import { PaneCard } from './PaneCard'
import { PrefixChip } from './PrefixChip'
import { SplitPanes, snapRect } from './SplitPanes'
import { useOverlayToolShortcuts } from './PaneToolbar'
import { getOverlayTool, setOverlayTool } from '../pdf/overlayToolStore'
import { TopBarToolbar, TopBarToolbarContext, ownsTopBarToolbar } from './topBarToolbar'
import { PaneIdContext } from './workspaceContext'
import {
  REACTION_FLASH_MS, flashReaction, paneReactionOf, reactingPanes, resetPaneReaction, setHoverReaction, usePaneReaction, visiblePanesOf,
  type ReactionInput,
} from './paneReaction'
import type { PanesState } from './tabs'

afterEach(() => { cleanup(); resetPaneReaction(); vi.useRealTimers() })

const css = (name: string) => readFileSync(join(__dirname, '../ui', name), 'utf8').split(String.fromCharCode(13)).join('')
const rule = (source: string, selector: string) => {
  const at = source.indexOf(`${selector} {`)
  if (at < 0) return ''
  return source.slice(at, source.indexOf('}', at) + 1)
}

describe('아래 상태 줄 · 「⌘ 명령」 단추 · 접두키 칩', () => {
  it('접두키 칩은 대기(prefix · confirm) 중에만 그려지고 평소(idle)에는 아무것도 없다', () => {
    const { container, rerender } = render(<PrefixChip phase="idle" prefixText="Ctrl+B" confirmText="화면을 닫을까요? y/n" />)
    expect(container.firstChild).toBeNull()
    rerender(<PrefixChip phase="prefix" prefixText="Ctrl+B" confirmText="화면을 닫을까요? y/n" />)
    expect(screen.getByRole('status').textContent).toBe('Ctrl+B …')
    rerender(<PrefixChip phase="confirm" prefixText="Ctrl+B" confirmText="화면을 닫을까요? y/n" />)
    expect(screen.getByRole('status').textContent).toBe('화면을 닫을까요? y/n')
    rerender(<PrefixChip phase="idle" prefixText="Ctrl+B" confirmText="" />)
    expect(container.firstChild).toBeNull()
  })

  it('칩은 맨 위 줄 안에서 흐름 밖(절대 위치)이라 나타나도 도구줄이 줄지 않고, 칸 위를 덮지 않는다. UI 글꼴 키캡 · 높이 24 · 줄 가운데 · 눌리지 않음 · 움직임 없음', () => {
    const chip = css('prefix-chip.css')
    const body = rule(chip, '.prefix-chip')
    expect(body).toContain('position: absolute;')
    expect(body).toContain('top: 50%;')
    expect(body).toContain('height: 24px;')
    expect(body).toContain('font-family: inherit;')
    expect(body).not.toMatch(/monospace|fixed/u)
    expect(body).toContain('pointer-events: none;')
    expect(chip).toContain('.topbar-session-row { position: relative; }')
    expect(chip).not.toMatch(/transition|animation|@keyframes/u)
  })

  it('상태 줄 파일 · 설정 토글이 없다', () => {
    expect(() => readFileSync(join(__dirname, 'StatusBar.tsx'))).toThrow()
    expect(() => readFileSync(join(__dirname, '../ui/status-bar.css'))).toThrow()
    render(<InputSettings />)
    expect(screen.queryByText('아래 상태 줄')).toBeNull()
    expect(readFileSync(join(__dirname, 'appPrefs.ts'), 'utf8')).not.toContain('statusBar')
  })

  it('사이드바 보기 탭 규칙을 덮지 않는다', () => {
    expect(css('workspace-surface.css')).not.toContain('topbar-side-tabs')
    expect(css('whale-theme.css')).toContain('border-radius: var(--r-md) var(--r-md) 0 0;')
  })

  it('맨 위 줄 아래에 경계선이 없다', () => {
    const surface = css('workspace-surface.css')
    expect(rule(surface, '.topbar')).toContain('border-bottom: 0;')
  })
})

describe('만지는 칸 · 채널 가장자리 · 빈 칸 (PaneCard)', () => {
  it('만지는 칸은 pane-card-active, 채널은 data-channel, 채널 없음은 none(가장자리 없음), 빈 칸은 data-empty', () => {
    const { container, rerender } = render(<PaneCard paneId="a" channel="green" active empty>x</PaneCard>)
    const card = container.querySelector('.pane-card') as HTMLElement
    expect(card.classList.contains('pane-card-active')).toBe(true)
    expect(card.dataset.channel).toBe('green')
    expect(card.hasAttribute('data-empty')).toBe(true)
    rerender(<PaneCard paneId="a" channel={null} active={false}>x</PaneCard>)
    expect(card.classList.contains('pane-card-active')).toBe(false)
    expect(card.dataset.channel).toBe('none')
    expect(card.hasAttribute('data-empty')).toBe(false)
  })

  describe('누르면 그 칸을 만지는 칸으로 — 왼쪽 단추 · 아직 만지지 않은 칸만, 탭 끌기는 놓을 때', () => {
    const press = (target: Element, init: PointerEventInit = {}) => fireEvent.pointerDown(target, { button: 0, clientX: 10, clientY: 10, ...init })
    const setup = (active = false) => {
      const onFocusPane = vi.fn()
      const { container } = render(
        <PaneCard paneId="a" channel="blue" active={active} onFocusPane={onFocusPane}>
          <div role="tab" aria-label="탭">탭</div>
          <p>본문</p>
        </PaneCard>,
      )
      return { onFocusPane, container }
    }

    it('왼쪽 단추로 본문을 누르면 그 칸이 된다', () => {
      const { onFocusPane } = setup()
      press(screen.getByText('본문'))
      expect(onFocusPane).toHaveBeenCalledExactlyOnceWith('a')
    })

    it('오른쪽 · 가운데 클릭은 칸을 바꾸지 않는다', () => {
      const { onFocusPane } = setup()
      press(screen.getByText('본문'), { button: 2 })
      press(screen.getByText('본문'), { button: 1 })
      expect(onFocusPane).not.toHaveBeenCalled()
    })

    it('이미 만지는 칸이면 누를 때마다 다시 하지 않는다', () => {
      const { onFocusPane } = setup(true)
      press(screen.getByText('본문'))
      press(screen.getByRole('tab'))
      fireEvent.pointerUp(window, { clientX: 10, clientY: 10 })
      expect(onFocusPane).not.toHaveBeenCalled()
    })

    it('탭을 눌러 끌기 시작하면 끄는 동안 칸을 바꾸지 않는다(상단바 도구줄이 흔들리지 않게). 끌지 않고 놓으면 그때 바꾼다', () => {
      const { onFocusPane } = setup()
      press(screen.getByRole('tab'))
      expect(onFocusPane).not.toHaveBeenCalled()
      fireEvent.pointerMove(window, { clientX: 60, clientY: 12 })
      fireEvent.pointerUp(window, { clientX: 60, clientY: 12 })
      expect(onFocusPane).not.toHaveBeenCalled()
      // 같은 자리에서 놓은 누름
      press(screen.getByRole('tab'))
      fireEvent.pointerMove(window, { clientX: 11, clientY: 11 })
      fireEvent.pointerUp(window, { clientX: 11, clientY: 11 })
      expect(onFocusPane).toHaveBeenCalledExactlyOnceWith('a')
    })

    it('탭 누름을 취소(pointercancel)하면 칸을 바꾸지 않고, 놓은 뒤 남는 리스너도 없다', () => {
      const { onFocusPane } = setup()
      press(screen.getByRole('tab'))
      fireEvent.pointerCancel(window)
      fireEvent.pointerUp(window, { clientX: 10, clientY: 10 })
      expect(onFocusPane).not.toHaveBeenCalled()
    })
  })

  it('SplitPanes: 칸이 여럿이면 만지는 칸 카드만 active, 칸이 하나면 강조하지 않는다. 칸마다 채널 · 빈 칸이 카드에 달린다', () => {
    const root = splitLeaf(paneNode('a'), 'a', 'h', 'b')
    const view = (activePane: string, r = root) => (
      <SplitPanes
        sidebar={null} topBar={() => null} sidebarCollapsed={false} root={r} renderPane={(id) => <p>{id}</p>}
        paneChannel={(id) => (id === 'a' ? 'blue' : null)} paneEmpty={(id) => id === 'b'} activePane={activePane}
      />
    )
    const { container, rerender } = render(view('b'))
    const cards = () => [...container.querySelectorAll<HTMLElement>('.pane-card')]
    expect(cards().map((card) => card.classList.contains('pane-card-active'))).toEqual([false, true])
    expect(cards().map((card) => card.dataset.channel)).toEqual(['blue', 'none'])
    expect(cards().map((card) => card.hasAttribute('data-empty'))).toEqual([false, true])
    rerender(view('a'))
    expect(cards().map((card) => card.classList.contains('pane-card-active'))).toEqual([true, false])
    rerender(view('a', paneNode('a')))
    expect(cards().map((card) => card.classList.contains('pane-card-active'))).toEqual([false])
  })

  it('떠 있는 칸 카드도 같은 껍질(채널 · 만지는 칸)을 쓴다', () => {
    const { container } = render(
      <FloatLayer
        floats={[{ paneId: 'f', anchor: { kind: 'screen' }, x: 0.1, y: 0.1, w: 300, h: 200, collapsed: false }]}
        anchorRect={() => ({ left: 0, top: 0, width: 800, height: 600 })}
        epoch={0} renderHead={() => null} renderBody={() => null} onChange={() => undefined} onRaise={() => undefined}
        paneChannel={() => 'orange'} isActive={() => true}
      />,
    )
    const card = container.querySelector('.pane-float .pane-card') as HTMLElement
    expect(card.classList.contains('pane-card-active')).toBe(true)
    expect(card.dataset.channel).toBe('orange')
  })

  it('CSS: 칸 테두리는 층이 아니라 하나다 — 1.5px, 채널 색 35%(쉼) → 100%(만짐 · 반응), 채널 없음은 --divider → --accent. ::before 띠 · ::after 윤곽은 없다', () => {
    const surface = css('workspace-surface.css')
    expect(surface).toContain('--pane-edge-w: 1.5px;')
    expect(rule(surface, '.panes-tree .pane-card')).toContain('border: var(--pane-edge-w) solid var(--pane-c);')
    expect(surface).toContain('.pane-card { --pane-c: var(--divider); --pane-c-strong: var(--accent); }')
    for (const channel of ['blue', 'green', 'orange']) {
      expect(surface).toContain(".pane-card[data-channel='" + channel + "'] { --pane-c: color-mix(in srgb, var(--channel-" + channel + ") 35%, transparent); --pane-c-strong: var(--channel-" + channel + "); }")
    }
    expect(surface).toContain('.panes-tree .pane-card:is(.pane-card-active, [data-reacting]) { border-color: var(--pane-c-strong); }')
    expect(surface).not.toMatch(/\.pane-card::(before|after)/u)
    expect(surface).not.toMatch(/transition|animation|@keyframes/u)
    // 끌기 중에는 반응 표시가 쉬는 색으로 돌아간다
    expect(surface).toMatch(/body\.pane-tab-dragging[^{]*\.pane-card\[data-reacting\]:not\(\.pane-card-active\) \{ border-color: var\(--pane-c\); \}/u)
    // 칸 번호는 UI 글꼴(고정폭 글꼴 아님) · 숫자 폭 고정
    expect(surface).toMatch(/pane-head-number,[^{]*\{[^}]*font-family: inherit;[^}]*tabular-nums/u)
  })

  it('틀(카드 + 머리)은 한 색이고, 본문(문서 · 노트 · 아래 막대)은 머리 아래 4px 만 띄우고 좌 · 우 · 아래는 카드 가장자리까지 꽉 찬다. 머리 아래 선이 없다', () => {
    const surface = css('workspace-surface.css')
    expect(surface).toContain('--pane-surface: var(--paper);')
    expect(surface).toContain('--pane-body: var(--workspace);')
    const body = rule(surface, '.panes-tree .pane-grid-body')
    expect(body).toContain('margin: var(--space-1) 0 0;')
    expect(body).toContain('background: var(--pane-body);')
    expect(body).not.toMatch(/border|radius|overflow/u)
    expect(rule(css('screens.css'), '.panes-tree .pane-card')).toContain('overflow: hidden;')
    expect(rule(surface, '.panes-tree .pane-grid-tabs.topbar-panetab-zone.pane-head')).toContain('background: var(--pane-surface);')
    expect(rule(surface, '.panes-tree .pane-grid-tabs.topbar-panetab-zone.pane-head')).toContain('border-bottom: 0;')
    expect(surface).toMatch(/\.pane-bottom-bar \{[^}]*border: 0;[^}]*background: var\(--pane-body\);[^}]*box-shadow: none;/u)
  })
})

describe('한 높이 표준 --bar-h', () => {
  it('토큰: 상단바 · 칸 탭 줄 · 아래 막대가 모두 --bar-h(36px)', () => {
    const tokens = css('tokens.css')
    expect(tokens).toContain('--bar-h: 36px;')
    expect(tokens).toContain('--icon-btn: 28px;')
    expect(tokens).toContain('--icon-size: 16px;')
    // 별칭 토큰(--topbar-h · --toolbar-height · --tabbar-h · --bottom-bar-height)은 없다: 모두 --bar-h 를 바로 쓴다
    for (const alias of ['--topbar-h', '--toolbar-height', '--tabbar-h', '--bottom-bar-height']) expect(tokens).not.toContain(`${alias}:`)
    expect(tokens).toContain('--pane-gap: 6px;')
  })

  it('상단바 · 칸 탭 줄 · 아래 막대(PDF · MD)가 --bar-h 를 쓴다', () => {
    const surface = css('workspace-surface.css')
    expect(rule(surface, '.topbar')).toContain('height: var(--bar-h);')
    expect(rule(surface, '.panes-tree .pane-grid-tabs.topbar-panetab-zone.pane-head')).toMatch(/flex: 0 0 var\(--bar-h\);[^}]*height: var\(--bar-h\);/u)
    expect(surface).toMatch(/\.pane-bottom-bar \{[^}]*flex: 0 0 var\(--bar-h\);[^}]*height: var\(--bar-h\);/u)
    // 아래 막대의 자리 · 높이 · 여백은 workspace-surface.css 의 이 한 규칙뿐이다(다른 파일에 같은 선택자가 없어 불러오는 순서로 뒤집히지 않는다)
    for (const name of readdirSync(join(process.cwd(), 'src/ui')).filter((file) => file.endsWith('.css') && file !== 'workspace-surface.css')) {
      expect(css(name), name).not.toMatch(/(^|[\s,}])\.pane-bottom-bar\s*[,{]|\.pane-doc\s+\.pane-bottom-bar\s*[,{]/u)
    }
  })

  it('사이드바 보기 탭은 탭 모양(whale-theme)을 그대로 두고 이 파일은 건드리지 않는다. 막대 안 아이콘 단추는 28px · 16px 이다', () => {
    const surface = css('workspace-surface.css')
    expect(surface).toContain('.pane-head .pane-head-more { width: var(--icon-btn); height: var(--icon-btn); margin: 0; }')
    expect(surface).toContain('.pane-head .pane-head-more svg { width: var(--icon-size); height: var(--icon-size); }')
    expect(surface).toContain('.winbtn { width: var(--icon-btn); height: var(--icon-btn); }')
    expect(surface).toContain('.pane-bottom-bar button svg { width: var(--icon-size); height: var(--icon-size); }')
  })

  it('칸 사이 틈과 바깥 여백은 --pane-gap 한 값(칸 영역 테두리 반쪽 + 칸 안쪽 여백 반쪽)', () => {
    const screens = css('screens.css')
    expect(screens).toContain('border: calc(var(--pane-gap) / 2) solid var(--workspace);')
    expect(screens).toContain('padding: calc(var(--pane-gap) / 2);')
  })
})

describe('상단바 도구줄 자리 — 만지는 칸의 도구줄만', () => {
  const Probe = ({ pane, label }: { readonly pane: string; readonly label: string }) => (
    <PaneIdContext.Provider value={pane}>
      <section data-testid={`pane-${pane}`}><TopBarToolbar><button type="button">{label}</button></TopBarToolbar></section>
    </PaneIdContext.Provider>
  )
  const Host = ({ active }: { readonly active: string | null }) => {
    const [slot, setSlot] = useState<HTMLElement | null>(null)
    return (
      <TopBarToolbarContext.Provider value={{ element: slot, activePane: active }}>
        <div data-testid="slot" ref={setSlot} />
        <Probe pane="pdf" label="PDF 도구" />
        <Probe pane="note" label="노트 서식" />
        <Probe pane="empty" label="없어야 함" />
      </TopBarToolbarContext.Provider>
    )
  }

  it('순수 판단: 만지는 칸 자신일 때만', () => {
    expect(ownsTopBarToolbar('a', 'a')).toBe(true)
    expect(ownsTopBarToolbar('a', 'b')).toBe(false)
    expect(ownsTopBarToolbar(null, 'a')).toBe(false)
    expect(ownsTopBarToolbar('a', null)).toBe(false)
  })

  it('PDF 칸이 만지는 칸이면 PDF 도구가, 노트 칸이면 노트 서식 줄이 상단바 자리에 그려지고 다른 칸 것은 없다', () => {
    const { rerender } = render(<Host active="pdf" />)
    const slot = screen.getByTestId('slot')
    expect([...slot.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['PDF 도구'])
    expect(screen.getByTestId('pane-pdf').querySelector('button')).toBeNull()
    rerender(<Host active="note" />)
    expect([...slot.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['노트 서식'])
  })

  it('도구줄이 없는 칸(빈 칸 · 캔버스)이 만지는 칸이면 자리가 비어 있다. 만지는 칸이 없어도 같다', () => {
    const { rerender } = render(<Host active="canvas" />)
    expect(screen.getByTestId('slot').children).toHaveLength(0)
    rerender(<Host active={null} />)
    expect(screen.getByTestId('slot').children).toHaveLength(0)
  })

  it('상단바 자리가 없으면(문맥 없음) 아무것도 그리지 않는다 — 호출한 쪽이 칸 안에 직접 둔다', () => {
    const { container } = render(<Probe pane="pdf" label="PDF 도구" />)
    expect(container.querySelector('button')).toBeNull()
  })

  it('포털이라 React 상태와 키보드 초점이 그대로다(단추를 눌러 값이 바뀐다)', () => {
    const onClick = vi.fn()
    const Live = () => (
      <PaneIdContext.Provider value="pdf"><TopBarToolbar><button type="button" onClick={onClick}>도구</button></TopBarToolbar></PaneIdContext.Provider>
    )
    const slot = document.createElement('div')
    document.body.append(slot)
    render(<TopBarToolbarContext.Provider value={{ element: slot, activePane: 'pdf' }}><Live /></TopBarToolbarContext.Provider>)
    const button = slot.querySelector('button') as HTMLButtonElement
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
    slot.remove()
  })

  it('한 글자 단축키(T · P · …)는 도구줄이 아니라 문서 칸이 받는다: 도구줄이 상단바에 없어도 편집 도구가 고른다', () => {
    const onMode = vi.fn()
    const Keys = ({ enabled }: { readonly enabled: boolean }) => { useOverlayToolShortcuts(enabled, onMode); return null }
    setOverlayTool('text')
    const { rerender } = render(<Keys enabled={false} />)
    fireEvent.keyDown(window, { key: 'p' })
    expect(onMode).not.toHaveBeenCalled()
    rerender(<Keys enabled />)
    fireEvent.keyDown(window, { key: 'p' })
    expect(onMode).toHaveBeenCalledWith('edit')
    expect(getOverlayTool()).toBe('pen')
    // 글 쓰는 칸 안에서는 받지 않는다
    onMode.mockClear()
    const field = document.createElement('input')
    document.body.append(field)
    fireEvent.keyDown(field, { key: 'e' })
    expect(onMode).not.toHaveBeenCalled()
    field.remove()
  })

  it('CSS: 도구줄 자리는 화면 탭 뒤 남는 폭을 쓰고 넘치면 스스로 접는다(overflow hidden), 노트 서식 줄의 띠는 없다', () => {
    const surface = css('workspace-surface.css')
    const slot = rule(surface, '.topbar-toolbar-host > .topbar-toolbar-slot.pane-toolbar')
    expect(slot).toContain('position: static;')
    expect(slot).toContain('overflow: hidden;')
    expect(slot).toContain('min-width: 0;')
    // 도구줄 자리는 칸 안 도구줄의 .pane-doc 별칭을 빌려 오지 않고 자기 규칙을 가진다
    expect(rule(surface, '.topbar-toolbar-host')).toContain('flex: 1 1 0;')
    expect(surface).not.toContain('.topbar-toolbar-host.pane-doc')
    const dock = rule(surface, '.topbar-toolbar-host .note-format-dock')
    // 노트 서식 줄은 상단바 한 줄: 접착(sticky) · 아래 선 · 바탕 · 높이 띠가 없다
    expect(dock).not.toContain('sticky')
    expect(dock).toContain('border: 0;')
    expect(dock).toContain('background: transparent;')
  })

  it('칸 안의 도구줄 띠가 없다: 문서 위 도구줄(--doc-head-h)은 0px', () => {
    expect(css('workspace-surface.css')).toContain('.pane-doc { --doc-card-h: var(--bar-h); --doc-head-h: 0px;')
  })
})

describe('칸 사각형은 정수 픽셀이다', () => {
  const size = { width: 1285, height: 951 }
  it('가장자리를 각각 반올림해 이웃한 칸이 같은 경계를 쓴다(틈 · 겹침 없음), 크기를 모르면 null', () => {
    const cols = (n: number) => Array.from({ length: n }, (_, i) => snapRect({ x: i / n, y: 0, w: 1 / n, h: 1 }, size)!)
    for (const n of [2, 3, 6]) {
      const rects = cols(n)
      for (const rect of rects) expect([rect.left, rect.width, rect.top, rect.height].every(Number.isInteger)).toBe(true)
      rects.slice(1).forEach((rect, i) => expect(rect.left).toBe(rects[i]!.left + rects[i]!.width))
      expect(rects[n - 1]!.left + rects[n - 1]!.width).toBe(size.width)
    }
    expect(snapRect({ x: 0, y: 0, w: 1, h: 1 }, { width: 0, height: 0 })).toBeNull()
  })
})

describe('머리의 빈 곳을 눌러도 그 칸이 만지는 칸이 된다', () => {
  it('SplitPanes: 카드(머리 포함) 어디든 pointerdown 이면 onFocusPane(칸 id)', () => {
    const onFocusPane = vi.fn()
    const { container } = render(
      <SplitPanes sidebar={null} topBar={() => null} sidebarCollapsed={false} root={splitLeaf(paneNode('a'), 'a', 'h', 'b')} renderPane={(id) => <p>{id}</p>}
        renderHead={(id) => <span data-testid={'head-' + id}>머리 {id}</span>} onFocusPane={onFocusPane} />,
    )
    const heads = container.querySelectorAll<HTMLElement>('.pane-head')
    fireEvent.pointerDown(heads[1]!)
    expect(onFocusPane).toHaveBeenLastCalledWith('b')
    fireEvent.pointerDown(heads[0]!)
    expect(onFocusPane).toHaveBeenLastCalledWith('a')
  })

  it('떠 있는 칸도 같다(빈 칸 포함: 카드 전체가 대상이다)', () => {
    const onFocusPane = vi.fn()
    const { container } = render(
      <FloatLayer
        floats={[{ paneId: 'f', anchor: { kind: 'screen' }, x: 0.1, y: 0.1, w: 300, h: 200, collapsed: false }]}
        anchorRect={() => ({ left: 0, top: 0, width: 800, height: 600 })}
        epoch={0} renderHead={() => <i data-testid="fhead" />} renderBody={() => null} onChange={() => undefined} onRaise={() => undefined}
        onFocusPane={onFocusPane} paneEmpty={() => true}
      />,
    )
    fireEvent.pointerDown(screen.getByTestId('fhead'))
    expect(onFocusPane).toHaveBeenCalledWith('f')
    expect(container.querySelector('.pane-card')?.hasAttribute('data-empty')).toBe(true)
  })
})

describe('칸 반응 표시 — 어느 창이 반응하는가', () => {
  const tab = (id: string, kind: 'pdf' | 'markdown' | 'memoNote' | 'canvas') => ({ tabs: [{ id, title: id, kind }], activeId: id })
  const base = (over: Partial<ReactionInput> = {}): ReactionInput => {
    const panes: PanesState = { doc: tab('d1', 'pdf'), note: tab('n1.iwnote', 'memoNote'), other: tab('d2', 'pdf'), md: tab('m.md', 'markdown'), blank: { tabs: [], activeId: null } }
    return {
      from: 'note',
      target: { kind: 'memo', memoId: 'h1' },
      visible: ['doc', 'note', 'other', 'md', 'blank'],
      panes,
      channels: { doc: 'blue', note: 'blue', other: 'blue', md: 'blue', blank: 'blue' },
      notesOf: (id) => (id === 'h1' ? ['n1.iwnote'] : []),
      docIdOfMemo: (id) => (id === 'h1' ? 'd1' : null),
      ...over,
    }
  }

  it('같은 채널에서 그 메모의 문서를 보여 주는 창만 반응한다(보낸 창 · 다른 문서 · 빈 칸은 아니다)', () => {
    expect(reactingPanes(base())).toEqual(['doc'])
  })

  it('문서에서 누르면(보낸 창 = 문서) 그 메모가 든 노트를 보는 창이 반응한다', () => {
    expect(reactingPanes(base({ from: 'doc' }))).toEqual(['note'])
    // 어느 노트인지 정해진 신호는 그 노트만
    expect(reactingPanes(base({ from: 'doc', target: { kind: 'memo', memoId: 'h1', notePath: 'else.iwnote' } }))).toEqual([])
  })

  it('채널이 다르면 반응하지 않고, 보낸 창의 채널이 없으면 아무도 없다', () => {
    expect(reactingPanes(base({ channels: { doc: 'green', note: 'blue', other: 'blue', md: 'blue', blank: 'blue' } }))).toEqual([])
    expect(reactingPanes(base({ channels: { doc: 'blue', note: null, other: 'blue', md: 'blue', blank: 'blue' } }))).toEqual([])
  })

  it('위치 신호(AI · 검색)는 그 문서를 보는 문서 창만, Markdown 도 문서다', () => {
    const input = base({ target: { kind: 'place', docId: 'm.md', page: 0 } })
    expect(reactingPanes(input)).toEqual(['md'])
    expect(reactingPanes(base({ from: 'doc', target: { kind: 'place', docId: 'd1', page: 2 } }))).toEqual([])
  })

  it('캔버스는 이어진 블록이 있을 때만(캔버스가 꺼져 있으면 함수를 주지 않아 늘 아니다)', () => {
    const panes: PanesState = { doc: tab('d1', 'pdf'), canvas: tab('c.canvas', 'canvas') }
    const input = base({ from: 'doc', panes, visible: ['doc', 'canvas'], channels: { doc: 'blue', canvas: 'blue' } })
    expect(reactingPanes(input)).toEqual([])
    expect(reactingPanes({ ...input, canvasShowsMemo: (pane) => pane === 'canvas' })).toEqual(['canvas'])
  })

  it('보이는 칸은 트리의 칸 차례 뒤에 떠 있는 칸', () => {
    expect(visiblePanesOf(splitLeaf(paneNode('a'), 'a', 'h', 'b'), ['f'])).toEqual(['a', 'b', 'f'])
  })

  it('마우스 올림(hover): 켜고 끄기만 한다. 같은 값이면 다시 알리지 않는다', () => {
    const Probe = ({ pane }: { readonly pane: string }) => <i data-testid={pane} data-r={usePaneReaction(pane) ?? ''} />
    render(<><Probe pane="a" /><Probe pane="b" /></>)
    expect(screen.getByTestId('a').dataset.r).toBe('')
    act(() => setHoverReaction(new Map([['a', 'blue' as const]])))
    expect(screen.getByTestId('a').dataset.r).toBe('blue')
    expect(screen.getByTestId('b').dataset.r).toBe('')
    act(() => setHoverReaction(null))
    expect(screen.getByTestId('a').dataset.r).toBe('')
    expect(paneReactionOf('a')).toBeNull()
  })

  it('신호가 실제로 움직인 창: 0.6초 동안만 윤곽, 그 뒤 바로 사라진다(채널 없음은 켜지 않는다)', () => {
    vi.useFakeTimers()
    expect(REACTION_FLASH_MS).toBe(600)
    flashReaction('a', null)
    expect(paneReactionOf('a')).toBeNull()
    flashReaction('a', 'green')
    expect(paneReactionOf('a')).toBe('green')
    act(() => { vi.advanceTimersByTime(599) })
    expect(paneReactionOf('a')).toBe('green')
    act(() => { vi.advanceTimersByTime(2) })
    expect(paneReactionOf('a')).toBeNull()
  })

  it('PaneCard 가 반응 색을 data-reacting 으로 단다', () => {
    const { container } = render(<PaneCard paneId="a" channel="blue" active={false}>x</PaneCard>)
    const card = container.querySelector('.pane-card') as HTMLElement
    expect(card.hasAttribute('data-reacting')).toBe(false)
    act(() => setHoverReaction(new Map([['a', 'blue' as const]])))
    expect(card.dataset.reacting).toBe('blue')
  })
})

describe('캔버스는 지금 꺼져 있다', () => {
  it('기능 스위치 · Rust 스위치가 꺼져 있다(코드는 남아 있다)', () => {
    expect(CANVAS_ENABLED).toBe(false)
    expect(readFileSync(join(__dirname, '../../src-tauri/src/mcp/canvas_tools.rs'), 'utf8')).toContain('pub const ENABLED: bool = false;')
    expect(readFileSync(join(__dirname, 'NoteCanvas.tsx'), 'utf8').length).toBeGreaterThan(1000)
  })
})

describe('애니메이션 정리', () => {
  const motion = () => css('motion.css')
  it('연결선은 다시 그려지지 않는다(motion-draw 없음)', () => {
    expect(motion()).not.toContain('motion-draw')
    expect(motion()).not.toMatch(/\.pdf-memo-link-active[^{]*\{[^}]*animation/u)
  })

  it('튀는 선택 · 메뉴 스프링이 없다: motion-select-pop · motion-pop-move 는 어디에도 없고 노트 블록 선택은 120ms 페이드', () => {
    for (const file of ['motion.css', 'note-ticket-pick.css', 'page-edit.css', 'theme-layout.css']) {
      expect(css(file), file).not.toMatch(/motion-select-pop|motion-pop-move/u)
    }
    expect(motion()).toContain('.note-block.note-block-selected { animation: motion-fade-in var(--motion-fast) ease-out backwards; }')
    expect(motion()).toMatch(/:is\(\.app-context-menu[^)]*\.note-switch-menu[^)]*\) \{\n  animation: motion-fade-in var\(--motion-fast\) ease-out backwards;/u)
  })

  it('형광펜 깜빡임은 400ms 한 번, 도톰한 선이 가라앉는다', () => {
    const layout = css('theme-layout.css')
    expect(layout).toContain('.selection-persistent-highlight.selection-highlight-flash { animation: selection-highlight-flash 400ms ease-out 1; }')
    expect(layout).toMatch(/@keyframes selection-highlight-flash \{\n  from \{ stroke-width: 5px; \}\n  to \{ stroke-width: 1\.5px; \}/u)
  })

  it('탭 끌기는 넘치지 않는 ease-out(스프링 없음), pane-appear · pane-grow-in 은 없다', () => {
    const drag = css('tab-drag.css')
    expect(drag).not.toContain('@keyframes pane-grow-in')
    expect(css('layout-transitions.css')).not.toContain('pane-appear')
    expect(drag).not.toMatch(/pane-grow-in 230ms/u)
    const dragMotion = motion().slice(motion().indexOf('/* 탭 끌기:'), motion().indexOf('/* ================= 전체 동작 줄이기'))
    expect(dragMotion).not.toMatch(/spring/u)
    expect(dragMotion).toContain('var(--ease-out)')
  })

  it('동작 줄이기(prefers-reduced-motion)는 전체에 걸려 있다', () => {
    expect(motion()).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \*, \*::before, \*::after \{\n    animation-duration: 0\.01ms !important;/u)
  })
})

describe('CSS 정리: 옛 크롬 탭 규칙을 이기려던 선택자 사슬 · 별칭이 없다', () => {
  const all = readdirSync(join(process.cwd(), 'src/ui')).filter((name) => name.endsWith('.css')).map((name) => [name, css(name)] as const)

  it('칸 머리 알약 탭 규칙은 보통 선택자다(.pane-head.pane-head 사슬 없음) · 옛 「상단 탭: 크롬 브라우저 모양」 규칙은 걷어 냈다', () => {
    for (const [name, text] of all) {
      expect(text, name).not.toMatch(/\.pane-head\.pane-head/u)
      expect(text, name).not.toContain('상단 탭: 크롬 브라우저 모양')
      expect(text, name).not.toMatch(/\.topbar-panetab-zone\s+\.pane-tabs-menu\s+\.pane-top-tab/u)
    }
    expect(css('workspace-surface.css')).toContain('.pane-head .pane-top-tab {')
  })

  it('색 · 높이 토큰의 옛 별칭을 쓰는 곳이 없다', () => {
    for (const [name, text] of all) expect(text, name).not.toMatch(/var\(--(?:topbar-h|toolbar-height|tabbar-h|bottom-bar-height)\)/u)
  })
})

describe('D1 · 노트 서식 줄과 노트 단추 묶음은 한 덩어리로 왼쪽에 붙는다', () => {
  it('묶음은 서식 단추 바로 뒤(구분선 1×16px)에 이어 붙고 오른쪽 끝으로 밀리지 않으며, 남는 자리는 묶음 뒤에 온다', () => {
    const surface = css('workspace-surface.css')
    const actions = rule(surface, '.topbar-toolbar-host .memo-note-tab-actions')
    expect(actions).not.toContain('margin-left: auto')
    expect(actions).toContain('margin-left: var(--space-2);')
    expect(rule(surface, '.topbar-toolbar-host .memo-note-tab-actions::before')).toContain('width: 1px; height: 16px;')
    // 서식 줄은 내용 폭만큼만(남는 자리를 먹지 않는다), 도구줄이 남는 자리를 갖는다
    expect(surface).toMatch(/\.topbar-toolbar-host \.note-format-dock \.pdf-memo-format-bar \{[^}]*flex: 0 1 auto;/u)
    expect(surface).toContain('.topbar-toolbar-host .note-format-dock > :is(.note-format-slot, .pdf-memo-format-bar) { flex: 0 1 auto; min-width: 0; }')
  })

  it('접두키 칩 글은 점 셋(...)이 아니라 말줄임표 한 글자(…)다', () => {
    const { container } = render(<PrefixChip phase="prefix" prefixText="Ctrl+B" confirmText="" />)
    const text = container.querySelector('.prefix-chip')!.textContent!
    expect(text).toBe('Ctrl+B …')
    expect(text).not.toContain('...')
    expect(text.codePointAt(text.length - 1)).toBe(0x2026)
  })
})

describe('D2 · 좁은 탭도 알약으로 읽힌다', () => {
  it('탭 폭 76px 이하: 다른 탭은 아이콘만 · 보는 탭은 × 만 남고, 아이콘만 남은 탭은 알약 바탕(옅은 바탕 · 올리면 진하게)을 가진다. 탭 최소 폭 40px', () => {
    const surface = css('workspace-surface.css')
    const query = surface.slice(surface.indexOf('@container (max-width: 76px) {'))
    const block = query.slice(0, query.indexOf('\n}\n'))
    expect(block).toContain('.pane-head .pane-top-tab-label { display: none; }')
    expect(block).toMatch(/\.pane-top-tab:not\(\.pane-top-tab-active\) \.pane-top-tab-title \{[^}]*border-radius: var\(--r-sm\);[^}]*background: color-mix\(in srgb, var\(--text-strong\) 5%, transparent\)/u)
    expect(block).toMatch(/:not\(\.pane-top-tab-active\):hover \.pane-top-tab-title \{[^}]*9%/u)
    expect(rule(surface, '.pane-head .pane-top-tab')).toMatch(/min-width: 40px;/u)
    expect(rule(surface, '.pane-head .pane-top-tab')).toMatch(/height: var\(--icon-btn\);/u)
  })
})
