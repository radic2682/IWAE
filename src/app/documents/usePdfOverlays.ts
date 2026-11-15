import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../i18n'
import { announceAction } from '../actionFeedback'
import { createSaveNotifier, loadOrQuarantine, reportLoadFailure } from './storageRecovery'
import { recordUndo } from '../undoStack'
import { applySnapshotChange } from '../../core/jsonMerge'
import { pdfOverlaysCodec, readPdfOverlays, subscribeVaultFile, writePdfOverlays, type VaultHandle } from '../../bridge/vault'
import { addOverlay, removeOverlay, remapOverlayPages, updateOverlay, type OverlayPatch, type PdfOverlay, type PdfOverlaysFile } from '../../core/pdfOverlays'

type Overlays = Readonly<Record<string, readonly PdfOverlay[]>>

/** 읽기에 실패했을 때 다시 읽어 보는 간격(ms). 점점 늘다가 이 값에서 멈춘다 */
const RELOAD_BASE_MS = 3000
const RELOAD_MAX_MS = 30000

/**
 * PDF 위 편집(글 상자·선). `.iwae/pdf-overlays.json` 에 문서(판)별로 두고 쓰기는 하나씩 줄을 세운다.
 * 원본 PDF 는 바꾸지 않는다.
 */
export function usePdfOverlays(vault: VaultHandle | null) {
  const [overlays, setOverlays] = useState<Overlays>({})
  const ref = useRef<Overlays>({})
  // 처음 읽기를 마칠 때까지(잠겨서 다시 읽는 동안 포함) 저장하지 않는다. 읽기 전에 쓰면 있던 내용을 덮을 수 있다
  const readyRef = useRef(false)
  // 읽기에 실패한 채로 고친 것이 있는가(읽는 대로 합쳐 저장한다). 처음 한 번만 알린다
  const failedRef = useRef(false)
  const warnedRef = useRef(false)
  // 더 새 버전이 쓴 항목처럼 이 버전이 모르는 것: 읽은 그대로 들고 있다가 저장할 때 되돌려 쓴다
  const keptRef = useRef<PdfOverlaysFile['kept']>(undefined)
  const notifySave = useMemo(() => createSaveNotifier((error) => t('PDF 편집 내용을 저장하지 못했습니다: {error}', { error })), [])
  const persist = useCallback((next: Overlays) => {
    if (vault === null) return
    if (!readyRef.current) {
      // 아직 읽지 못했다: 지금 쓰면 있던 내용을 덮는다. 읽는 대로 합쳐 저장하고, 못 읽는 동안은 한 번 알린다
      if (failedRef.current && !warnedRef.current) {
        warnedRef.current = true
        announceAction(t('PDF 편집 기록을 아직 읽지 못해 저장을 미뤄 두었습니다. 읽는 대로 저장하니 그때까지 앱을 닫지 마세요.'))
      }
      return
    }
    notifySave(writePdfOverlays(vault, { version: 1, overlays: next, ...(keptRef.current === undefined ? {} : { kept: keptRef.current }) }))
  }, [notifySave, vault])

  useEffect(() => {
    let active = true
    const initial: Overlays = {}
    ref.current = initial
    readyRef.current = false
    failedRef.current = false
    warnedRef.current = false
    keptRef.current = undefined
    setOverlays(initial)
    if (vault === null) return () => { active = false }
    let timer: ReturnType<typeof setTimeout> | null = null
    const onLoaded = (file: PdfOverlaysFile): void => {
      if (!active) return
      // 읽는 동안(잠겨서 다시 읽는 동안, 읽기에 실패해 다시 읽는 동안 포함) 고친 것이 있으면 읽은 내용에 합쳐 저장한다
      readyRef.current = true
      failedRef.current = false
      keptRef.current = file.kept
      if (ref.current !== initial) {
        const merged = applySnapshotChange(initial, ref.current, file.overlays)
        ref.current = merged
        setOverlays(merged)
        persist(merged)
        return
      }
      ref.current = file.overlays
      setOverlays(file.overlays)
    }
    const load = (attempt: number): void => {
      void loadOrQuarantine(vault, 'pdf-overlays.json', t('PDF 편집 기록'), { version: 1 as const, overlays: {} as Overlays }, () => readPdfOverlays(vault)).then(onLoaded, (cause: unknown) => {
        if (!active) return
        // 못 읽은 채로 두면 이후에 고친 것이 메모리에만 남는다. 알리고, 읽힐 때까지 다시 읽어 본다
        failedRef.current = true
        if (attempt === 0) reportLoadFailure(cause)
        timer = setTimeout(() => load(attempt + 1), Math.min(RELOAD_MAX_MS, RELOAD_BASE_MS * (attempt + 1)))
      })
    }
    load(0)
    return () => {
      active = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [persist, vault])

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
    persist(next)
  }, [persist])

  const commit = useCallback((next: Overlays, key = 'all', undoable = true) => {
    if (next === ref.current) return
    const before = ref.current
    if (undoable) recordUndo({ key: `overlay:${key}`, undo: () => write(applySnapshotChange(next, before, ref.current)), redo: () => write(applySnapshotChange(before, next, ref.current)) })
    ref.current = next
    setOverlays(next)
    persist(next)
  }, [persist])

  return {
    overlays,
    add: useCallback((docId: string, overlay: PdfOverlay) => commit(addOverlay(ref.current, docId, overlay)), [commit]),
    // 같은 칸을 잇달아 고치는 것(글자 치기·끌어 옮기기)만 한 칸으로 합친다. 다른 칸(크기 → 배경 → 테두리)은 따로 되돌려지게 칸 이름을 열쇠에 넣는다
    update: useCallback((docId: string, id: string, patch: OverlayPatch) => commit(updateOverlay(ref.current, docId, id, patch), `${id}:${Object.keys(patch).sort().join('+')}`), [commit]),
    remove: useCallback((docId: string, id: string) => commit(removeOverlay(ref.current, docId, id)), [commit]),
    /** 쪽 편집 뒤 쪽 번호 옮기기 */
    remapPages: useCallback((docId: string, moves: ReadonlyMap<number, number>, options: { readonly undoable?: boolean } = {}) => commit(remapOverlayPages(ref.current, docId, moves), 'all', options.undoable !== false), [commit]),
  }
}
