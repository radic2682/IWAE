// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationCard, TranslationCardSettingsContext, type TranslationCardState } from './TranslationCard'
import { getTranslationSource, reloadTranslationSource, setTranslationSource } from './translationPair'

const RESULT: TranslationCardState = { status: 'result', translation: { text: '번역', targetLanguage: 'en', model: 'm' } }

/** App 처럼 번역 설정(번역 언어)을 들고 있는 상자 */
function Harness({ original, target, onRetranslate, state = RESULT }: {
  readonly original: string
  readonly target: string
  readonly onRetranslate: () => void
  readonly state?: TranslationCardState
}) {
  const [targetLanguage, setTargetLanguage] = useState(target)
  return (
    <TranslationCardSettingsContext.Provider value={{ targetLanguage, providerLabel: 'Azure', onChangeTargetLanguage: setTargetLanguage }}>
      <div style={{ position: 'relative' }}>
        <TranslationCard original={original} state={state} ariaLabel="카드" onClose={vi.fn()} onRetry={vi.fn()} onRetranslateAfterLanguageChange={onRetranslate} />
      </div>
    </TranslationCardSettingsContext.Provider>
  )
}

const select = (name: string) => screen.getByLabelText(name) as HTMLSelectElement
const card = () => screen.getByRole('region', { name: '카드' })
const header = () => card().querySelector('.translation-card-header') as HTMLElement

beforeEach(() => {
  window.localStorage.clear()
  setTranslationSource('auto')
})
afterEach(cleanup)

describe('번역 카드: 끌어 옮기기', () => {
  const mockRect = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('translation-card')
      ? ({ left: 100, top: 100, right: 480, bottom: 300, width: 380, height: 200, x: 100, y: 100, toJSON: () => ({}) })
      : ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
  })

  it('머리 줄을 끌면 카드가 따라 움직이고, 놓은 뒤에도 그 자리에 있다', () => {
    const spy = mockRect()
    render(<Harness original="hello world" target="ko" onRetranslate={vi.fn()} />)
    fireEvent.pointerDown(header(), { button: 0, clientX: 200, clientY: 120, pointerId: 1 })
    fireEvent.pointerMove(header(), { clientX: 240, clientY: 150, pointerId: 1 })
    expect(card().style.transform).toBe('translate(40px, 30px)')
    fireEvent.pointerUp(header(), { pointerId: 1 })
    fireEvent.pointerMove(header(), { clientX: 300, clientY: 300, pointerId: 1 })
    expect(card().style.transform).toBe('translate(40px, 30px)')
    spy.mockRestore()
  })

  it('화면 밖으로는 나가지 않는다', () => {
    const spy = mockRect()
    render(<Harness original="hello world" target="ko" onRetranslate={vi.fn()} />)
    fireEvent.pointerDown(header(), { button: 0, clientX: 200, clientY: 120, pointerId: 1 })
    fireEvent.pointerMove(header(), { clientX: -900, clientY: -900, pointerId: 1 })
    // 왼쪽·위 여백 8px 에서 멈춘다(카드가 left 100, top 100 에서 시작)
    expect(card().style.transform).toBe('translate(-92px, -92px)')
    fireEvent.pointerMove(header(), { clientX: 9000, clientY: 9000, pointerId: 1 })
    expect(card().style.transform).toBe(`translate(${window.innerWidth - 8 - 480}px, ${window.innerHeight - 8 - 300}px)`)
    spy.mockRestore()
  })

  it('단추·목록에서는 끌기가 시작되지 않는다', () => {
    const spy = mockRect()
    render(<Harness original="hello world" target="ko" onRetranslate={vi.fn()} />)
    for (const target of [screen.getByRole('button', { name: '닫기' }), screen.getByRole('button', { name: '원문과 번역 언어 바꾸기' }), select('원문 언어')]) {
      fireEvent.pointerDown(target, { button: 0, clientX: 200, clientY: 120, pointerId: 1 })
      fireEvent.pointerMove(header(), { clientX: 260, clientY: 180, pointerId: 1 })
      fireEvent.pointerUp(header(), { pointerId: 1 })
      expect(card().style.transform).toBe('')
    }
    spy.mockRestore()
  })

  it('본문 글에서는 끌기가 시작되지 않는다(글을 고를 수 있다)', () => {
    const spy = mockRect()
    render(<Harness original="hello world" target="ko" onRetranslate={vi.fn()} />)
    fireEvent.pointerDown(screen.getByLabelText('번역 결과'), { button: 0, clientX: 200, clientY: 120, pointerId: 1 })
    fireEvent.pointerMove(header(), { clientX: 260, clientY: 180, pointerId: 1 })
    expect(card().style.transform).toBe('')
    spy.mockRestore()
  })

  it('카드를 닫았다 새로 열면 기본 자리에서 시작한다', () => {
    const spy = mockRect()
    const { unmount } = render(<Harness original="hello world" target="ko" onRetranslate={vi.fn()} />)
    fireEvent.pointerDown(header(), { button: 0, clientX: 200, clientY: 120, pointerId: 1 })
    fireEvent.pointerMove(header(), { clientX: 240, clientY: 150, pointerId: 1 })
    expect(card().style.transform).not.toBe('')
    unmount()
    render(<Harness original="another text" target="ko" onRetranslate={vi.fn()} />)
    expect(card().style.transform).toBe('')
    spy.mockRestore()
  })
})

