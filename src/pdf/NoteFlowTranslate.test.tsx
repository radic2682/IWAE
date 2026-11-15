// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NoteFlow, type NoteFlowItem } from './NoteFlow'
import { TranslationCardSettingsContext } from '../ui/TranslationCard'

const store = vi.hoisted(() => ({
  cachedTranslation: vi.fn((_text: string, _target?: string) => undefined as string | undefined),
  translateWithCache: vi.fn(async (_text: string, _meta: unknown, _force?: boolean, _target?: string, _source?: string) => 'Hello' as string | null),
}))
vi.mock('../app/translation/translationCacheStore', () => ({
  cachedTranslation: store.cachedTranslation,
  translateWithCache: store.translateWithCache,
  useTranslationCache: () => ({ enabled: true, count: 0, entries: [], ready: true }),
}))

const handlers = () => ({
  editingKey: null, activeKey: null, pageSizeOf: () => undefined,
  onEdit: vi.fn(), onActivate: vi.fn(), onSaveMemo: vi.fn(), onCancelDraft: vi.fn(), onSaveText: vi.fn(), onRemoveText: vi.fn(),
  onRecolor: vi.fn(), onDeleteMemo: vi.fn(), onToggleCollapse: vi.fn(), onRate: vi.fn(), onMove: vi.fn(), onJump: vi.fn(), onCardLayout: vi.fn(),
})

describe('NoteFlow memo card translation', () => {
  it('normalises the quote and translates Korean text into English when the target is Korean', () => {
    const highlight = {
      id: 'h1', color: 'green' as const, note: '메모',
      anchor: { docId: 'd', page: 1, coordSpace: 'pdfium-page' as const, rects: [{ x: 1, y: 1, w: 1, h: 1 }], charRange: [0, 1] as const, quote: '안녕하세요\r\n반갑습니다', prefix: '', suffix: '' },
    }
    const items: NoteFlowItem[] = [{ kind: 'memo', key: 'b1', highlight }]
    render(
      <TranslationCardSettingsContext.Provider value={{ targetLanguage: 'ko', providerLabel: 'x', onChangeTargetLanguage: () => undefined }}>
        <NoteFlow {...handlers()} items={items} openQuotes={new Set(['h1'])} />
      </TranslationCardSettingsContext.Provider>,
    )
    fireEvent.click(screen.getAllByRole('button', { name: /번역/u })[0]!)
    expect(store.cachedTranslation).toHaveBeenCalledWith('안녕하세요 반갑습니다', 'en')
    expect(store.translateWithCache.mock.calls[0]?.[0]).toBe('안녕하세요 반갑습니다')
    expect(store.translateWithCache.mock.calls[0]?.[3]).toBe('en')
  })
})
