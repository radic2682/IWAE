// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pageTextIndex } from '../../bridge/pdf'
import type { PdfSearchOptions } from '../../core/pdfSearch'
import type { CharBox, PageTextIndex } from '../../core/textIndex'
import { usePdfSearch } from './usePdfSearch'

vi.mock('../../bridge/pdf', () => ({
  pageTextIndex: vi.fn(),
}))

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function page(text: string): PageTextIndex {
  const chars: CharBox[] = [...text].map((c, index) => ({
    c,
    x: 72 + index * 6,
    y: 100,
    w: 6,
    h: 12,
  }))
  return { text, chars }
}

const options: PdfSearchOptions = { caseSensitive: false, wholeWord: false }
const mockedPageTextIndex = vi.mocked(pageTextIndex)

async function elapse(milliseconds: number): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(milliseconds))
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('usePdfSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockedPageTextIndex.mockReset()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('검색 입력 후 200ms가 지나야 페이지 검색을 시작한다', async () => {
    mockedPageTextIndex.mockResolvedValue(page('needle'))
    const { result } = renderHook(() => usePdfSearch({
      docId: 'debounce-doc',
      pageCount: 1,
      query: 'needle',
      options,
    }))

    expect(result.current.status).toBe('idle')
    await elapse(199)
    expect(mockedPageTextIndex).not.toHaveBeenCalled()

    await elapse(1)
    expect(mockedPageTextIndex).toHaveBeenCalledWith('debounce-doc', 0)
    expect(result.current.status).toBe('complete')
    expect(result.current.matches).toHaveLength(1)
  })

  it('검색어가 바뀌면 늦게 끝난 이전 검색 결과를 버린다', async () => {
    const oldPage = deferred<PageTextIndex>()
    const newPage = deferred<PageTextIndex>()
    mockedPageTextIndex.mockImplementation((_docId, _pageIndex) => {
      return mockedPageTextIndex.mock.calls.length === 1 ? oldPage.promise : newPage.promise
    })
    const { result, rerender } = renderHook(
      ({ query }) => usePdfSearch({ docId: 'query-doc', pageCount: 1, query, options }),
      { initialProps: { query: 'old' } },
    )

    await elapse(200)
    rerender({ query: 'new' })
    await elapse(200)

    newPage.resolve(page('new'))
    await settle()
    expect(result.current.matches.map((match) => match.quote)).toEqual(['new'])

    oldPage.resolve(page('old'))
    await settle()
    expect(result.current.status).toBe('complete')
    expect(result.current.matches.map((match) => match.quote)).toEqual(['new'])
  })

  it('문서가 바뀌면 늦게 끝난 이전 문서 결과를 버린다', async () => {
    const oldPage = deferred<PageTextIndex>()
    const newPage = deferred<PageTextIndex>()
    mockedPageTextIndex.mockImplementation((docId) => (
      docId === 'old-doc' ? oldPage.promise : newPage.promise
    ))
    const { result, rerender } = renderHook(
      ({ docId }) => usePdfSearch({ docId, pageCount: 1, query: 'term', options }),
      { initialProps: { docId: 'old-doc' } },
    )

    await elapse(200)
    rerender({ docId: 'new-doc' })
    await elapse(200)

    newPage.resolve(page('term'))
    await settle()
    expect(result.current.matches.map((match) => match.docId)).toEqual(['new-doc'])

    oldPage.resolve(page('term'))
    await settle()
    expect(result.current.matches.map((match) => match.docId)).toEqual(['new-doc'])
  })

  it('동시에 요청하는 페이지 수를 최대 4개로 제한한다', async () => {
    const pending = new Map<number, Deferred<PageTextIndex>>()
    let active = 0
    let maximumActive = 0
    mockedPageTextIndex.mockImplementation(async (_docId, pageIndex) => {
      const request = deferred<PageTextIndex>()
      pending.set(pageIndex, request)
      active += 1
      maximumActive = Math.max(maximumActive, active)
      const value = await request.promise
      active -= 1
      return value
    })
    const { result } = renderHook(() => usePdfSearch({
      docId: 'concurrency-doc',
      pageCount: 5,
      query: 'term',
      options,
    }))

    await elapse(200)
    expect(mockedPageTextIndex).toHaveBeenCalledTimes(4)
    expect(maximumActive).toBe(4)

    pending.get(0)?.resolve(page('term'))
    await settle()
    expect(mockedPageTextIndex).toHaveBeenCalledTimes(5)
    expect(maximumActive).toBe(4)

    for (const [pageIndex, request] of pending) {
      if (pageIndex !== 0) request.resolve(page('term'))
    }
    await settle()
    expect(result.current.status).toBe('complete')
    expect(result.current.matches).toHaveLength(5)
  })

  it('완료된 페이지 수와 페이지 순으로 정렬된 중간 결과를 갱신한다', async () => {
    const pending = [
      deferred<PageTextIndex>(),
      deferred<PageTextIndex>(),
      deferred<PageTextIndex>(),
    ]
    mockedPageTextIndex.mockImplementation((_docId, pageIndex) => {
      const request = pending[pageIndex]
      if (request === undefined) throw new Error('unexpected page')
      return request.promise
    })
    const { result } = renderHook(() => usePdfSearch({
      docId: 'progress-doc',
      pageCount: 3,
      query: 'hit',
      options,
    }))

    await elapse(200)
    expect(result.current.progress).toEqual({ completed: 0, total: 3 })

    pending[2]?.resolve(page('hit'))
    await settle()
    expect(result.current.progress).toEqual({ completed: 1, total: 3 })
    expect(result.current.matches.map((match) => match.page)).toEqual([2])

    // 화면은 120ms 에 한 번만 고친다(쪽마다 고치면 큰 문서에서 멈춘다)
    pending[0]?.resolve(page('hit'))
    await settle()
    expect(result.current.progress).toEqual({ completed: 1, total: 3 })
    await elapse(120)
    expect(result.current.progress).toEqual({ completed: 2, total: 3 })
    expect(result.current.matches.map((match) => match.page)).toEqual([0, 2])

    pending[1]?.resolve(page('hit'))
    await settle()
    expect(result.current.status).toBe('complete')
    expect(result.current.progress).toEqual({ completed: 3, total: 3 })
    expect(result.current.matches.map((match) => match.page)).toEqual([0, 1, 2])
  })

  it('다음·이전 탐색은 결과의 양끝에서 순환한다', async () => {
    mockedPageTextIndex.mockResolvedValue(page('hit hit'))
    const { result } = renderHook(() => usePdfSearch({
      docId: 'navigation-doc',
      pageCount: 1,
      query: 'hit',
      options,
    }))
    await elapse(200)

    expect(result.current.activeIndex).toBe(0)
    act(() => result.current.next())
    expect(result.current.activeIndex).toBe(1)
    act(() => result.current.next())
    expect(result.current.activeIndex).toBe(0)
    act(() => result.current.previous())
    expect(result.current.activeIndex).toBe(1)
    act(() => result.current.select(0))
    expect(result.current.activeIndex).toBe(0)
  })

  it('완료된 검색 결과는 같은 문서·검색어·옵션에서 다시 사용한다', async () => {
    mockedPageTextIndex.mockResolvedValue(page('cached'))
    const props = {
      docId: 'cache-doc',
      pageCount: 1,
      query: 'cached',
      options,
    }
    const first = renderHook(() => usePdfSearch(props))
    await elapse(200)
    expect(first.result.current.status).toBe('complete')
    expect(mockedPageTextIndex).toHaveBeenCalledTimes(1)
    first.unmount()

    mockedPageTextIndex.mockClear()
    const second = renderHook(() => usePdfSearch(props))
    await settle()

    expect(second.result.current.status).toBe('complete')
    expect(second.result.current.matches).toHaveLength(1)
    expect(mockedPageTextIndex).not.toHaveBeenCalled()
    second.unmount()
  })

  it('일부 페이지가 실패한 결과는 캐시하지 않는다', async () => {
    mockedPageTextIndex.mockImplementation(async (_docId, pageIndex) => {
      if (pageIndex === 1) throw new Error('page failed')
      return page('term')
    })
    const props = {
      docId: 'failure-doc',
      pageCount: 2,
      query: 'term',
      options,
    }
    const first = renderHook(() => usePdfSearch(props))
    await elapse(200)
    expect(first.result.current.status).toBe('error')
    first.unmount()

    mockedPageTextIndex.mockReset()
    mockedPageTextIndex.mockResolvedValue(page('term'))
    const second = renderHook(() => usePdfSearch(props))
    await elapse(200)

    expect(mockedPageTextIndex).toHaveBeenCalledTimes(2)
    expect(second.result.current.status).toBe('complete')
    expect(second.result.current.matches).toHaveLength(2)
    second.unmount()
  })

  it('완료한 검색어를 최신순 최근 검색어로 저장하고 다시 불러온다', async () => {
    window.localStorage.setItem('iwae:pdf-search-history:v1', JSON.stringify(['older']))
    mockedPageTextIndex.mockResolvedValue(page('needle'))
    const first = renderHook(() => usePdfSearch({
      docId: 'history-doc',
      pageCount: 1,
      query: ' needle ',
      options,
    }))

    await elapse(200)
    expect(first.result.current.recentQueries).toEqual(['needle', 'older'])
    first.unmount()

    const second = renderHook(() => usePdfSearch({
      docId: null,
      pageCount: 0,
      query: '',
      options,
    }))
    expect(second.result.current.recentQueries).toEqual(['needle', 'older'])
  })
})

import { firstMatchFrom } from './usePdfSearch'
describe('검색 결과의 시작 자리', () => {
  const match = (page: number) => ({ id: `m${page}`, docId: 'd', page, start: 0, end: 1, quote: 'a', before: '', after: '', rects: [] })
  it('지금 쪽부터의 첫 결과, 없으면 맨 앞으로 돌아간다', () => {
    const matches = [match(1), match(4), match(9)]
    expect(firstMatchFrom(matches, 0)).toBe(0)
    expect(firstMatchFrom(matches, 4)).toBe(1)
    expect(firstMatchFrom(matches, 5)).toBe(2)
    expect(firstMatchFrom(matches, 12)).toBe(0)
    expect(firstMatchFrom([], 3)).toBe(-1)
  })
})
