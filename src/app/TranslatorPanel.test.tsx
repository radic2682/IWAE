// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { TranslationCardSettingsContext } from '../ui/TranslationCard'
import { setTranslationSource } from '../ui/translationPair'
import { publishReaderSelection } from './readerSelectionStore'
import { TranslatorPanel } from './TranslatorPanel'
import { normalizeTabKind } from './tabs'
import {
  PANEL_MARGIN,
  TRANSLATOR_MIGRATED_KEY,
  TRANSLATOR_PANEL_STORAGE_KEY,
  TRANSLATOR_WINDOW_H,
  TRANSLATOR_WINDOW_STORAGE_KEY,
  TOPBAR_HEIGHT_PX,
  TRANSLATOR_WINDOW_W,
  finishLegacyTranslatorMigration,
  getTranslatorWindow,
  isLegacyTranslatorTabId,
  openTranslatorWindow,
  placePanel,
  consumeTranslatorFocus,
  requestTranslatorFocus,
  readLegacyTranslatorPanels,
  reloadTranslatorWindow,
  toggleTranslatorWindow,
  adoptLegacyTranslatorFloat,
  mayAdoptLegacyTranslator,
  resetAdoptedLegacySessions,
  translatorWindowFromFloat,
  translatorWindowFromLegacy,
  updateTranslatorWindow,
} from './translatorPanelState'
import { TranslatorContext, type TranslatorService } from './translatorContext'
import { ruleDecl } from './cssRules.testutil'

function Harness({ service, target = 'ko' }: { readonly service: TranslatorService; readonly target?: string }) {
  const [targetLanguage, setTargetLanguage] = useState(target)
  return (
    <TranslatorContext.Provider value={service}>
      <TranslationCardSettingsContext.Provider value={{ targetLanguage, providerLabel: 'Azure', onChangeTargetLanguage: setTargetLanguage }}>
        <TranslatorPanel />
      </TranslationCardSettingsContext.Provider>
    </TranslatorContext.Provider>
  )
}

/** 번역기 창을 열어 그린다(창 전체에 떠 있는 창이라 칸 · 탭이 없다) */
function renderOpen(service: TranslatorService) {
  act(() => { updateTranslatorWindow({ open: true }) })
  return render(<Harness service={service} />)
}

function makeService(): TranslatorService & { translate: ReturnType<typeof vi.fn> } {
  return {
    providerLabel: 'Azure',
    translate: vi.fn().mockResolvedValue({ text: '안녕하세요 번역', model: 'azure' }),
  }
}

const input = () => screen.getByLabelText('번역할 글') as HTMLTextAreaElement
const windowEl = () => document.querySelector<HTMLElement>('.translator-window')!

beforeEach(() => {
  window.localStorage.clear()
  reloadTranslatorWindow()
  setTranslationSource('auto')
  act(() => { publishReaderSelection('test', '') })
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('번역기 창 상태는 같은 저장소를 쓰는 창들이 나눠 갖는다(storage 이벤트)', () => {
  const fromOtherWindow = (value: object | null) => {
    const next = value === null ? null : JSON.stringify(value)
    if (next === null) window.localStorage.removeItem(TRANSLATOR_WINDOW_STORAGE_KEY)
    else window.localStorage.setItem(TRANSLATOR_WINDOW_STORAGE_KEY, next)
    // storage 이벤트는 값을 바꾼 창이 아니라 다른 창에 온다
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: TRANSLATOR_WINDOW_STORAGE_KEY, newValue: next })) })
  }

  it('다른 창이 열고 옮기면 이 창도 다시 읽어 같은 값을 그린다', () => {
    render(<Harness service={makeService()} />)
    expect(document.querySelector('.translator-window')).toBeNull()
    fromOtherWindow({ open: true, x: 200, y: 120, w: 400, h: 320 })
    expect(getTranslatorWindow()).toMatchObject({ open: true, x: 200, y: 120, w: 400, h: 320 })
    expect(windowEl()).not.toBeNull()
    fromOtherWindow({ open: false, x: 200, y: 120, w: 400, h: 320 })
    expect(document.querySelector('.translator-window')).toBeNull()
  })

  it('다른 창이 바꾼 뒤 이 창이 저장해도 낡은 값으로 덮어쓰지 않는다(다시 읽은 값에 이 창의 바뀜만 얹는다)', () => {
    fromOtherWindow({ open: true, x: 50, y: 60, w: 500, h: 400 })
    act(() => { updateTranslatorWindow({ x: 70 }) })
    expect(JSON.parse(window.localStorage.getItem(TRANSLATOR_WINDOW_STORAGE_KEY)!)).toMatchObject({ open: true, x: 70, y: 60, w: 500, h: 400 })
  })

  it('이 번역기 값과 상관없는 키의 storage 이벤트는 무시하고, 저장소를 비웠다(key=null)는 이벤트는 다시 읽는다', () => {
    act(() => { updateTranslatorWindow({ open: true, x: 10, y: 10 }) })
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'iwae:other', newValue: '1' })) })
    expect(getTranslatorWindow()).toMatchObject({ open: true, x: 10 })
    window.localStorage.clear()
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: null })) })
    expect(getTranslatorWindow().open).toBe(false)
  })

  it('키 · 명령으로 열면 입력칸이 포커스를 받는다(이미 열려 있어도)', () => {
    render(<Harness service={makeService()} />)
    act(() => { openTranslatorWindow() })
    expect(document.activeElement).toBe(input())
    input().blur()
    act(() => { openTranslatorWindow() })
    expect(document.activeElement).toBe(input())
  })

  it('다른 창의 동기화로 열릴 때는 포커스를 빼앗지 않는다', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    render(<Harness service={makeService()} />)
    fromOtherWindow({ open: true, x: 20, y: 20, w: 340, h: 300 })
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})

