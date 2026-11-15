import { useCallback, useEffect, useRef, useState } from 'react'
import { readCanvas, writeCanvas, type VaultHandle } from '../../bridge/vault'
import {
  parseCanvasDocument,
  type CanvasDocument,
  type CanvasDocumentV2,
} from '../../core/canvasDocument'
import { serializeCanvasDoc } from '../../core/canvasSerialize'
import { SaveQueue } from '../../core/saveQueue'

export type CanvasSaveStatus = 'loading' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error' | 'recovered'

export class StorageConflictError extends Error {
  override readonly name = 'StorageConflictError'
}

const canvasSaveQueue = new SaveQueue()
const canvasSaveFlushers = new Map<string, () => Promise<void>>()

/**
 * 캔버스 말고도 닫기 전에 끝내야 하는 저장(예: 잠시 미뤄 둔 메모 노트 저장)을 등록한다.
 * flushCanvasSaves() 가 창을 닫기·Vault 바꾸기 전에 함께 부른다. 돌려주는 함수로 뺀다.
 */
export function registerSaveFlusher(key: string, flush: () => Promise<void>): () => void {
  canvasSaveFlushers.set(key, flush)
  return () => {
    if (canvasSaveFlushers.get(key) === flush) canvasSaveFlushers.delete(key)
  }
}

/**
 * 칸을 닫거나 탭을 바꿔 캔버스가 사라질 때 저장에 실패한 수정. 사라진 뒤에는 고칠 화면이 없으므로 여기에 남겨 둔다.
 * flushCanvasSaves() 가 다시 저장해 보고(실패하면 실패로 알린다), 같은 노트를 다시 열면 이어받는다.
 */
interface FailedUnmountSave {
  readonly document: CanvasDocumentV2
  readonly signature: string
  retry(): Promise<void>
}
const failedUnmountSaves = new Map<string, FailedUnmountSave>()

export async function flushCanvasSaves(noteId?: string): Promise<void> {
  const failed = noteId === undefined ? [...failedUnmountSaves.values()] : [failedUnmountSaves.get(noteId)].filter((item) => item !== undefined)
  if (noteId === undefined) {
    await Promise.all([...canvasSaveFlushers.values()].map((flush) => flush()).concat(failed.map((item) => item.retry())))
  } else {
    await Promise.all([canvasSaveFlushers.get(noteId)?.(), ...failed.map((item) => item.retry())])
  }
  await canvasSaveQueue.flush(noteId)
}

export interface CanvasStorage {
  load(noteId: string): Promise<CanvasDocumentV2 | null>
  save(noteId: string, document: CanvasDocument): Promise<void>
}

interface PendingSave {
  readonly document: CanvasDocumentV2
  readonly signature: string
}

interface UseCanvasAutosaveOptions {
  readonly noteId: string
  readonly fallbackDocument: CanvasDocument
  readonly storage: CanvasStorage
  readonly delay?: number
  readonly onDirtyChange?: (dirty: boolean) => void
}

export function createBrowserCanvasStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
): CanvasStorage {
  return {
    async load(noteId) {
      const serialized = storage.getItem(`iwae:canvas:${noteId}`)
      if (serialized === null) return null
      return parseCanvasDocument(JSON.parse(serialized) as unknown)
    },
    async save(noteId, document) {
      storage.setItem(`iwae:canvas:${noteId}`, serializeCanvasDoc(parseCanvasDocument(document)))
    },
  }
}

export function createMemoryCanvasStorage(): CanvasStorage {
  const documents = new Map<string, string>()
  return {
    async load(noteId) {
      const serialized = documents.get(noteId)
      return serialized === undefined ? null : parseCanvasDocument(JSON.parse(serialized) as unknown)
    },
    async save(noteId, document) {
      documents.set(noteId, serializeCanvasDoc(parseCanvasDocument(document)))
    },
  }
}

export function createVaultCanvasStorage(vault: VaultHandle): CanvasStorage {
  return {
    load: (noteId) => readCanvas(vault, noteId),
    save: (noteId, document) => writeCanvas(vault, noteId, document),
  }
}

