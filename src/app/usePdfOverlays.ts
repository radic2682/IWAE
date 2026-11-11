import { useCallback, useEffect, useRef, useState } from 'react'
import { recordUndo } from './undoStack'
import { applySnapshotChange } from '../core/jsonMerge'
import { pdfOverlaysCodec, readPdfOverlays, subscribeVaultFile, writePdfOverlays, type VaultHandle } from '../bridge/vault'
import { addOverlay, removeOverlay, remapOverlayPages, updateOverlay, type OverlayPatch, type PdfOverlay } from '../core/pdfOverlays'

type Overlays = Readonly<Record<string, readonly PdfOverlay[]>>

/**
 * PDF 위 편집(글 상자·선). `.iwae/pdf-overlays.json` 에 문서(판)별로 두고 쓰기는 하나씩 줄을 세운다.
 * 원본 PDF 는 바꾸지 않는다.
 */
export function usePdfOverlays(vault: VaultHandle | null) {
  const [overlays, setOverlays] = useState<Overlays>({})
  const ref = useRef<Overlays>({})

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

  // 다른 창이 그림·글 상자를 고치면 이 창에 합친다
  useEffect(() => {
    if (vault === null) return undefined
    return subscribeVaultFile(vault, 'pdf-overlays.json', pdfOverlaysCodec, (rebase) => {
      const next = rebase({ version: 1, overlays: ref.current }).overlays
      if (next === ref.current) return
      ref.current = next
      setOverlays(next)
    })
  }, [vault])

  // 저장은 파일마다 차례로 서고(bridge) 다른 창의 변경과 합쳐진다
  const write = useCallback((next: Overlays) => {
    ref.current = next
    setOverlays(next)
    if (vault === null) return
    void writePdfOverlays(vault, { version: 1, overlays: next }).catch(() => undefined)
  }, [vault])

  const commit = useCallback((next: Overlays, key = 'all') => {
    if (next === ref.current) return
    const before = ref.current
    recordUndo({ key: `overlay:${key}`, undo: () => write(applySnapshotChange(next, before, ref.current)), redo: () => write(applySnapshotChange(before, next, ref.current)) })
    ref.current = next
    setOverlays(next)
    if (vault === null) return
    void writePdfOverlays(vault, { version: 1, overlays: next }).catch(() => undefined)
  }, [vault])

  return {
    overlays,
    add: useCallback((docId: string, overlay: PdfOverlay) => commit(addOverlay(ref.current, docId, overlay)), [commit]),
    // 같은 칸을 잇달아 고치는 것(글자 치기·끌어 옮기기)만 한 칸으로 합친다. 다른 칸(크기 → 배경 → 테두리)은 따로 되돌려지게 칸 이름을 열쇠에 넣는다
    update: useCallback((docId: string, id: string, patch: OverlayPatch) => commit(updateOverlay(ref.current, docId, id, patch), `${id}:${Object.keys(patch).sort().join('+')}`), [commit]),
    remove: useCallback((docId: string, id: string) => commit(removeOverlay(ref.current, docId, id)), [commit]),
    /** 쪽 편집 뒤 쪽 번호 옮기기 */
    remapPages: useCallback((docId: string, moves: ReadonlyMap<number, number>) => commit(remapOverlayPages(ref.current, docId, moves)), [commit]),
  }
}
