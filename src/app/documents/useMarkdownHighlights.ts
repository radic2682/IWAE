import { t } from '../../i18n'
import { loadOrQuarantine } from './storageRecovery'
import { createBrowserListStorage, usePersistedIdList, type PersistedListOptions, type PersistedListStorage } from './usePersistedIdList'
import { markdownHighlightsCodec, readMarkdownHighlights, subscribeVaultFile, writeMarkdownHighlights, type VaultHandle } from '../../bridge/vault'
import {
  markdownHighlightFile,
  parsePersistentMarkdownHighlights,
  type PersistentMarkdownHighlight,
} from '../../core/markdownHighlight'

export type MarkdownHighlightStorage = PersistedListStorage<PersistentMarkdownHighlight>

export function createBrowserMarkdownHighlightStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
): MarkdownHighlightStorage {
  return createBrowserListStorage(storage, 'iwae:markdown-highlights:v1', parsePersistentMarkdownHighlights, markdownHighlightFile)
}

export function createVaultMarkdownHighlightStorage(vault: VaultHandle): MarkdownHighlightStorage {
  return {
    load: () => loadOrQuarantine(vault, 'markdown-highlights.json', t('Markdown 형광펜'), [], () => readMarkdownHighlights(vault)),
    save: (highlights) => writeMarkdownHighlights(vault, highlights),
    subscribe: (onRemote) => subscribeVaultFile(vault, 'markdown-highlights.json', markdownHighlightsCodec, onRemote),
  }
}

const options: PersistedListOptions<PersistentMarkdownHighlight> = {
  normalize: (list) => parsePersistentMarkdownHighlights(markdownHighlightFile(list)),
  undoKey: 'md-hl',
  saveError: (error) => t('Markdown 형광펜을 저장하지 못했습니다: {error}', { error }),
}

export function useMarkdownHighlights(storage: MarkdownHighlightStorage) {
  const { items, add, remove } = usePersistedIdList(storage, options)
  return { highlights: items, add, remove }
}
