// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PdfExcerptSelection } from '../core/pdfExcerpt'
import { TranslationCardSettingsContext } from '../ui/TranslationCard'
import { SelectionActions } from './SelectionActions'

function selection(
  mode: PdfExcerptSelection['mode'],
  quote: string,
): PdfExcerptSelection {
  return {
    mode,
    anchor: {
      docId: '0123456789ab',
      page: 2,
      coordSpace: 'pdfium-page',
      rects: [{ x: 10, y: 20, w: 80, h: 24 }],
      charRange: quote === '' ? [0, 0] : [4, 4 + quote.length],
      quote,
      prefix: '',
      suffix: '',
    },
    pageSize: [612, 792],
    crop: { x: 10, y: 20, w: 80, h: 24 },
    glyphs: quote === ''
      ? []
      : [...quote].map((c, index) => ({ c, x: 10 + index * 6, y: 20, w: 6, h: 12 })),
  }
}

const translated = {
  text: '선택한 텍스트의 번역 결과',
  targetLanguage: 'ko',
  model: 'translategemma:4b',
}

function deferred(): {
  promise: Promise<typeof translated>
  resolve: (result: typeof translated) => void
} {
  let resolve!: (result: typeof translated) => void
  const promise = new Promise<typeof translated>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('SelectionActions', () => {
  it('텍스트 선택에서 복사·노트로 보내기·번역 동작을 선택 정보와 함께 알린다', () => {
    const current = selection('text', 'selected text')
    const onCopy = vi.fn()
    const onSendToCanvas = vi.fn()
    const onTranslate = vi.fn()
    render(
      <SelectionActions
        selection={current}
        onCopy={onCopy}
        onSendToCanvas={onSendToCanvas}
        onTranslate={onTranslate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '복사' }))
    fireEvent.click(screen.getByRole('button', { name: '노트로 보내기' }))
    fireEvent.click(screen.getByRole('button', { name: '번역' }))

    expect(onCopy).toHaveBeenCalledWith(current)
    expect(onSendToCanvas).toHaveBeenCalledWith(current)
    expect(onTranslate).toHaveBeenCalledWith(current)
  })

  it('텍스트가 포함된 영역 선택에서도 텍스트 전용 동작을 활성화한다', () => {
    const current = selection('region', 'region text')
    render(
      <SelectionActions
        selection={current}
        onCopy={vi.fn()}
        onSendToCanvas={vi.fn()}
        onTranslate={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '복사' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '번역' }).hasAttribute('disabled')).toBe(false)
  })

  it('이미지 전용 영역은 복사·번역을 비활성화하고 노트 전송은 허용한다', () => {
    const current = selection('region', '')
    const onCopy = vi.fn()
    const onSendToCanvas = vi.fn()
    const onTranslate = vi.fn()
    render(
      <SelectionActions
        selection={current}
        onCopy={onCopy}
        onSendToCanvas={onSendToCanvas}
        onTranslate={onTranslate}
      />,
    )

    const copy = screen.getByRole('button', { name: '복사' })
    const send = screen.getByRole('button', { name: '노트로 보내기' })
    const translate = screen.getByRole('button', { name: '번역' })
    expect(copy.hasAttribute('disabled')).toBe(true)
    expect(send.hasAttribute('disabled')).toBe(false)
    expect(translate.hasAttribute('disabled')).toBe(true)

    fireEvent.click(copy)
    fireEvent.click(send)
    fireEvent.click(translate)
    expect(onCopy).not.toHaveBeenCalled()
    expect(onSendToCanvas).toHaveBeenCalledWith(current)
    expect(onTranslate).not.toHaveBeenCalled()
  })

  it('번역 핸들러가 없으면 텍스트 선택에서도 번역 버튼을 비활성화한다', () => {
    render(
      <SelectionActions
        selection={selection('text', 'selected text')}
        onCopy={vi.fn()}
        onSendToCanvas={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '번역' }).hasAttribute('disabled')).toBe(true)
  })

  it('노트 전송 핸들러가 없으면 노트로 보내기를 보이지 않는다', () => {
    render(
      <SelectionActions
        selection={selection('text', 'selected text')}
        onCopy={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '노트로 보내기' })).toBeNull()
  })

  it('번역 중복 요청을 막고 완료 문구 대신 실제 번역문과 블록 추가 버튼을 표시한다', async () => {
    const pending = deferred()
    const onTranslate = vi.fn().mockReturnValue(pending.promise)
    const onSendTranslationToCanvas = vi.fn()
    const current = selection('text', 'selected text')
    render(
      <SelectionActions
        selection={current}
        onCopy={vi.fn()}
        onTranslate={onTranslate}
        onSendTranslationToCanvas={onSendTranslationToCanvas}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '번역' }))

    const translating = screen.getByRole('button', { name: '번역 중…' })
    expect(translating.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('toolbar', { name: 'PDF 선택 작업' })).toBeDefined()
    fireEvent.click(translating)
    expect(onTranslate).toHaveBeenCalledTimes(1)

    pending.resolve(translated)
    const translationResult = await screen.findByLabelText('번역 결과')
    expect(translationResult.textContent).toBe(translated.text)
    expect(screen.getByRole('toolbar', { name: 'PDF 선택 작업' }).contains(translationResult)).toBe(false)
    expect(screen.queryByText('번역이 완료되었습니다.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '노트에 넣기' }))
    expect(onSendTranslationToCanvas).toHaveBeenCalledWith(current, translated)
    expect(screen.getByRole('toolbar', { name: 'PDF 선택 작업' })).toBeDefined()
  })

  it('번역 실패 이유와 재시도 동작을 선택 작업에 표시한다', async () => {
    const onTranslate = vi.fn()
      .mockRejectedValueOnce(new Error('Ollama connection refused'))
      .mockResolvedValueOnce(translated)
    render(
      <SelectionActions
        selection={selection('text', 'selected text')}
        onCopy={vi.fn()}
        onTranslate={onTranslate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '번역' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Ollama connection refused')
    const retry = screen.getByRole('button', { name: '번역 다시 시도' })
    expect(retry.hasAttribute('disabled')).toBe(false)
    fireEvent.click(retry)

    await waitFor(() => expect(screen.getByLabelText('번역 결과').textContent).toBe(translated.text))
    expect(onTranslate).toHaveBeenCalledTimes(2)
  })
})

