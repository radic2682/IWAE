// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationCardSettingsContext } from '../ui/TranslationCard'
import { setTranslationSource } from '../ui/translationPair'
import { publishReaderSelection } from './readerSelectionStore'
import { TranslatorPanel } from './TranslatorPanel'
import { TranslatorContext, type TranslatorService } from './translatorContext'
import {
  TRANSLATOR_PANEL_STORAGE_KEY,
  getTranslatorPanelState,
  placePanel,
  reloadTranslatorPanelState,
  updateTranslatorPanel,
} from './translatorPanelState'

function Harness({ service, target = 'ko' }: { readonly service: TranslatorService; readonly target?: string }) {
  const [targetLanguage, setTargetLanguage] = useState(target)
  return (
    <TranslatorContext.Provider value={service}>
      <TranslationCardSettingsContext.Provider value={{ targetLanguage, providerLabel: 'Azure', onChangeTargetLanguage: setTargetLanguage }}>
        <TranslatorPanel kind="pdf" />
      </TranslationCardSettingsContext.Provider>
    </TranslatorContext.Provider>
  )
}

/** 문서 칸(.pane-body)처럼 크기가 있는 상자 안에 그린다 */
function renderInPane(service: TranslatorService, width = 800, height = 600) {
  const host = document.createElement('div')
  Object.defineProperty(host, 'clientWidth', { value: width, configurable: true })
  Object.defineProperty(host, 'clientHeight', { value: height, configurable: true })
  document.body.append(host)
  const view = render(<Harness service={service} />, { container: host })
  return { ...view, host }
}

function makeService(): TranslatorService & { translate: ReturnType<typeof vi.fn> } {
  return {
    providerLabel: 'Azure',
    translate: vi.fn().mockResolvedValue({ text: '안녕하세요 번역', model: 'azure' }),
  }
}

const panel = () => screen.getByRole('dialog', { name: '번역기' })
const header = () => panel().querySelector('.translator-panel-header') as HTMLElement
const input = () => screen.getByLabelText('번역할 글') as HTMLTextAreaElement

