import { useCallback } from 'react'
import { t } from '../../i18n'
import { loadOrQuarantine } from './storageRecovery'
import { createBrowserListStorage, usePersistedIdList, type PersistedListOptions, type PersistedListStorage } from './usePersistedIdList'
import { markFreshHighlight } from '../../pdf/freshHighlight'
import { pdfHighlightsCodec, readPdfHighlights, subscribeVaultFile, writePdfHighlights, type VaultHandle } from '../../bridge/vault'
import {
  parsePersistentPdfHighlights,
  persistentPdfHighlightFile,
  updatePersistentPdfHighlight,
  type PersistentPdfHighlight,
  type PersistentPdfHighlightPatch,
} from '../../pdf/persistentHighlight'

export type PdfHighlightStorage = PersistedListStorage<PersistentPdfHighlight>

export function createBrowserPdfHighlightStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
): PdfHighlightStorage {
  return createBrowserListStorage(storage, 'iwae:pdf-highlights:v1', parsePersistentPdfHighlights, persistentPdfHighlightFile)
}

export function createVaultPdfHighlightStorage(vault: VaultHandle): PdfHighlightStorage {
  return {
    load: () => loadOrQuarantine(vault, 'highlights.json', t('형광펜 기록'), [], () => readPdfHighlights(vault)),
    save: (highlights) => writePdfHighlights(vault, highlights),
    subscribe: (onRemote) => subscribeVaultFile(vault, 'highlights.json', pdfHighlightsCodec, onRemote),
  }
}

const options: PersistedListOptions<PersistentPdfHighlight> = {
  normalize: (list) => parsePersistentPdfHighlights(persistentPdfHighlightFile(list)),
  undoKey: 'pdf-hl',
  saveError: (error) => t('형광펜을 저장하지 못했습니다: {error}', { error }),
  onAdd: (highlight) => markFreshHighlight(highlight.id),
}

export function usePdfHighlights(storage: PdfHighlightStorage) {
  const list = usePersistedIdList(storage, options)
  const { update: updateItem } = list
  /** 색·메모·근거·주제를 고친다. 없는 id 는 조용히 지나간다 */
  const update = useCallback((highlightId: string, patch: PersistentPdfHighlightPatch) => {
    updateItem(highlightId, (item) => updatePersistentPdfHighlight(item, patch))
  }, [updateItem])
  return { highlights: list.items, add: list.add, addMany: list.addMany, remove: list.remove, update, mapAll: list.mapAll }
}
