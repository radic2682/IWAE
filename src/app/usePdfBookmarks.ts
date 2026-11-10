import { useCallback, useEffect, useRef, useState } from 'react'
import { pdfBookmarksCodec, readPdfBookmarks, subscribeVaultFile, writePdfBookmarks, type VaultHandle } from '../bridge/vault'
import { createPdfBookmark, parsePdfBookmarks, pdfBookmarkFile, pdfBookmarkId, type PdfBookmark } from '../core/pdfBookmarks'

/** 핀에서 고치는 것: 이름·이모지(null 이면 이모지를 뗀다) */
export interface PdfPinPatch {
  readonly title?: string
  readonly emoji?: string | null
}

export interface PdfBookmarkStorage {
  load(): Promise<readonly PdfBookmark[]>
  save(bookmarks: readonly PdfBookmark[]): Promise<void>
  subscribe?(onRemote: (rebase: (local: readonly PdfBookmark[]) => readonly PdfBookmark[]) => void): () => void
}

export function createBrowserPdfBookmarkStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
): PdfBookmarkStorage {
  const key = 'iwae:pdf-bookmarks:v1'
  return {
    async load() {
      const serialized = storage.getItem(key)
      return serialized === null ? [] : parsePdfBookmarks(JSON.parse(serialized) as unknown)
    },
    async save(bookmarks) {
      storage.setItem(key, JSON.stringify(pdfBookmarkFile(bookmarks)))
    },
  }
}

export function createVaultPdfBookmarkStorage(vault: VaultHandle): PdfBookmarkStorage {
  return {
    load: () => readPdfBookmarks(vault),
    save: (bookmarks) => writePdfBookmarks(vault, bookmarks),
    subscribe: (onRemote) => subscribeVaultFile(vault, 'bookmarks.json', pdfBookmarksCodec, onRemote),
  }
}

export function usePdfBookmarks(storage: PdfBookmarkStorage) {
  const [bookmarks, setBookmarks] = useState<readonly PdfBookmark[]>([])
  const bookmarksRef = useRef<readonly PdfBookmark[]>([])
  const readyRef = useRef(false)
  const pendingRef = useRef<readonly { docId: string; page: number; title: string }[]>([])

  const toggled = useCallback((current: readonly PdfBookmark[], docId: string, page: number, title: string) => {
    const id = `${docId}:${page}`
    return current.some((bookmark) => bookmark.id === id)
      ? current.filter((bookmark) => bookmark.id !== id)
      : [...current, createPdfBookmark(docId, page, title)]
  }, [])

  useEffect(() => {
    let alive = true
    readyRef.current = false
    pendingRef.current = []
    bookmarksRef.current = []
    setBookmarks([])
    void storage.load().then((loaded) => {
      if (!alive) return
      const restored = pendingRef.current.reduce(
        (current, request) => toggled(current, request.docId, request.page, request.title),
        parsePdfBookmarks(pdfBookmarkFile(loaded)) as readonly PdfBookmark[],
      )
      const normalized = parsePdfBookmarks(pdfBookmarkFile(restored))
      bookmarksRef.current = normalized
      setBookmarks(normalized)
      readyRef.current = true
      if (pendingRef.current.length > 0) void storage.save(normalized).catch(() => undefined)
      pendingRef.current = []
    }).catch(() => undefined)
    return () => { alive = false }
  }, [storage, toggled])

  // 다른 창이 책갈피·핀을 고치면 이 창의 목록에 합친다
  useEffect(() => storage.subscribe?.((rebase) => {
    if (!readyRef.current) return
    const next = rebase(bookmarksRef.current)
    if (next === bookmarksRef.current) return
    bookmarksRef.current = next
    setBookmarks(next)
  }), [storage])

  const replace = useCallback((next: readonly PdfBookmark[]) => {
    const normalized = parsePdfBookmarks(pdfBookmarkFile(next))
    bookmarksRef.current = normalized
    setBookmarks(normalized)
    if (readyRef.current) void storage.save(normalized).catch(() => undefined)
  }, [storage])

  const toggle = useCallback((docId: string, page: number, title: string) => {
    if (!readyRef.current) pendingRef.current = [...pendingRef.current, { docId, page, title }]
    replace(toggled(bookmarksRef.current, docId, page, title))
  }, [replace, toggled])

  const isBookmarked = useCallback(
    (docId: string, page: number) => bookmarksRef.current.some((bookmark) => bookmark.docId === docId && bookmark.page === page),
    [],
  )

  /** 스크롤 막대 옆에 핀을 꽂는다(쪽 안의 자리 y). 같은 자리에 이미 있으면 그것을 돌려준다 */
  const addPin = useCallback((docId: string, page: number, y: number, title: string): string => {
    const pin = createPdfBookmark(docId, page, title, new Date(), y)
    const existing = bookmarksRef.current.find((bookmark) => bookmark.id === pin.id)
    if (existing !== undefined) return existing.id
    replace([...bookmarksRef.current, pin])
    return pin.id
  }, [replace])

  const updatePin = useCallback((id: string, patch: PdfPinPatch) => {
    replace(bookmarksRef.current.map((bookmark) => {
      if (bookmark.id !== id) return bookmark
      const title = patch.title === undefined ? bookmark.title : patch.title.trim() || bookmark.title
      if (patch.emoji === undefined) return { ...bookmark, title }
      const { emoji: _old, ...rest } = bookmark
      return patch.emoji === null || patch.emoji === '' ? { ...rest, title } : { ...rest, title, emoji: patch.emoji }
    }))
  }, [replace])

  /** 핀을 다른 자리(쪽·쪽 안 높이)로 옮긴다. 자리가 id 에 들어가므로 id 도 바뀐다. 새 id 를 돌려준다 */
  const movePin = useCallback((id: string, page: number, y: number): string => {
    const current = bookmarksRef.current.find((bookmark) => bookmark.id === id)
    if (current === undefined) return id
    const nextId = pdfBookmarkId(current.docId, page, y)
    if (nextId === id) return id
    // 옮긴 자리에 이미 다른 핀이 있으면 그 핀은 두고 옮기지 않는다
    if (bookmarksRef.current.some((bookmark) => bookmark.id === nextId)) return id
    replace(bookmarksRef.current.map((bookmark) => bookmark.id === id ? { ...bookmark, id: nextId, page, y } : bookmark))
    return nextId
  }, [replace])

  const remove = useCallback((id: string) => {
    replace(bookmarksRef.current.filter((bookmark) => bookmark.id !== id))
  }, [replace])

  /** PDF 쪽을 편집한 뒤처럼 책갈피를 한꺼번에 고친다. null 이면 뺀다 */
  const mapAll = useCallback((map: (bookmark: PdfBookmark) => PdfBookmark | null) => {
    replace(bookmarksRef.current.flatMap((bookmark) => map(bookmark) ?? []))
  }, [replace])

  return { bookmarks, toggle, isBookmarked, mapAll, addPin, updatePin, movePin, remove }
}