export function useCanvasAutosave({
  noteId,
  fallbackDocument,
  storage,
  delay = 500,
  onDirtyChange,
}: UseCanvasAutosaveOptions) {
  const fallbackSignature = serializeCanvasDoc(parseCanvasDocument(fallbackDocument))
  const [document, setDocumentState] = useState<CanvasDocumentV2>(() => parseCanvasDocument(fallbackDocument))
  const [status, setStatus] = useState<CanvasSaveStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const readyRef = useRef(false)
  const savedSignatureRef = useRef('')
  const pendingRef = useRef<PendingSave | null>(null)
  const timerRef = useRef<number | null>(null)
  const generationRef = useRef(0)
  const dirtyChangeRef = useRef(onDirtyChange)
  dirtyChangeRef.current = onDirtyChange

  const reportDirty = useCallback((dirty: boolean) => {
    dirtyChangeRef.current?.(dirty)
  }, [])

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const persist = useCallback(async (pending: PendingSave) => {
    timerRef.current = null
    setStatus('saving')
    try {
      await canvasSaveQueue.enqueue(noteId, () => storage.save(noteId, pending.document))
      if (pendingRef.current?.signature !== pending.signature) return
      savedSignatureRef.current = pending.signature
      pendingRef.current = null
      setError(null)
      setStatus('saved')
      reportDirty(false)
    } catch (cause) {
      if (pendingRef.current?.signature !== pending.signature) return
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus(cause instanceof StorageConflictError ? 'conflict' : 'error')
      throw cause
    }
  }, [noteId, reportDirty, storage])

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    readyRef.current = false
    pendingRef.current = null
    clearTimer()
    reportDirty(false)
    setStatus('loading')
    setError(null)
    setDocumentState(parseCanvasDocument(fallbackDocument))

    void storage.load(noteId).then((restored) => {
      if (generationRef.current !== generation) return
      const loaded = parseCanvasDocument(restored ?? fallbackDocument)
      savedSignatureRef.current = serializeCanvasDoc(loaded)
      readyRef.current = true
      // 이 노트를 닫을 때 저장하지 못한 수정이 있으면 디스크 내용 대신 그것을 이어받는다
      const failed = failedUnmountSaves.get(noteId)
      if (failed !== undefined) {
        failedUnmountSaves.delete(noteId)
        pendingRef.current = { document: failed.document, signature: failed.signature }
        setDocumentState(failed.document)
        setStatus('dirty')
        reportDirty(true)
        timerRef.current = window.setTimeout(() => void persist(pendingRef.current!).catch(() => {}), delay)
        return
      }
      setDocumentState(loaded)
      setStatus('saved')
      reportDirty(false)
    }).catch((cause: unknown) => {
      if (generationRef.current !== generation) return
      savedSignatureRef.current = fallbackSignature
      readyRef.current = true
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('error')
    })

    return () => {
      generationRef.current += 1
    }
  }, [clearTimer, delay, fallbackSignature, noteId, persist, reportDirty, storage])

  const setDocument = useCallback((nextDocument: CanvasDocument) => {
    const parsed = parseCanvasDocument(nextDocument)
    const signature = serializeCanvasDoc(parsed)
    setDocumentState(parsed)
    if (!readyRef.current) return
    if (signature === savedSignatureRef.current && timerRef.current !== null) {
      pendingRef.current = null
      clearTimer()
      setError(null)
      setStatus('saved')
      reportDirty(false)
      return
    }
    if (signature === savedSignatureRef.current && pendingRef.current === null) return

    const pending = { document: parsed, signature }
    pendingRef.current = pending
    clearTimer()
    setError(null)
    setStatus('dirty')
    reportDirty(true)
    timerRef.current = window.setTimeout(() => void persist(pending).catch(() => {}), delay)
  }, [clearTimer, delay, persist, reportDirty])

  const flushPending = useCallback(async () => {
    clearTimer()
    const pending = pendingRef.current
    if (pending !== null) await persist(pending)
  }, [clearTimer, persist])

  useEffect(() => {
    canvasSaveFlushers.set(noteId, flushPending)
    return () => {
      if (canvasSaveFlushers.get(noteId) === flushPending) canvasSaveFlushers.delete(noteId)
      clearTimer()
      const pending = pendingRef.current
      if (pending !== null) {
        const save = () => canvasSaveQueue.enqueue(noteId, () => storage.save(noteId, pending.document))
        const retry = async () => {
          await save()
          if (failedUnmountSaves.get(noteId)?.retry === retry) failedUnmountSaves.delete(noteId)
          reportDirty(false)
        }
        // 실패하면 버리지 않고 남겨 둔다: 나갈 때(flush) 다시 시도하고 실패로 알리며, 같은 노트를 다시 열면 이어받는다
        void save()
          .then(() => reportDirty(false))
          .catch(() => { failedUnmountSaves.set(noteId, { document: pending.document, signature: pending.signature, retry }) })
      }
    }
  }, [clearTimer, flushPending, noteId, reportDirty, storage])

  useEffect(() => {
    const flushBeforeUnload = () => {
      void flushPending().catch(() => {})
    }
    window.addEventListener('beforeunload', flushBeforeUnload)
    return () => window.removeEventListener('beforeunload', flushBeforeUnload)
  }, [flushPending])

  return { document, setDocument, status, error }
}