beforeEach(() => {
  window.localStorage.clear()
  setTranslationSource('auto')
  reloadTranslatorPanelState()
  act(() => { publishReaderSelection('test', '') })
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('떠 있는 번역기', () => {
  it('Ctrl+Enter 로 번역하고 결과를 보인다', async () => {
    const service = makeService()
    renderInPane(service)
    fireEvent.change(input(), { target: { value: 'hello world, this is a test' } })
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
    await screen.findByLabelText('번역 결과')
    expect(service.translate).toHaveBeenCalledWith('hello world, this is a test', undefined, 'ko')
    expect(screen.getByLabelText('번역 결과').textContent).toBe('안녕하세요 번역')
  })

  it('그냥 Enter 는 번역하지 않는다(줄바꿈)', () => {
    const service = makeService()
    renderInPane(service)
    fireEvent.change(input(), { target: { value: 'hello' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(service.translate).not.toHaveBeenCalled()
  })

  it('번역 중에는 상태를 보이고, 실패하면 오류를 보인다', async () => {
    const service = makeService()
    let reject!: (error: Error) => void
    service.translate.mockReturnValue(new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
    renderInPane(service)
    fireEvent.change(input(), { target: { value: 'hello world' } })
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    expect((await screen.findByRole('status')).textContent).toBe('번역 중…')
    await act(async () => { reject(new Error('연결 끊김')) })
    expect((await screen.findByRole('alert')).textContent).toContain('연결 끊김')
  })

  it('복사 단추는 결과를 클립보드에 넣는다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderInPane(makeService())
    fireEvent.change(input(), { target: { value: 'hello world' } })
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    await screen.findByLabelText('번역 결과')
    fireEvent.click(screen.getByRole('button', { name: '복사' }))
    expect(writeText).toHaveBeenCalledWith('안녕하세요 번역')
  })

  it('언어를 바꾸면 지금 글을 새 쌍으로 다시 번역한다', async () => {
    const service = makeService()
    renderInPane(service)
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

  it('「선택한 글 넣기」는 문서에서 고른 글이 있을 때만 나오고, 넣기만 한다(번역은 하지 않는다)', () => {
    const service = makeService()
    renderInPane(service)
    expect(screen.queryByRole('button', { name: '선택한 글 넣기' })).toBeNull()
    act(() => { publishReaderSelection('test', 'selected\ntext from the page') })
    fireEvent.click(screen.getByRole('button', { name: '선택한 글 넣기' }))
    expect(input().value).toBe('selected text from the page')
    expect(service.translate).not.toHaveBeenCalled()
    act(() => { publishReaderSelection('test', '') })
    expect(screen.queryByRole('button', { name: '선택한 글 넣기' })).toBeNull()
  })

  it('Esc 는 창을 닫지 않고 포커스만 뺀다. ×는 닫는다', () => {
    renderInPane(makeService())
    updateTranslatorPanel('pdf', { open: true })
    input().focus()
    expect(document.activeElement).toBe(input())
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(document.activeElement).not.toBe(input())
    expect(getTranslatorPanelState('pdf').open).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '번역기 닫기' }))
    expect(getTranslatorPanelState('pdf').open).toBe(false)
  })
})

describe('떠 있는 번역기: 자리·크기', () => {
  it('머리 줄을 끌어 옮기고, 놓으면 자리를 기억한다. 칸 밖으로는 나가지 않는다', () => {
    renderInPane(makeService(), 800, 600)
    act(() => { updateTranslatorPanel('pdf', { x: 100, y: 50, w: 340, h: 380 }) })
    fireEvent.pointerDown(header(), { button: 0, clientX: 200, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(header(), { clientX: 260, clientY: 100, pointerId: 1 })
    expect(panel().style.left).toBe('160px')
    expect(panel().style.top).toBe('90px')
    fireEvent.pointerUp(header(), { pointerId: 1 })
    expect(getTranslatorPanelState('pdf')).toMatchObject({ x: 160, y: 90 })
    // 칸 오른쪽 아래 끝을 넘기려 하면 여백 8px 안쪽에서 멈춘다
    fireEvent.pointerDown(header(), { button: 0, clientX: 200, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(header(), { clientX: 5000, clientY: 5000, pointerId: 1 })
    fireEvent.pointerUp(header(), { pointerId: 1 })
    expect(getTranslatorPanelState('pdf')).toMatchObject({ x: 800 - 340 - 8, y: 600 - 380 - 8 })
    fireEvent.pointerDown(header(), { button: 0, clientX: 200, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(header(), { clientX: -5000, clientY: -5000, pointerId: 1 })
    fireEvent.pointerUp(header(), { pointerId: 1 })
    expect(getTranslatorPanelState('pdf')).toMatchObject({ x: 8, y: 8 })
  })

  it('단추를 눌러서는 끌기가 시작되지 않는다', () => {
    renderInPane(makeService())
    act(() => { updateTranslatorPanel('pdf', { x: 100, y: 50 }) })
    fireEvent.pointerDown(screen.getByRole('button', { name: '번역기 닫기' }), { button: 0, clientX: 200, clientY: 60, pointerId: 1 })
    fireEvent.pointerMove(header(), { clientX: 300, clientY: 160, pointerId: 1 })
    expect(panel().style.left).toBe('100px')
  })

  it('오른쪽 아래 모서리를 끌어 크기를 바꾼다(최소·칸 크기 안에서)', () => {
    renderInPane(makeService(), 800, 600)
    act(() => { updateTranslatorPanel('pdf', { x: 100, y: 50, w: 340, h: 380 }) })
    const handle = screen.getByRole('separator', { name: '번역기 크기 바꾸기' })
    fireEvent.pointerDown(handle, { button: 0, clientX: 440, clientY: 430, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 500, clientY: 470, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(getTranslatorPanelState('pdf')).toMatchObject({ w: 400, h: 420 })
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 470, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: -9000, clientY: -9000, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(getTranslatorPanelState('pdf')).toMatchObject({ w: 280, h: 240 })
  })

  it('칸이 작아지면 번역기도 칸 안으로 들어온다', () => {
    const box = placePanel({ x: 700, y: 500, w: 340, h: 380 }, { width: 500, height: 400 })
    expect(box.x + box.w).toBeLessThanOrEqual(500 - 8)
    expect(box.y + box.h).toBeLessThanOrEqual(400 - 8)
    expect(box.x).toBeGreaterThanOrEqual(8)
  })

  it('열림·자리·크기는 문서 종류마다 저장되고, 다시 읽어도 그대로다', () => {
    updateTranslatorPanel('pdf', { open: true, x: 120, y: 40, w: 360, h: 300 })
    updateTranslatorPanel('markdown', { open: false })
    expect(JSON.parse(window.localStorage.getItem(TRANSLATOR_PANEL_STORAGE_KEY) ?? '{}')).toMatchObject({
      pdf: { open: true, x: 120, y: 40, w: 360, h: 300 },
      markdown: { open: false },
    })
    act(() => { reloadTranslatorPanelState() })
    expect(getTranslatorPanelState('pdf')).toEqual({ open: true, x: 120, y: 40, w: 360, h: 300 })
    expect(getTranslatorPanelState('markdown').open).toBe(false)
  })

  it('깨진 저장값은 기본값으로 물러난다', () => {
    window.localStorage.setItem(TRANSLATOR_PANEL_STORAGE_KEY, '{ not json')
    act(() => { reloadTranslatorPanelState() })
    expect(getTranslatorPanelState('pdf')).toMatchObject({ open: false, x: null, y: null })
  })
})
