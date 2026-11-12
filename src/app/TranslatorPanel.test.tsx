// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TranslationCardSettingsContext } from '../ui/TranslationCard'
import { setTranslationSource } from '../ui/translationPair'
import { publishReaderSelection } from './readerSelectionStore'
import { TranslatorPanel } from './TranslatorPanel'
import { paneNode, splitLeaf } from '../core/layoutTree'
import { activeScreenOf, blankScreen, type Screen } from './screens'
import { tabsOf } from './tabs'
import type { FloatModel } from './floatingPanes'
import {
  TRANSLATOR_MIGRATED_KEY,
  TRANSLATOR_PANEL_STORAGE_KEY,
  finishLegacyTranslatorMigration,
  migrateLegacyTranslators,
  placePanel,
  readLegacyTranslatorPanels,
} from './translatorPanelState'
import { TranslatorContext, type TranslatorService } from './translatorContext'

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

/** 떠 있는 칸의 본문(번역기 탭의 내용)으로 그린다 */
function renderInPane(service: TranslatorService) {
  const host = document.createElement('div')
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

const input = () => screen.getByLabelText('번역할 글') as HTMLTextAreaElement

beforeEach(() => {
  window.localStorage.clear()
  setTranslationSource('auto')
  act(() => { publishReaderSelection('test', '') })
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('번역기 탭의 내용', () => {
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

  it('⇄ 는 번역 결과를 입력으로 옮기고 거꾸로 번역한다', async () => {
    const service = makeService()
    renderInPane(service)
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
    renderInPane(service)
    expect(screen.queryByRole('button', { name: '선택한 글 넣기' })).toBeNull()
    act(() => { publishReaderSelection('test', 'selected\ntext from the page') })
    fireEvent.click(screen.getByRole('button', { name: '선택한 글 넣기' }))
    expect(input().value).toBe('selected text from the page')
    expect(service.translate).not.toHaveBeenCalled()
    act(() => { publishReaderSelection('test', '') })
    expect(screen.queryByRole('button', { name: '선택한 글 넣기' })).toBeNull()
  })

  it('Esc 는 칸을 닫지 않고 글쓰기 칸의 포커스만 뺀다', () => {
    renderInPane(makeService())
    input().focus()
    expect(document.activeElement).toBe(input())
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(document.activeElement).not.toBe(input())
    expect(screen.getByRole('region', { name: '번역기' })).toBeDefined()
  })

  it('스스로 떠 있지 않다: 머리 줄 · 닫기 · 크기 손잡이는 떠 있는 칸이 가진다', () => {
    const { host } = renderInPane(makeService())
    expect(host.querySelector('.translator-panel-header')).toBeNull()
    expect(screen.queryByRole('button', { name: '번역기 닫기' })).toBeNull()
    expect(screen.queryByRole('separator', { name: '번역기 크기 바꾸기' })).toBeNull()
    const root = screen.getByRole('region', { name: '번역기' }) as HTMLElement
    expect(root.style.left).toBe('')
    expect(root.style.top).toBe('')
  })

  it('번역기를 설정하지 않았으면(서비스 없음) 입력 전에 안내한다', () => {
    const view = render(
      <TranslatorContext.Provider value={null}>
        <TranslationCardSettingsContext.Provider value={{ targetLanguage: 'ko', providerLabel: '', onChangeTargetLanguage: () => undefined }}>
          <TranslatorPanel />
        </TranslationCardSettingsContext.Provider>
      </TranslatorContext.Provider>,
    )
    expect(screen.getByRole('alert').textContent).toContain('번역기를 아직 설정하지 않았습니다')
    view.unmount()
  })
})

describe('예전 떠 있는 번역기 값 옮기기', () => {
  const legacyAt = (state: object) => ({ getItem: (key: string) => (key === TRANSLATOR_PANEL_STORAGE_KEY ? JSON.stringify(state) : null), setItem: vi.fn(), removeItem: vi.fn() })

  it('칸이 작아지면 번역기도 칸 안으로 들어온다', () => {
    const box = placePanel({ x: 700, y: 500, w: 340, h: 380 }, { width: 500, height: 400 })
    expect(box.x + box.w).toBeLessThanOrEqual(500 - 8)
    expect(box.y + box.h).toBeLessThanOrEqual(400 - 8)
    expect(box.x).toBeGreaterThanOrEqual(8)
  })

  it('칸 위에 떠 있는 도구줄(top) 아래에만 놓인다', () => {
    const box = placePanel({ x: 100, y: 0, w: 340, h: 380 }, { width: 900, height: 900, top: 37 })
    expect(box.y).toBeGreaterThanOrEqual(37 + 8)
    const fresh = placePanel({ x: null, y: null, w: 340, h: 380 }, { width: 900, height: 900, top: 37 })
    expect(fresh.y).toBeGreaterThanOrEqual(37 + 8)
    const tall = placePanel({ x: 100, y: 0, w: 340, h: 2000 }, { width: 900, height: 600, top: 37 })
    expect(tall.y + tall.h).toBeLessThanOrEqual(600 - 8)
  })

  it('저장된 값을 문서 종류마다 읽고, 깨진 값 · 값이 없음 · 이미 옮김은 null', () => {
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

  const modelWithDocPane = (): FloatModel => {
    const screen: Screen = { ...blankScreen('읽기'), layout: paneNode('a'), panes: { a: { tabs: [{ id: 'd1', title: 'D', kind: 'pdf' }], activeId: 'd1' } }, channels: { a: 'blue' } }
    return { screens: { screens: [screen], activeScreen: screen.id, lastScreen: null }, activePane: 'a' }
  }
  const legacyState = (pdf: object, markdown: object = { open: false }) => readLegacyTranslatorPanels(legacyAt({ pdf, markdown }))!

  it('열어 두었던 번역기는 같은 종류의 문서를 보는 칸에 붙은 번역기 떠 있는 칸이 되고, 자리는 칸 크기에 대한 비율이다', () => {
    const next = migrateLegacyTranslators(modelWithDocPane(), legacyState({ open: true, x: 100, y: 50, w: 360, h: 300 }), [{ pane: 'a', kind: 'pdf', width: 800, height: 600 }])
    const floats = activeScreenOf(next.screens).floats
    expect(floats).toHaveLength(1)
    expect(floats[0]).toMatchObject({ anchor: { kind: 'pane', paneId: 'a' }, x: 100 / 800, y: 50 / 600, w: 360, h: 300, collapsed: false })
    expect(tabsOf(activeScreenOf(next.screens).panes, floats[0]!.paneId).tabs[0]).toMatchObject({ kind: 'translator' })
    // 사람이 만지던 칸은 그대로다
    expect(next.activePane).toBe('a')
  })

  it('칸이 작으면 칸 안으로 들어오게 옮기고, 칸 크기를 모르면 800×600 칸으로 본다', () => {
    const small = migrateLegacyTranslators(modelWithDocPane(), legacyState({ open: true, x: 700, y: 500, w: 340, h: 380 }), [{ pane: 'a', kind: 'pdf', width: 500, height: 400 }])
    const float = activeScreenOf(small.screens).floats[0]!
    expect(float.x * 500 + float.w).toBeLessThanOrEqual(500 - 8 + 0.001)
    const unknown = migrateLegacyTranslators(modelWithDocPane(), legacyState({ open: true, x: 100, y: 50, w: 360, h: 300 }), [{ pane: 'a', kind: 'pdf', width: 0, height: 0 }])
    expect(activeScreenOf(unknown.screens).floats[0]).toMatchObject({ x: 100 / 800, y: 50 / 600 })
  })

  it('닫혀 있던 번역기 · 그 종류의 문서를 보는 칸이 없음 · 이미 그 칸에 번역기가 있음은 옮기지 않는다', () => {
    const model = modelWithDocPane()
    expect(migrateLegacyTranslators(model, legacyState({ open: false }), [{ pane: 'a', kind: 'pdf', width: 800, height: 600 }])).toBe(model)
    expect(migrateLegacyTranslators(model, legacyState({ open: true }), [{ pane: 'a', kind: 'markdown', width: 800, height: 600 }])).toBe(model)
    const once = migrateLegacyTranslators(model, legacyState({ open: true }), [{ pane: 'a', kind: 'pdf', width: 800, height: 600 }])
    const twice = migrateLegacyTranslators(once, legacyState({ open: true }), [{ pane: 'a', kind: 'pdf', width: 800, height: 600 }])
    expect(activeScreenOf(twice.screens).floats).toHaveLength(1)
  })

  it('PDF 와 Markdown 이 모두 열려 있었으면 각 종류의 칸에 하나씩 만든다', () => {
    const screen: Screen = {
      ...blankScreen('읽기'),
      layout: splitLeaf(paneNode('a'), 'a', 'h', 'b'),
      panes: { a: { tabs: [{ id: 'd1', title: 'D', kind: 'pdf' }], activeId: 'd1' }, b: { tabs: [{ id: 'm.md', title: 'M', kind: 'markdown' }], activeId: 'm.md' } },
      channels: { a: 'blue', b: 'blue' },
    }
    const model: FloatModel = { screens: { screens: [screen], activeScreen: screen.id, lastScreen: null }, activePane: 'a' }
    const next = migrateLegacyTranslators(model, legacyState({ open: true }, { open: true }), [
      { pane: 'a', kind: 'pdf', width: 400, height: 600 }, { pane: 'b', kind: 'markdown', width: 400, height: 600 },
    ])
    expect(activeScreenOf(next.screens).floats.map((float) => float.anchor)).toEqual([{ kind: 'pane', paneId: 'a' }, { kind: 'pane', paneId: 'b' }])
  })
})
