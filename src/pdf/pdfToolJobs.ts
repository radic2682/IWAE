import { useSyncExternalStore } from 'react'

/**
 * 오래 걸리는 PDF 도구(OCR) 진행 상황. 스캔 표시 단추·도구 창·명령 팔레트가 같은 값을 본다.
 * 문서마다 하나. 끝나면 지운다.
 */
export interface PdfToolJob {
  readonly docId: string
  /** 사람이 읽을 지금 하는 일 */
  readonly label: string
  readonly done: number
  readonly total: number
}

let jobs: Readonly<Record<string, PdfToolJob>> = {}
const listeners = new Set<() => void>()

export function setPdfToolJob(job: PdfToolJob | { readonly docId: string; readonly clear: true }): void {
  if ('clear' in job) {
    if (jobs[job.docId] === undefined) return
    const next = { ...jobs }
    delete next[job.docId]
    jobs = next
  } else {
    jobs = { ...jobs, [job.docId]: job }
  }
  for (const listener of listeners) listener()
}

export function getPdfToolJob(docId: string): PdfToolJob | undefined {
  return jobs[docId]
}

export function usePdfToolJob(docId: string | null): PdfToolJob | undefined {
  const all = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => jobs,
    () => jobs,
  )
  return docId === null ? undefined : all[docId]
}