describe('SelectionActions — 포커스·번역 실패', () => {
  it('작업 단추를 눌러도 포커스를 가져가지 않는다(메모 칸이 닫히며 고른 것이 풀리지 않게)', () => {
    render(<SelectionActions selection={selection('text', 'abc')} onCopy={vi.fn()} onTranslate={vi.fn()} />)
    const button = screen.getByRole('button', { name: '번역' })
    expect(fireEvent.pointerDown(button)).toBe(false)
    expect(fireEvent.mouseDown(button)).toBe(false)
  })

  it('번역에 실패하면 까닭과 함께 번역 설정을 여는 단추를 보인다', async () => {
    const opened = vi.fn()
    window.addEventListener('iwae:open-translation-settings', opened)
    render(<SelectionActions selection={selection('text', 'abc')} onCopy={vi.fn()} onTranslate={vi.fn().mockRejectedValue(new Error('Ollama에 연결할 수 없습니다.'))} />)
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Ollama에 연결할 수 없습니다.')
    fireEvent.click(screen.getByRole('button', { name: '번역 설정 열기' }))
    expect(opened).toHaveBeenCalledTimes(1)
    window.removeEventListener('iwae:open-translation-settings', opened)
  })

  it('번역 결과를 복사할 수 있다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<SelectionActions selection={selection('text', 'abc')} onCopy={vi.fn()} onTranslate={vi.fn().mockResolvedValue(translated)} />)
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    const card = await screen.findByRole('region', { name: '번역 결과 패널' })
    await screen.findByLabelText('번역 결과')
    fireEvent.click(within(card).getByRole('button', { name: '복사' }))
    expect(writeText).toHaveBeenCalledWith(translated.text)
    fireEvent.click(within(card).getByRole('button', { name: '원문과 함께 복사' }))
    expect(writeText).toHaveBeenLastCalledWith(`abc

${translated.text}`)
  })

  it('다시 누르면 캐시를 건너뛰고 다시 번역하며, Esc 와 ✕ 로 카드를 닫는다', async () => {
    const onTranslate = vi.fn().mockResolvedValue(translated)
    render(<SelectionActions selection={selection('text', 'abc')} onCopy={vi.fn()} onTranslate={onTranslate} />)
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    await screen.findByLabelText('번역 결과')
    fireEvent.click(screen.getByRole('button', { name: '다시' }))
    await waitFor(() => expect(onTranslate).toHaveBeenCalledTimes(2))
    expect(onTranslate).toHaveBeenLastCalledWith(expect.anything(), { force: true })
    await screen.findByLabelText('번역 결과')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: '번역 결과 패널' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    await screen.findByLabelText('번역 결과')
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('region', { name: '번역 결과 패널' })).toBeNull()
  })

  it('원문이 이미 설정의 번역 언어면 다른 언어로 번역하고 그 쌍을 칩에 보인다', async () => {
    const onTranslate = vi.fn().mockResolvedValue({ ...translated, targetLanguage: 'en' })
    render(
      <TranslationCardSettingsContext.Provider value={{ targetLanguage: 'ko', providerLabel: 'Azure', onChangeTargetLanguage: vi.fn() }}>
        <SelectionActions selection={selection('text', '이번 주에 읽은 논문 정리')} onCopy={vi.fn()} onTranslate={onTranslate} />
      </TranslationCardSettingsContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '번역' }))
    await screen.findByLabelText('번역 결과')
    expect(onTranslate).toHaveBeenCalledWith(expect.anything(), { targetLanguage: 'en' })
    expect(screen.getByRole('button', { name: '번역 언어 바꾸기' }).textContent).toBe('한국어English')
  })
})