describe('번역 카드: 언어 줄', () => {
  it('원문을 자동 감지로 두면 어림한 언어에서 설정의 번역 언어로 번역한다', () => {
    render(<Harness original="hello world, this is a test" target="ko" onRetranslate={vi.fn()} />)
    expect(select('원문 언어').value).toBe('auto')
    expect(select('번역할 언어').value).toBe('ko')
  })

  it('맞바꿈: 원문과 번역 언어가 서로 바뀌고 새 쌍으로 다시 번역한다', async () => {
    const onRetranslate = vi.fn()
    render(<Harness original="hello world, this is a test" target="ko" onRetranslate={onRetranslate} />)
    // 자동 감지 + 영어 글 → 맞바꾸면 원문 한국어, 번역 영어(어림한 언어가 새 번역 언어)
    fireEvent.click(screen.getByRole('button', { name: '원문과 번역 언어 바꾸기' }))
    expect(select('원문 언어').value).toBe('ko')
    expect(select('번역할 언어').value).toBe('en')
    await waitFor(() => expect(onRetranslate).toHaveBeenCalledTimes(1))
    // 한 번 더: 직접 고른 쌍은 그대로 서로 바뀐다
    fireEvent.click(screen.getByRole('button', { name: '원문과 번역 언어 바꾸기' }))
    expect(select('원문 언어').value).toBe('en')
    expect(select('번역할 언어').value).toBe('ko')
    await waitFor(() => expect(onRetranslate).toHaveBeenCalledTimes(2))
  })

  it('자동 감지인데 어림한 언어가 없으면 맞바꿈이 꺼지고 이유를 알려 준다', () => {
    render(<Harness original="1234 ... !!!" target="ko" onRetranslate={vi.fn()} />)
    const swap = screen.getByRole('button', { name: '원문과 번역 언어 바꾸기' }) as HTMLButtonElement
    expect(swap.disabled).toBe(true)
    expect(swap.title).toContain('알 수 없어')
  })

  it('원문 언어를 고르면 다시 번역하고, 고른 언어를 기억한다', async () => {
    const onRetranslate = vi.fn()
    render(<Harness original="hello world, this is a test" target="ko" onRetranslate={onRetranslate} />)
    fireEvent.change(select('원문 언어'), { target: { value: 'ja' } })
    await waitFor(() => expect(onRetranslate).toHaveBeenCalledTimes(1))
    expect(getTranslationSource()).toBe('ja')
    expect(window.localStorage.getItem('iwae:translation-source:v1')).toBe('ja')
    // 앱을 다시 켠 것처럼 저장소에서 읽어도 그대로
    act(() => { setTranslationSource('auto') })
    window.localStorage.setItem('iwae:translation-source:v1', 'ja')
    act(() => { reloadTranslationSource() })
    expect(getTranslationSource()).toBe('ja')
  })

  it('번역 언어를 고르면 설정의 번역 언어가 바뀌고 다시 번역한다', async () => {
    const onRetranslate = vi.fn()
    render(<Harness original="hello world, this is a test" target="ko" onRetranslate={onRetranslate} />)
    fireEvent.change(select('번역할 언어'), { target: { value: 'ja' } })
    expect(select('번역할 언어').value).toBe('ja')
    await waitFor(() => expect(onRetranslate).toHaveBeenCalledTimes(1))
  })

  it('원문과 같은 언어를 번역 언어로 고르면 두 언어가 맞바뀐다', () => {
    setTranslationSource('en')
    render(<Harness original="hello world, this is a test" target="ko" onRetranslate={vi.fn()} />)
    fireEvent.change(select('번역할 언어'), { target: { value: 'en' } })
    expect(select('원문 언어').value).toBe('ko')
    expect(select('번역할 언어').value).toBe('en')
  })
})
