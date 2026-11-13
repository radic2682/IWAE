import { useCallback, useEffect, useRef, useState } from 'react'
import { pageTextIndex } from '../../bridge/pdf'
import {
  addRecentPdfSearch,
  MAX_RECENT_SEARCHES,
  pdfSearchCacheKey,
  searchPageIndex,
  type PdfSearchMatch,
  type PdfSearchOptions,
} from '../../core/pdfSearch'

const SEARCH_DEBOUNCE_MS = 200
const MAX_CONCURRENT_PAGE_REQUESTS = 4
/** 찾는 동안 화면(결과 목록·진행률)을 고치는 간격. 쪽마다 고치면 큰 문서에서 결과가 쌓일수록 멈춘다 */
const SEARCH_FLUSH_MS = 120
const SEARCH_HISTORY_KEY = 'iwae:pdf-search-history:v1'

const completedSearchCache = new Map<string, readonly PdfSearchMatch[]>()

export type PdfSearchStatus = 'idle' | 'searching' | 'complete' | 'error'

export interface PdfSearchProgress {
  readonly completed: number
  readonly total: number
}

export interface UsePdfSearchInput {
  readonly docId: string | null
  readonly pageCount: number
  readonly query: string
  readonly options: PdfSearchOptions
  /** 지금 보고 있는 쪽(0 부터). 검색하면 이 쪽부터의 첫 결과로 가고, 끝까지 가면 앞으로 돌아온다 */
  readonly startPage?: number
}

/** 이 쪽(0 부터) 이후의 첫 결과. 없으면 맨 앞(끝까지 간 뒤 앞으로 돌아온다) */
export function firstMatchFrom(matches: readonly PdfSearchMatch[], page: number): number {
  if (matches.length === 0) return -1
  const index = matches.findIndex((match) => match.page >= page)
  return index < 0 ? 0 : index
}

export interface UsePdfSearchResult {
  readonly status: PdfSearchStatus
  readonly matches: readonly PdfSearchMatch[]
  readonly activeIndex: number
  readonly progress: PdfSearchProgress
  readonly recentQueries: readonly string[]
  /** 최근 검색어 하나를 지운다 */
  readonly removeRecent?: (query: string) => void
  /** 최근 검색어를 모두 지운다 */
  readonly clearRecent?: () => void
  readonly next: () => void
  readonly previous: () => void
  readonly select: (index: number) => void
  readonly cancel: () => void
}

function storedRecentQueries(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const value = JSON.parse(window.localStorage.getItem(SEARCH_HISTORY_KEY) ?? '[]') as unknown
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT_SEARCHES)
      : []
  } catch {
    return []
  }
}

function safePageCount(pageCount: number): number {
  return Number.isFinite(pageCount) ? Math.max(0, Math.trunc(pageCount)) : 0
}

function orderedMatches(
  pageMatches: readonly (readonly PdfSearchMatch[] | undefined)[],
): PdfSearchMatch[] {
  return pageMatches.flatMap((matches) => matches ?? [])
}

