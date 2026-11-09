import { useCallback, useEffect, useRef, useState } from 'react'
import { recordUndo } from './undoStack'
import { readPdfOverlays, writePdfOverlays, type VaultHandle } from '../bridge/vault'
import { addOverlay, removeOverlay, remapOverlayPages, updateOverlay, type OverlayPatch, type PdfOverlay } from '../core/pdfOverlays'

type Overlays = Readonly<Record<string, readonly PdfOverlay[]>>

/**
 * PDF 위 편집(글 상자·선). `.iwae/pdf-overlays.json` 에 문서(판)별로 두고 쓰기는 하나씩 줄을 세운다.
 * 원본 PDF 는 바꾸지 않는다.
 */
export function usePdfOverlays(vault: VaultHandle | null) {
  const [overlays, setOverlays] = useState<Overlays>({})
  const ref = useRef<Overlays>({})
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let active = true
    ref.current = {}
    setOverlays({})
    if (vault === null) return () => { active = false }
    void readPdfOverlays(vault)
      .then((file) => {
        if (!active) return
        ref.current = file.overlays
        setOverlays(file.overlays)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [vault])

  const write = useCallback((next: Overlays) => {
    ref.current = next
    setOverlays(next)
    if (vault === null) return
    const handle = vault
    queueRef.current = queueRef.current.catch(() => undefined).then(() => writePdfOverlays(handle, { version: 1, overlays: next }))
  }, [vault])

  const commit = useCallback((next: Overlays, key = 'all') => {
    if (next === ref.current) return
    const before = ref.current
    recordUndo({ key: `overlay:${key}`, undo: () => write(before), redo: () => write(next) })
    ref.current = next
    setOverlays(next)
    if (vault === null) return
    const handle = vault
    queueRef.current = queueRef.current.catch(() => undefined).then(() => writePdfOverlays(handle, { version: 1, overlays: next }))
  }, [vault])

  return {
    overlays,
    add: useCallback((docId: string, overlay: PdfOverlay) => commit(addOverlay(ref.current, docId, overlay)), [commit]),
    update: useCallback((docId: string, id: string, patch: OverlayPatch) => commit(updateOverlay(ref.current, docId, id, patch), id), [commit]),
    remove: useCallback((docId: string, id: string) => commit(removeOverlay(ref.current, docId, id)), [commit]),
    /** 쪽 편집 뒤 쪽 번호 옮기기 */
    remapPages: useCallback((docId: string, moves: ReadonlyMap<number, number>) => commit(remapOverlayPages(ref.current, docId, moves)), [commit]),
  }
}
