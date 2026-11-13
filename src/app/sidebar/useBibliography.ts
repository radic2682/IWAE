import { useCallback, useEffect, useRef, useState } from 'react'
import { bibliographyCodec, readBibliography, subscribeVaultFile, writeBibliography, type VaultHandle } from '../../bridge/vault'
import { pageTextIndex, pdfMetadata } from '../../bridge/pdf'
import { lookupDoi } from '../../bridge/bibliography'
import { entryFromPdf, mergeEntry, parseCrossrefWork, type BibEntry } from '../../core/bibliography'

/** 서지 추출에 읽을 앞쪽 쪽 수. DOI·arXiv 번호는 거의 언제나 첫 쪽이나 둘째 쪽에 있다 */
const IDENTIFIER_PAGES = 2

/**
 * 문서별 서지 정보. Vault 가 있으면 `.iwae/bibliography.json` 에, 없으면(미리보기)
 * 메모리에만 둔다. 쓰기는 하나씩 줄을 세워 앞선 쓰기를 뒤의 쓰기가 덮어 지우지 않게 한다.
 */
export function useBibliography(vault: VaultHandle | null) {
  const [entries, setEntries] = useState<Readonly<Record<string, BibEntry>>>({})
  const [ready, setReady] = useState(false)
  const entriesRef = useRef<Readonly<Record<string, BibEntry>>>({})
  const attemptedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let active = true
    setReady(false)
    attemptedRef.current = new Set()
    entriesRef.current = {}
    setEntries({})
    if (vault === null) {
      setReady(true)
      return () => { active = false }
    }
    void readBibliography(vault)
      .then((file) => {
        if (!active) return
        entriesRef.current = file.entries
        setEntries(file.entries)
      })
      .catch(() => undefined)
      .finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [vault])

  // 다른 창이 서지 정보를 고치면 이 창에 합친다
  useEffect(() => {
    if (vault === null) return undefined
    return subscribeVaultFile(vault, 'bibliography.json', bibliographyCodec, (rebase) => {
      const next = rebase({ version: 1, entries: entriesRef.current }).entries
      if (next === entriesRef.current) return
      entriesRef.current = next
      setEntries(next)
    })
  }, [vault])

  const commit = useCallback((next: Readonly<Record<string, BibEntry>>) => {
    entriesRef.current = next
    setEntries(next)
    if (vault === null) return
    // 저장은 파일마다 차례로 서고(bridge) 다른 창의 변경과 합쳐진다
    void writeBibliography(vault, { version: 1, entries: next }).catch(() => undefined)
  }, [vault])

  /** 사람이 고쳤거나 Crossref 로 채운 항목을 저장한다 */
  const saveEntry = useCallback((docId: string, entry: BibEntry) => {
    commit({ ...entriesRef.current, [docId]: entry })
  }, [commit])

  /**
   * 열린 PDF 의 정보 사전과 앞쪽 본문으로 항목을 만든다. 문서마다 세션에 한 번만 하고,
   * 이미 사람이 고친 항목은 건드리지 않는다.
   */
  const autoExtract = useCallback(async (docId: string, pageCount: number) => {
    if (attemptedRef.current.has(docId)) return
    attemptedRef.current.add(docId)
    if (entriesRef.current[docId] !== undefined && entriesRef.current[docId]?.source !== 'pdf') return
    try {
      const info = await pdfMetadata(docId)
      const pages = Array.from({ length: Math.min(IDENTIFIER_PAGES, pageCount) }, (_, page) => page)
      const texts = await Promise.all(pages.map((page) => pageTextIndex(docId, page).then((index) => index.text).catch(() => '')))
      const incoming = entryFromPdf(info, texts.join('\n'), new Date().toISOString())
      const merged = mergeEntry(entriesRef.current[docId], incoming)
      if (merged !== entriesRef.current[docId]) commit({ ...entriesRef.current, [docId]: merged })
    } catch {
      // 정보를 못 읽는 PDF 도 있다(암호, 깨진 정보 사전). 서지는 보조 정보라 조용히 넘긴다.
    }
  }, [commit])

  /** Crossref 에서 받아 항목 모양으로 돌려준다. 저장은 사용자가 확인한 뒤 saveEntry 로 한다 */
  const fetchCrossref = useCallback(async (doi: string): Promise<BibEntry> => {
    return parseCrossrefWork(await lookupDoi(doi), new Date().toISOString())
  }, [])

  return { entries, ready, saveEntry, autoExtract, fetchCrossref }
}