export function usePdfSearch({
  docId,
  pageCount,
  query,
  options,
  startPage = 0,
}: UsePdfSearchInput): UsePdfSearchResult {
  // 검색을 시작한 순간의 쪽(검색 중에 쪽을 넘겨도 처음 자리는 그대로). 사람이 결과를 옮기면 그 뒤로는 손대지 않는다
  const startPageRef = useRef(startPage)
  startPageRef.current = startPage
  const searchStartRef = useRef(startPage)
  const userMovedRef = useRef(false)
  const totalPages = safePageCount(pageCount)
  const [status, setStatus] = useState<PdfSearchStatus>('idle')
  const [matches, setMatches] = useState<readonly PdfSearchMatch[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const [progress, setProgress] = useState<PdfSearchProgress>({ completed: 0, total: totalPages })
  const [recentQueries, setRecentQueries] = useState<readonly string[]>(storedRecentQueries)
  const cancelCurrentRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let flushTimer: ReturnType<typeof setTimeout> | undefined

    const reset = (): void => {
      setStatus('idle')
      setMatches([])
      setActiveIndex(-1)
      setProgress({ completed: 0, total: totalPages })
    }

    const rememberQuery = (): void => {
      setRecentQueries((current) => {
        const next = addRecentPdfSearch(current, query)
        try {
          window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next))
        } catch {
          // 저장 공간을 사용할 수 없어도 검색 자체는 계속 동작한다.
        }
        return next
      })
    }

    cancelCurrentRef.current = () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      if (flushTimer !== undefined) clearTimeout(flushTimer)
      reset()
    }

    if (docId === null || query.length === 0 || totalPages === 0) {
      reset()
      return () => {
        cancelled = true
      }
    }

    searchStartRef.current = startPageRef.current
    userMovedRef.current = false
    const cacheKey = pdfSearchCacheKey(docId, query, options)
    const cached = completedSearchCache.get(cacheKey)
    if (cached !== undefined) {
      setStatus('complete')
      setMatches(cached)
      setActiveIndex(firstMatchFrom(cached, searchStartRef.current))
      setProgress({ completed: totalPages, total: totalPages })
      rememberQuery()
      return () => {
        cancelled = true
      }
    }

    reset()
    timer = setTimeout(() => {
      if (cancelled) return
      setStatus('searching')

      const pageMatches: Array<readonly PdfSearchMatch[] | undefined> = Array.from({
        length: totalPages,
      })
      // 지금 쪽부터 끝까지, 그다음 앞쪽을 읽는다(지금 쪽 근처 결과가 먼저 나온다)
      const from = Math.min(Math.max(searchStartRef.current, 0), totalPages - 1)
      const pageOrder = [...Array.from({ length: totalPages - from }, (_, i) => from + i), ...Array.from({ length: from }, (_, i) => i)]
      let nextPage = 0
      let completed = 0
      let failed = false
      let lastFlush = Number.NEGATIVE_INFINITY

      const flush = (): void => {
        flushTimer = undefined
        if (cancelled || failed) return
        lastFlush = Date.now()
        const currentMatches = orderedMatches(pageMatches)
        setMatches(currentMatches)
        setActiveIndex((current) => {
          if (currentMatches.length === 0) return -1
          // 아직 사람이 옮기지 않았으면 늘 「지금 쪽부터의 첫 결과」(앞쪽 결과가 늦게 들어와도 자리가 밀리지 않게)
          if (!userMovedRef.current) return firstMatchFrom(currentMatches, searchStartRef.current)
          return Math.min(Math.max(current, 0), currentMatches.length - 1)
        })
        setProgress({ completed, total: totalPages })
      }
      /** 처음 것은 바로, 그 뒤로는 SEARCH_FLUSH_MS 에 한 번 */
      const scheduleFlush = (): void => {
        if (flushTimer !== undefined) return
        const wait = lastFlush + SEARCH_FLUSH_MS - Date.now()
        if (wait <= 0) flush()
        else flushTimer = setTimeout(flush, wait)
      }

      const worker = async (): Promise<void> => {
        while (!cancelled && !failed) {
          const slot = nextPage
          nextPage += 1
          if (slot >= totalPages) return
          const page = pageOrder[slot]!

          try {
            const index = await pageTextIndex(docId, page)
            if (cancelled || failed) return

            pageMatches[page] = searchPageIndex(docId, page, index, query, options)
            completed += 1
            scheduleFlush()
          } catch {
            if (cancelled) return
            failed = true
            setStatus('error')
            setMatches([])
            setActiveIndex(-1)
          }
        }
      }

      const workerCount = Math.min(MAX_CONCURRENT_PAGE_REQUESTS, totalPages)
      void Promise.all(Array.from({ length: workerCount }, () => worker())).then(() => {
        if (flushTimer !== undefined) clearTimeout(flushTimer)
        flushTimer = undefined
        if (cancelled || failed) return
        const completeMatches = orderedMatches(pageMatches)
        completedSearchCache.set(cacheKey, completeMatches)
        setMatches(completeMatches)
        setActiveIndex((current) => (completeMatches.length === 0 ? -1 : userMovedRef.current ? Math.min(Math.max(current, 0), completeMatches.length - 1) : firstMatchFrom(completeMatches, searchStartRef.current)))
        setProgress({ completed: totalPages, total: totalPages })
        setStatus('complete')
        rememberQuery()
      })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      if (flushTimer !== undefined) clearTimeout(flushTimer)
    }
  }, [docId, options.caseSensitive, options.wholeWord, query, totalPages])

  const next = useCallback(() => {
    userMovedRef.current = true
    setActiveIndex((current) => {
      if (matches.length === 0) return -1
      return current < 0 ? 0 : (current + 1) % matches.length
    })
  }, [matches.length])

  const previous = useCallback(() => {
    userMovedRef.current = true
    setActiveIndex((current) => {
      if (matches.length === 0) return -1
      return current <= 0 ? matches.length - 1 : current - 1
    })
  }, [matches.length])

  const select = useCallback((index: number) => {
    userMovedRef.current = true
    if (!Number.isFinite(index) || matches.length === 0) {
      setActiveIndex(-1)
      return
    }
    setActiveIndex(Math.min(Math.max(Math.trunc(index), 0), matches.length - 1))
  }, [matches.length])

  const cancel = useCallback(() => {
    cancelCurrentRef.current()
  }, [])

  const saveRecent = useCallback((change: (current: readonly string[]) => readonly string[]) => {
    setRecentQueries((current) => {
      const next = change(current)
      try {
        window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next))
      } catch {
        // 저장 공간을 사용할 수 없어도 화면에서는 지운다
      }
      return next
    })
  }, [])
  const removeRecent = useCallback((query: string) => saveRecent((current) => current.filter((recent) => recent !== query)), [saveRecent])
  const clearRecent = useCallback(() => saveRecent(() => []), [saveRecent])

  return { status, matches, activeIndex, progress, recentQueries, removeRecent, clearRecent, next, previous, select, cancel }
}