describe('상단바 높이 상수는 --bar-h 와 같다', () => {
  it('TOPBAR_HEIGHT_PX 가 tokens.css 의 --bar-h 값이다', () => {
    expect(ruleDecl('tokens.css', ':root', '--bar-h')).toBe(`${TOPBAR_HEIGHT_PX}px`)
  })
})

describe('번역기 창의 내용', () => {
  it('Ctrl+Enter 로 번역하고 결과를 보인다', async () => {
    const service = makeService()
    renderOpen(service)
    fireEvent.change(input(), { target: { value: 'hello world, this is a test' } })
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
    await screen.findByLabelText('번역 결과')
    expect(service.translate).toHaveBeenCalledWith('hello world, this is a test', undefined, 'ko')
    expect(screen.getByLabelText('번역 결과').textContent).toBe('안녕하세요 번역')
  })

  it('입력기 조합 중의 Ctrl+Enter(isComposing · keyCode 229)는 번역하지 않는다', () => {
    const service = makeService()
    renderOpen(service)
    fireEvent.change(input(), { target: { value: 'hello' } })
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true, keyCode: 229 })
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true, isComposing: true })
    expect(service.translate).not.toHaveBeenCalled()
  })

  it('그냥 Enter 는 번역하지 않는다(줄바꿈)', () => {
    const service = makeService()
    renderOpen(service)
    fireEvent.change(input(), { target: { value: 'hello' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(service.translate).not.toHaveBeenCalled()
  })

  it('번역 중에는 상태를 보이고, 실패하면 오류를 보인다', async () => {
    const service = makeService()
    let reject!: (error: Error) => void
    service.translate.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
    renderOpen(service)
    fireEvent.change(input(), { target: { value: 'hello world' } })
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    expect((await screen.findByRole('status')).textContent).toBe('번역 중…')
    await act(async () => { reject(new Error('연결 끊김')) })
    expect((await screen.findByRole('alert')).textContent).toContain('연결 끊김')
  })

  it('복사 단추는 결과를 클립보드에 넣는다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderOpen(makeService())
    fireEvent.change(input(), { target: { value: 'hello world' } })
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    await screen.findByLabelText('번역 결과')
    fireEvent.click(screen.getByRole('button', { name: '복사' }))
    expect(writeText).toHaveBeenCalledWith('안녕하세요 번역')
  })

  it('언어를 바꾸면 지금 글을 새 쌍으로 다시 번역한다', async () => {
    const service = makeService()
    renderOpen(service)
    fireEvent.change(input(), { target: { value: 'hello world, this is a test' } })
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    await screen.findByLabelText('번역 결과')
    fireEvent.change(screen.getByLabelText('번역할 언어'), { target: { value: 'ja' } })
    await waitFor(() => expect(service.translate).toHaveBeenCalledTimes(2))
    expect(service.translate).toHaveBeenLastCalledWith('hello world, this is a test', undefined, 'ja')
    fireEvent.change(screen.getByLabelText('원문 언어'), { target: { value: 'en' } })
    await waitFor(() => expect(service.translate).toHaveBeenCalledTimes(3))
    expect(service.translate).toHaveBeenLastCalledWith('hello world, this is a test', 'en', 'ja')
  })

  it('⇄ 는 번역 결과를 입력으로 옮기고 거꾸로 번역한다', async () => {
    const service = makeService()
    renderOpen(service)
    fireEvent.change(input(), { target: { value: 'hello world, this is a test' } })
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    await screen.findByLabelText('번역 결과')
    fireEvent.click(screen.getByRole('button', { name: '원문과 번역 언어 바꾸기' }))
    expect(input().value).toBe('안녕하세요 번역')
    await waitFor(() => expect(service.translate).toHaveBeenCalledTimes(2))
    expect(service.translate).toHaveBeenLastCalledWith('안녕하세요 번역', 'ko', 'en')
  })

  it('「선택한 글 넣기」는 문서에서 고른 글이 있을 때만 나오고, 넣기만 한다(번역은 하지 않는다)', () => {
    const service = makeService()
    renderOpen(service)
    expect(screen.queryByRole('button', { name: '선택한 글 넣기' })).toBeNull()
    act(() => { publishReaderSelection('test', 'selected\ntext from the page') })
    fireEvent.click(screen.getByRole('button', { name: '선택한 글 넣기' }))
    expect(input().value).toBe('selected text from the page')
    expect(service.translate).not.toHaveBeenCalled()
    act(() => { publishReaderSelection('test', '') })
    expect(screen.queryByRole('button', { name: '선택한 글 넣기' })).toBeNull()
  })

  it('Esc 는 창을 닫지 않고 글쓰기 칸의 포커스만 뺀다', () => {
    renderOpen(makeService())
    input().focus()
    expect(document.activeElement).toBe(input())
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(document.activeElement).not.toBe(input())
    expect(screen.getByRole('region', { name: '번역기' })).toBeDefined()
    expect(getTranslatorWindow().open).toBe(true)
  })

  it('열 때 포커스가 있던 곳을 기억했다가 Esc · 닫기에서 돌려준다', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    render(<Harness service={makeService()} />)
    opener.focus()
    act(() => { openTranslatorWindow() })
    expect(document.activeElement).toBe(input())
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(document.activeElement).toBe(opener)
    expect(getTranslatorWindow().open).toBe(true)
    // 닫기: 창 안(닫기 단추)에 있던 포커스가 사라져도 열기 전의 자리로
    screen.getByRole('button', { name: '번역기 닫기' }).focus()
    fireEvent.click(screen.getByRole('button', { name: '번역기 닫기' }))
    expect(document.querySelector('.translator-window')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('닫을 때 포커스를 다른 곳으로 옮겨 둔 사용자에게서는 포커스를 빼앗지 않는다', () => {
    const opener = document.createElement('button')
    const other = document.createElement('input')
    document.body.append(opener, other)
    render(<Harness service={makeService()} />)
    opener.focus()
    act(() => { openTranslatorWindow() })
    other.focus()
    act(() => { updateTranslatorWindow({ open: false }) })
    expect(document.activeElement).toBe(other)
  })

  it('포커스 요청은 번호로 구분한다: 먼저 한 요청의 타이머가 새 요청을 지우지 않는다', () => {
    vi.useFakeTimers()
    try {
      requestTranslatorFocus()
      vi.advanceTimersByTime(300)
      requestTranslatorFocus()
      vi.advanceTimersByTime(250)
      expect(consumeTranslatorFocus()).toBe(true)
      requestTranslatorFocus()
      vi.advanceTimersByTime(600)
      expect(consumeTranslatorFocus()).toBe(false)
    } finally { vi.useRealTimers() }
  })

  it('번역기를 설정하지 않았으면(서비스 없음) 입력 전에 안내한다', () => {
    act(() => { updateTranslatorWindow({ open: true }) })
    render(
      <TranslatorContext.Provider value={null}>
        <TranslationCardSettingsContext.Provider value={{ targetLanguage: 'ko', providerLabel: '', onChangeTargetLanguage: () => undefined }}>
          <TranslatorPanel />
        </TranslationCardSettingsContext.Provider>
      </TranslatorContext.Provider>,
    )
    expect(screen.getByRole('alert').textContent).toContain('번역기를 아직 설정하지 않았습니다')
  })
})

describe('번역기는 탭이 아니라 앱 창 전체에 떠 있는 창이다', () => {
  it('닫혀 있으면 아무것도 그리지 않고, 열면 body 에 고정된 창으로 그린다(칸 안이 아니다)', () => {
    const { container } = render(<Harness service={makeService()} />)
    expect(windowEl()).toBeNull()
    act(() => { toggleTranslatorWindow() })
    expect(windowEl()).not.toBeNull()
    expect(windowEl().parentElement).toBe(document.body)
    expect(container.querySelector('.translator-window')).toBeNull()
    expect(screen.getByRole('dialog', { name: '번역기' })).toBeDefined()
    act(() => { toggleTranslatorWindow() })
    expect(windowEl()).toBeNull()
  })

  it('처음 크기는 작은 340×300 이고 기본 자리는 창 오른쪽 아래다(가장자리 12px 안쪽, 상단바 · 칸 머리를 덮지 않는다)', () => {
    expect(TRANSLATOR_WINDOW_W).toBe(340)
    expect(TRANSLATOR_WINDOW_H).toBe(300)
    renderOpen(makeService())
    const el = windowEl()
    expect(el.style.width).toBe('340px')
    expect(el.style.height).toBe('300px')
    expect(PANEL_MARGIN).toBe(12)
    expect(Number.parseFloat(el.style.top) + 300).toBe(window.innerHeight - PANEL_MARGIN)
    expect(Number.parseFloat(el.style.left) + 340).toBe(window.innerWidth - PANEL_MARGIN)
  })

  it('머리 줄에 번역기 제목 · 번역기 이름 · 닫기 단추가 있고, 닫기는 창을 닫는다', () => {
    renderOpen(makeService())
    const head = windowEl().querySelector('.translator-window-head')!
    expect(head.textContent).toContain('번역기')
    expect(head.textContent).toContain('Azure')
    fireEvent.click(screen.getByRole('button', { name: '번역기 닫기' }))
    expect(getTranslatorWindow().open).toBe(false)
    expect(windowEl()).toBeNull()
  })

  it('머리 줄을 잡고 끌면 앱 창 안 어디로든 옮겨지고(상단바 아래 · 가장자리 안쪽), 놓은 자리를 기억한다', () => {
    renderOpen(makeService())
    const head = windowEl().querySelector<HTMLElement>('.translator-window-head')!
    const startX = Number.parseFloat(windowEl().style.left)
    const startY = Number.parseFloat(windowEl().style.top)
    fireEvent.pointerDown(head, { button: 0, clientX: 500, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(head, { clientX: 300, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(head, { pointerId: 1 })
    expect(Number.parseFloat(windowEl().style.left)).toBe(startX - 200)
    expect(Number.parseFloat(windowEl().style.top)).toBe(startY - 60)
    expect(getTranslatorWindow()).toMatchObject({ x: startX - 200, y: startY - 60 })
    // 상단바 위로는 못 올라가고, 창 밖으로 나가지 않는다
    fireEvent.pointerDown(head, { button: 0, clientX: 300, clientY: 220, pointerId: 1 })
    fireEvent.pointerMove(head, { clientX: -9000, clientY: -9000, pointerId: 1 })
    fireEvent.pointerUp(head, { pointerId: 1 })
    expect(Number.parseFloat(windowEl().style.left)).toBe(PANEL_MARGIN)
    expect(Number.parseFloat(windowEl().style.top)).toBe(36 + PANEL_MARGIN)
  })

  it('오른쪽 아래 모서리로 크기를 바꾸되 최소 크기 밑으로는 줄지 않는다', () => {
    renderOpen(makeService())
    const handle = screen.getByRole('separator', { name: '번역기 크기 바꾸기' })
    fireEvent.pointerDown(handle, { button: 0, clientX: 800, clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 700, clientY: 380, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(windowEl().style.width).toBe('280px')
    expect(windowEl().style.height).toBe('280px')
    expect(getTranslatorWindow()).toMatchObject({ w: 280, h: 280 })
  })

  it('열림 · 자리 · 크기는 localStorage 에 하나만 적히고 다시 읽는다', () => {
    updateTranslatorWindow({ open: true, x: 120, y: 90, w: 360, h: 320 })
    expect(JSON.parse(window.localStorage.getItem(TRANSLATOR_WINDOW_STORAGE_KEY)!)).toEqual({ open: true, x: 120, y: 90, w: 360, h: 320 })
    updateTranslatorWindow({ open: false })
    reloadTranslatorWindow()
    expect(getTranslatorWindow()).toEqual({ open: false, x: 120, y: 90, w: 360, h: 320 })
  })

  it('translator 는 탭 종류가 아니다: 저장된 탭 종류를 읽을 때 모르는 값이고, 예전 탭 id 만 알아본다', () => {
    expect(normalizeTabKind('translator')).toBeNull()
    expect(isLegacyTranslatorTabId('translator')).toBe(true)
    expect(isLegacyTranslatorTabId('translator:p7')).toBe(true)
    expect(isLegacyTranslatorTabId('translators/notes.md')).toBe(false)
  })

  it('번역기를 탭으로 만드는 코드가 없다(translator 탭 종류 · 번역기 떠 있는 칸 함수)', () => {
    const tabs = readFileSync('src/app/tabs.ts', 'utf8')
    const floats = readFileSync('src/app/floatingPanes.ts', 'utf8')
    expect(tabs).not.toMatch(/'translator'/u)
    expect(floats).not.toMatch(/translator/iu)
  })
})

describe('예전 값 옮기기', () => {
  const legacyAt = (state: object) => ({ getItem: (key: string) => (key === TRANSLATOR_PANEL_STORAGE_KEY ? JSON.stringify(state) : null), setItem: vi.fn(), removeItem: vi.fn() })

  it('창이 줄면 번역기도 창 안으로 들어온다', () => {
    const box = placePanel({ x: 700, y: 500, w: 340, h: 380 }, { width: 500, height: 400, top: 36 })
    expect(box.x + box.w).toBeLessThanOrEqual(500 - PANEL_MARGIN)
    expect(box.y + box.h).toBeLessThanOrEqual(400 - PANEL_MARGIN)
    expect(box.x).toBeGreaterThanOrEqual(PANEL_MARGIN)
  })

  it('상단바(top) 아래에만 놓인다', () => {
    const box = placePanel({ x: 100, y: 0, w: 340, h: 380 }, { width: 900, height: 900, top: 36 })
    expect(box.y).toBeGreaterThanOrEqual(36 + PANEL_MARGIN)
    const fresh = placePanel({ x: null, y: null, w: 340, h: 300 }, { width: 900, height: 900, top: 36 })
    expect(fresh).toMatchObject({ x: 900 - 340 - PANEL_MARGIN, y: 900 - 300 - PANEL_MARGIN })
    const tall = placePanel({ x: 100, y: 0, w: 340, h: 2000 }, { width: 900, height: 600, top: 36 })
    expect(tall.y + tall.h).toBeLessThanOrEqual(600 - PANEL_MARGIN)
  })

  it('문서 종류별로 저장하던 값을 읽고, 깨진 값 · 값이 없음 · 이미 옮김은 null', () => {
    const read = readLegacyTranslatorPanels(legacyAt({ pdf: { open: true, x: 120, y: 40, w: 360, h: 300 }, markdown: { open: false } }))
    expect(read?.pdf).toEqual({ open: true, x: 120, y: 40, w: 360, h: 300 })
    expect(read?.markdown.open).toBe(false)
    expect(readLegacyTranslatorPanels({ getItem: () => '{ not json', setItem: vi.fn(), removeItem: vi.fn() })).toBeNull()
    expect(readLegacyTranslatorPanels({ getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })).toBeNull()
    expect(readLegacyTranslatorPanels({ getItem: (key) => (key === TRANSLATOR_MIGRATED_KEY ? '1' : '{}'), setItem: vi.fn(), removeItem: vi.fn() })).toBeNull()
    // 크기는 최소 크기 이상으로
    expect(readLegacyTranslatorPanels(legacyAt({ pdf: { open: true, w: 10, h: 10 } }))?.pdf).toMatchObject({ w: 280, h: 240 })
  })

  it('옮겼다고 적고 예전 값은 지운다', () => {
    const storage = legacyAt({})
    finishLegacyTranslatorMigration(storage)
    expect(storage.setItem).toHaveBeenCalledWith(TRANSLATOR_MIGRATED_KEY, '1')
    expect(storage.removeItem).toHaveBeenCalledWith(TRANSLATOR_PANEL_STORAGE_KEY)
  })

  it('하나라도 열어 두었으면 창이 열린 채로 크기만 옮긴다(PDF 쪽 값 먼저, 자리는 기본). 둘 다 닫혀 있었으면 바꿀 것이 없다', () => {
    const open = (pdf: object, markdown: object = { open: false }) => readLegacyTranslatorPanels(legacyAt({ pdf, markdown }))!
    expect(translatorWindowFromLegacy(open({ open: true, x: 100, y: 50, w: 360, h: 300 }))).toEqual({ open: true, x: null, y: null, w: 360, h: 300 })
    expect(translatorWindowFromLegacy(open({ open: false }, { open: true, w: 400, h: 350 }))).toEqual({ open: true, x: null, y: null, w: 400, h: 350 })
    expect(translatorWindowFromLegacy(open({ open: false }))).toBeNull()
  })

  it('번역기 떠 있는 칸은 앱 창 전체에 대한 비율 자리 · 크기로 창에 옮긴다(상단바 아래, 최소 크기 이상)', () => {
    expect(translatorWindowFromFloat({ x: 0.5, y: 0.1, w: 340, h: 300 }, { width: 1600, height: 1000, top: 36 })).toEqual({ open: true, x: 800, y: 36 + 96, w: 340, h: 300 })
    expect(translatorWindowFromFloat({ x: 0.5, y: 0.1, w: 340, h: 300, collapsed: true }, { width: 1600, height: 1000, top: 36 }).open).toBe(false)
    expect(translatorWindowFromFloat({ x: 0.5, y: 0.1, w: 340, h: 300, hidden: true }, { width: 1600, height: 1000, top: 36 }).open).toBe(false)
    expect(translatorWindowFromFloat({ x: 0, y: 0, w: 120, h: 80 }, { width: 1600, height: 1000 })).toMatchObject({ x: 0, y: 0, w: 280, h: 240 })
  })

  describe('예전 번역기 칸 옮기기(adoptLegacyTranslatorFloat)', () => {
    beforeEach(() => { resetAdoptedLegacySessions() })

    it('접어 두었거나 숨겨 둔 칸은 열려 있는 번역기를 닫지 않고 자리 · 크기만 옮긴다', () => {
      act(() => { updateTranslatorWindow({ open: true }) })
      expect(adoptLegacyTranslatorFloat({ x: 0.5, y: 0.1, w: 340, h: 300, collapsed: true }, 'v|A')).toBe(true)
      expect(getTranslatorWindow().open).toBe(true)
      expect(getTranslatorWindow()).toMatchObject({ w: 340, h: 300 })
      act(() => { updateTranslatorWindow({ open: true }) })
      adoptLegacyTranslatorFloat({ x: 0.2, y: 0.2, w: 300, h: 260, hidden: true }, 'v|B')
      expect(getTranslatorWindow().open).toBe(true)
    })

    it('열려 있던 칸은 번역기를 연다', () => {
      act(() => { updateTranslatorWindow({ open: false }) })
      adoptLegacyTranslatorFloat({ x: 0.5, y: 0.1, w: 340, h: 300 }, 'v|A')
      expect(getTranslatorWindow().open).toBe(true)
    })

    it('세션 이름마다 한 번만 옮긴다: 세션을 다시 오가도 사용자가 닫은 번역기를 다시 열지 않는다', () => {
      act(() => { updateTranslatorWindow({ open: false }) })
      expect(adoptLegacyTranslatorFloat({ x: 0.5, y: 0.1, w: 340, h: 300 }, 'v|A')).toBe(true)
      act(() => { toggleTranslatorWindow() })
      expect(getTranslatorWindow().open).toBe(false)
      expect(adoptLegacyTranslatorFloat({ x: 0.5, y: 0.1, w: 340, h: 300 }, 'v|A')).toBe(false)
      expect(getTranslatorWindow().open).toBe(false)
      expect(adoptLegacyTranslatorFloat({ x: 0.5, y: 0.1, w: 340, h: 300 }, 'v|B')).toBe(true)
    })

    it('세션의 소유자가 될 창만 옮긴다: 먼저 붙은 새 앱 창 · 남에게서 받은 상태 · 다른 창이 붙은 세션으로 갈아탄 창은 옮기지 않는다', () => {
      expect(mayAdoptLegacyTranslator({ at: 'start', role: 'main' })).toBe(true)
      expect(mayAdoptLegacyTranslator({ at: 'start', role: 'extra' })).toBe(false)
      expect(mayAdoptLegacyTranslator({ at: 'start', role: 'detached' })).toBe(false)
      expect(mayAdoptLegacyTranslator({ at: 'switch', attachedElsewhere: false })).toBe(true)
      expect(mayAdoptLegacyTranslator({ at: 'switch', attachedElsewhere: true })).toBe(false)
      expect(mayAdoptLegacyTranslator({ at: 'remote' })).toBe(false)
    })
  })
})
