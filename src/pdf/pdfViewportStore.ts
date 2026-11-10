import { useSyncExternalStore } from 'react'
import type { VisibleRegion } from './pageLayout'

/**
 * 문서 창마다 「지금 화면에 보이는 PDF 부분」. PDF 창이 스크롤·확대할 때마다 알리고,
 * 왼쪽 바 미리보기가 그 쪽 축소판 위에 보고 있는 곳을 사각형으로 그린다.
 */
export interface PdfViewport {
  readonly docId: string
  readonly regions: readonly VisibleRegion[]
}

const views = new Map<string, PdfViewport>()
const listeners = new Set<() => void>()

function sameRegions(a: readonly VisibleRegion[], b: readonly VisibleRegion[]): boolean {
  if (a.length !== b.length) return false
  const near = (x: number, y: number) => Math.abs(x - y) < 0.0005
  return a.every((region, index) => {
    const other = b[index]!
    return region.page === other.page && near(region.x, other.x) && near(region.y, other.y) && near(region.w, other.w) && near(region.h, other.h)
  })
}

/** 창의 보이는 부분을 알린다. null 이면 그 창에는 보이는 PDF 가 없다 */
export function publishPdfViewport(paneId: string, view: PdfViewport | null): void {
  const previous = views.get(paneId)
  if (view === null) {
    if (previous === undefined) return
    views.delete(paneId)
  } else {
    if (previous !== undefined && previous.docId === view.docId && sameRegions(previous.regions, view.regions)) return
    views.set(paneId, view)
  }
  for (const listener of listeners) listener()
}

export function getPdfViewport(paneId: string | null): PdfViewport | null {
  return paneId === null ? null : views.get(paneId) ?? null
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** paneId 창의 보이는 부분(바뀔 때마다 다시 그린다) */
export function usePdfViewport(paneId: string | null): PdfViewport | null {
  return useSyncExternalStore(subscribe, () => getPdfViewport(paneId), () => null)
}
