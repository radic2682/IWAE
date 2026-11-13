// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReleaseNote } from '../../core/releaseNotes'
import { PrefixKeyHost } from '../workspace/PrefixKeyDialog'
import { resolveTourTarget, TourHost, TourOverlay } from './TourHost'
import { WhatsNewHost } from './WhatsNewDialog'
import { setAppPref } from '../appPrefs'
import { resetStartupDialogs } from './startupDialogs'
import { captureInstallSnapshot, readToursSeen, requestTour, resetTourState, TOURS_SEEN_KEY } from './tourState'
import { tourById } from '../../core/tours'

const notes: readonly ReleaseNote[] = [
  { version: '0.2.0', date: null, body: '- twenty thing' },
  { version: '0.1.19', date: null, body: '- nineteen thing' },
]

/** jsdom 은 크기를 재지 못하므로 목표 요소의 네모를 직접 정해 준다 */
function addTarget(name: string, rect: { left: number; top: number; width: number; height: number }, parent: HTMLElement = document.body): HTMLElement {
  const element = document.createElement('div')
  element.dataset.tour = name
  element.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => ({}) })
  parent.appendChild(element)
  return element
}

function freshInstall() {
  window.localStorage.clear()
  captureInstallSnapshot()
}

beforeEach(() => {
  resetTourState()
  resetStartupDialogs()
  setAppPref('shortcuts', {})
  setAppPref('prefixKeyAsked', true)
  window.localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  resetStartupDialogs()
  resetTourState()
})

const card = () => screen.queryByRole('dialog')

describe('TourOverlay', () => {
  const onboarding = tourById('onboarding')!

  it('단계 글, 카운터, 접근성 속성을 그린다', () => {
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
    const body = document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
    expect(title?.textContent).toBe('IWAE 처음 사용 안내')
    expect(body?.textContent).toContain('PDF를 읽으며')
    expect(screen.getByText('1 / 9')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '이전' })).toBeNull()
    expect(screen.getByRole('button', { name: '안내 닫기' })).not.toBeNull()
    expect(document.querySelector('[role="status"][aria-live="polite"]')?.textContent).toContain('1 / 9')
  })

  it('처음 초점은 「다음」에 있고, 다음 · 이전 단추로 오간다', () => {
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '다음' }))
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('2 / 9')).not.toBeNull()
    expect(document.getElementById('tour-card-title')?.textContent).toBe('문서 열기')
    fireEvent.click(screen.getByRole('button', { name: '이전' }))
    expect(screen.getByText('1 / 9')).not.toBeNull()
  })

  it('→ ← Enter 키로 오가고, Esc 는 건너뛴다', () => {
    const onFinish = vi.fn()
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={onFinish} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 9')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('3 / 9')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('2 / 9')).not.toBeNull()
    // 초점이 단추 밖에 있을 때의 Enter 는 다음
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(screen.getByText('3 / 9')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('마지막 단계의 주 단추는 「마치기」이고 누르면 끝낸다', () => {
    const onFinish = vi.fn()
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={onFinish} />)
    for (let index = 1; index < 9; index += 1) fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getByText('9 / 9')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '마치기' }))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('목표가 화면에 없으면 가운데 카드로 보이고 구멍이 없다', () => {
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(document.getElementById('tour-card-title')?.textContent).toBe('문서 열기')
    expect(card()?.getAttribute('data-side')).toBe('center')
    expect(document.querySelector('.tour-hole')).toBeNull()
    expect(document.querySelector('.tour-arrow')).toBeNull()
  })

  it('목표가 있으면 둘레를 뚫고 카드를 옆에 붙이며, 사라지면 가운데로 돌아간다', () => {
    vi.useFakeTimers()
    try {
      const target = addTarget('sidebar-docs', { left: 100, top: 20, width: 160, height: 30 })
      render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      expect(card()?.getAttribute('data-side')).toBe('right')
      const hole = document.querySelector<HTMLElement>('.tour-hole')!
      expect(hole.hasAttribute('data-on')).toBe(true)
      expect(hole.style.width).toBe('172px')
      expect(hole.style.transform).toBe('translate(94px, 14px)')
      expect(document.querySelector('.tour-arrow')).not.toBeNull()
      // 단계 중에 목표가 사라지면 다음 재기에서 가운데 카드로
      target.remove()
      act(() => { vi.advanceTimersByTime(500) })
      expect(card()?.getAttribute('data-side')).toBe('center')
      expect(document.querySelector('.tour-hole')?.hasAttribute('data-on')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('본문의 {prefix} 자리에 지금 접두키가 키캡으로 들어간다', () => {
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+A" onFinish={vi.fn()} />)
    for (let index = 0; index < 4; index += 1) fireEvent.click(screen.getByRole('button', { name: '다음' }))
    const caps = [...document.querySelectorAll('#tour-card-body kbd.tour-keycap')].map((element) => element.textContent)
    expect(caps).toEqual(['Ctrl+A', '%', '"', 'c', 'Ctrl+A', '?'])
    expect(document.getElementById('tour-card-body')?.textContent).not.toContain('{prefix}')
  })

  it('번역기 단계의 둘째 문장은 번역이 꺼져 있을 때만 설정을 안내한다', () => {
    const { unmount } = render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} />)
    for (let index = 0; index < 7; index += 1) fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(document.getElementById('tour-card-body')?.textContent).toContain('설정에서 번역을 켜면')
    unmount()
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" translationOn onFinish={vi.fn()} />)
    for (let index = 0; index < 7; index += 1) fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(document.getElementById('tour-card-body')?.textContent).toContain('이 단추로 번역기를 엽니다')
  })

  it('Tab 은 카드 안에서만 돈다', () => {
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    const primary = screen.getByRole('button', { name: '다음' })
    primary.focus()
    // 단추들의 순서: 닫기 ×, 이전, 다음. jsdom 은 크기가 0 이라 활성 요소만 목록에 든다 → 마지막에서 Tab 은 첫째로
    fireEvent.keyDown(card()!, { key: 'Tab' })
    expect(card()!.contains(document.activeElement)).toBe(true)
  })

  it('어두운 곳을 눌러도 뒤로 이벤트가 새지 않는다', () => {
    const outer = vi.fn()
    render(<div onPointerDown={outer} onClick={outer}><TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} /></div>)
    fireEvent.pointerDown(document.querySelector('.tour-dim')!)
    fireEvent.click(document.querySelector('.tour-dim')!)
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(outer).not.toHaveBeenCalled()
  })
})

describe('TourOverlay 선택 단계', () => {
  const onboarding = tourById('onboarding')!
  const titles = () => document.getElementById('tour-card-title')?.textContent
  const next = () => fireEvent.click(screen.getByRole('button', { name: '다음' }))

  it('목표가 없는 선택 단계는 건너뛰고, 진행 표시는 보이는 단계만 센다', () => {
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} />)
    expect(screen.getByText('1 / 9')).not.toBeNull()
    next()
    next()
    // 문서 열기 다음은 형광펜 · 메모 카드를 건너뛴 색 채널
    expect(titles()).toBe('색 채널')
    expect(screen.getByText('3 / 9')).not.toBeNull()
    next()
    expect(titles()).toBe('칸 나누기와 옮기기')
    expect(screen.getByText('4 / 9')).not.toBeNull()
  })

  it('선택 단계의 목표가 화면에 있으면 보이고, 전체 수와 이전 · 다음이 같은 목록을 쓴다', () => {
    addTarget('pdf-highlight', { left: 100, top: 100, width: 200, height: 14 })
    addTarget('memo-card', { left: 700, top: 100, width: 300, height: 80 })
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} />)
    expect(screen.getByText('1 / 11')).not.toBeNull()
    next()
    next()
    expect(titles()).toBe('형광펜 칠하기')
    expect(screen.getByText('3 / 11')).not.toBeNull()
    expect(card()?.getAttribute('data-side')).not.toBe('center')
    next()
    expect(titles()).toBe('메모 카드')
    next()
    expect(titles()).toBe('색 채널')
    expect(screen.getByText('5 / 11')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '이전' }))
    expect(titles()).toBe('메모 카드')
    fireEvent.click(screen.getByRole('button', { name: '이전' }))
    expect(titles()).toBe('형광펜 칠하기')
    for (let index = 0; index < 8; index += 1) next()
    expect(screen.getByText('11 / 11')).not.toBeNull()
  })

  it('보던 선택 단계의 목표가 사라지면 건너뛰고 전체 수도 줄어든다', () => {
    vi.useFakeTimers()
    try {
      const highlight = addTarget('pdf-highlight', { left: 100, top: 100, width: 200, height: 14 })
      render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} />)
      next()
      next()
      expect(titles()).toBe('형광펜 칠하기')
      expect(screen.getByText('3 / 10')).not.toBeNull()
      highlight.remove()
      act(() => { vi.advanceTimersByTime(500) })
      expect(titles()).toBe('색 채널')
      expect(screen.getByText('3 / 9')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('focus 단계는 그 종류의 칸이 있으면 센다: 오면 그 칸을 만지고, 목표가 계속 안 나오면 건너뛴다', () => {
    vi.useFakeTimers()
    try {
      const focus = vi.fn()
      const panes = { has: (kind: 'pdf' | 'note') => kind === 'pdf', focus }
      render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" panes={panes} onFinish={vi.fn()} />)
      expect(screen.getByText('1 / 10')).not.toBeNull()
      next()
      next()
      next()
      expect(titles()).toBe('영역 캡처')
      expect(focus).toHaveBeenCalledWith('pdf')
      // 칸을 만져도 단추가 안 나오면 두 번 재 본 뒤 건너뛴다
      act(() => { vi.advanceTimersByTime(900) })
      expect(titles()).toBe('칸 나누기와 옮기기')
      expect(screen.getByText('4 / 9')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('focus 단계의 목표가 칸을 만진 뒤에 나타나면 그대로 보인다', () => {
    vi.useFakeTimers()
    try {
      const panes = { has: () => true, focus: (kind: 'pdf' | 'note') => { if (kind === 'pdf') addTarget('region-capture', { left: 400, top: 6, width: 30, height: 28 }) } }
      render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" panes={panes} onFinish={vi.fn()} />)
      next()
      next()
      next()
      expect(titles()).toBe('영역 캡처')
      act(() => { vi.advanceTimersByTime(900) })
      expect(titles()).toBe('영역 캡처')
      expect(document.querySelector('.tour-hole')?.hasAttribute('data-on')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('선택이 아닌 단계는 목표가 없어도 가운데 카드로 남는다', () => {
    render(<TourOverlay tour={onboarding} prefixText="Ctrl+B" onFinish={vi.fn()} />)
    next()
    expect(titles()).toBe('문서 열기')
    expect(card()?.getAttribute('data-side')).toBe('center')
  })
})

describe('resolveTourTarget', () => {
  it('같은 이름이 여럿이면 만지는 칸의 것을 먼저 쓴다', () => {
    const first = addTarget('pane-head', { left: 0, top: 40, width: 200, height: 30 })
    const activeCard = document.createElement('div')
    activeCard.className = 'pane-card pane-card-active'
    document.body.appendChild(activeCard)
    const second = addTarget('pane-head', { left: 300, top: 40, width: 200, height: 30 }, activeCard)
    expect(resolveTourTarget('pane-head')).toBe(second)
    activeCard.remove()
    expect(resolveTourTarget('pane-head')).toBe(first)
  })

  it('크기가 없거나 창 밖이거나 숨은(inert) 것은 건너뛴다', () => {
    addTarget('toolbar', { left: 0, top: 0, width: 0, height: 0 })
    addTarget('toolbar', { left: 5000, top: 0, width: 50, height: 20 })
    const hidden = document.createElement('div')
    hidden.setAttribute('inert', '')
    document.body.appendChild(hidden)
    addTarget('toolbar', { left: 10, top: 10, width: 50, height: 20 }, hidden)
    expect(resolveTourTarget('toolbar')).toBeNull()
    const ok = addTarget('toolbar', { left: 10, top: 10, width: 50, height: 20 })
    expect(resolveTourTarget('toolbar')).toBe(ok)
  })
})

describe('TourHost 저절로 보이기', () => {
  it('처음 설치: Vault 가 열린 뒤(enabled)에 처음 사용 안내가 뜨고, 마치면 본 것으로 적는다', () => {
    freshInstall()
    const { rerender } = render(<TourHost enabled={false} version="0.1.19" prefixText="Ctrl+B" notes={notes} />)
    expect(card()).toBeNull()
    rerender(<TourHost enabled version="0.1.19" prefixText="Ctrl+B" notes={notes} />)
    expect(card()).not.toBeNull()
    expect(document.getElementById('tour-card-title')?.textContent).toBe('IWAE 처음 사용 안내')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(card()).toBeNull()
    expect(readToursSeen()).toContain('onboarding')
    // 다시 그려도(같은 실행) 또 뜨지 않는다
    rerender(<TourHost enabled version="0.1.19" prefixText="Ctrl+B" notes={notes} />)
    expect(card()).toBeNull()
  })

  it('쓰던 사람(앱 설정이 있음)에게는 처음 사용 안내를 저절로 보이지 않는다', () => {
    window.localStorage.clear()
    window.localStorage.setItem('iwae:onboarded:v1', '1')
    captureInstallSnapshot()
    render(<TourHost enabled version="0.1.19" prefixText="Ctrl+B" notes={notes} />)
    expect(card()).toBeNull()
  })

  it('처음 설치는 지금 버전까지의 새 기능 안내를 본 것으로 적는다', () => {
    freshInstall()
    render(<TourHost enabled version="0.2.0" prefixText="Ctrl+B" notes={notes} />)
    expect(JSON.parse(window.localStorage.getItem(TOURS_SEEN_KEY) ?? '[]')).toContain('v0.2.0')
  })

  it('접두키 고르기 창이 먼저 뜨고, 닫은 뒤에 둘러보기가 뜬다', () => {
    freshInstall()
    setAppPref('prefixKeyAsked', false)
    render(<><PrefixKeyHost enabled onChooseCustom={vi.fn()} /><TourHost enabled version="0.1.19" prefixText="Ctrl+B" notes={notes} /></>)
    expect(screen.queryByRole('alertdialog', { name: '접두키 고르기' })).not.toBeNull()
    expect(card()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '나중에' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(card()).not.toBeNull()
  })

  it('둘러보기는 aria-modal 이라 modalDialogOpen 이 참이다', async () => {
    const { modalDialogOpen } = await import('../../ui/modalOpen')
    freshInstall()
    render(<TourHost enabled version="0.1.19" prefixText="Ctrl+B" notes={notes} />)
    expect(modalDialogOpen()).toBe(true)
  })
})

describe('TourHost 업데이트', () => {
  function upgrade() {
    window.localStorage.clear()
    window.localStorage.setItem('iwae:last-seen-version:v1', '0.1.19')
    captureInstallSnapshot()
  }
  const both = (
    <><WhatsNewHost enabled version="0.2.0" notes={notes} onShowHistory={vi.fn()} /><TourHost enabled version="0.2.0" prefixText="Ctrl+B" notes={notes} /></>
  )

  it('「새 기능 둘러보기」를 누르면 새 버전 창이 닫히고 새 기능 안내가 시작된다', () => {
    upgrade()
    render(both)
    expect(screen.getByRole('alertdialog')).not.toBeNull()
    expect(card()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '새 기능 둘러보기' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(card()).not.toBeNull()
    expect(document.getElementById('tour-card-title')?.textContent).toBe('v0.2.0 새 기능')
    expect(screen.getByText('1 / 7')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(readToursSeen()).toContain('v0.2.0')
  })

  it('「나중에」는 안내를 시작하지 않고 본 것으로 적는다', () => {
    upgrade()
    render(both)
    fireEvent.click(screen.getByRole('button', { name: '나중에' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(card()).toBeNull()
    expect(readToursSeen()).toContain('v0.2.0')
  })
})

describe('TourHost 직접 열기', () => {
  it('requestTour 는 본 적이 있어도 연다. enabled 가 아니어도(메인 창 밖 규칙은 호출하는 쪽이 지킨다) 열린다', () => {
    window.localStorage.setItem(TOURS_SEEN_KEY, JSON.stringify(['onboarding', 'v0.2.0']))
    captureInstallSnapshot()
    render(<TourHost enabled={false} version="0.1.19" prefixText="Ctrl+B" notes={notes} />)
    expect(card()).toBeNull()
    act(() => requestTour('v0.2.0'))
    expect(document.getElementById('tour-card-title')?.textContent).toBe('v0.2.0 새 기능')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(card()).toBeNull()
    act(() => requestTour('onboarding'))
    expect(document.getElementById('tour-card-title')?.textContent).toBe('IWAE 처음 사용 안내')
  })

  it('모르는 id 는 무시한다', () => {
    render(<TourHost enabled={false} version="0.1.19" prefixText="Ctrl+B" notes={notes} />)
    act(() => requestTour('nope'))
    expect(card()).toBeNull()
  })
})
