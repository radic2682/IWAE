import { describe, expect, it } from 'vitest'
import { INITIAL_READER_TOOL_STATE, readerToolReducer } from './readerTools'

describe('readerToolReducer', () => {
  it('한 번에 하나의 primary mode만 활성화한다', () => {
    const highlighted = readerToolReducer(
      { ...INITIAL_READER_TOOL_STATE, primary: 'text-select' },
      { type: 'toggle', mode: 'highlight' },
    )
    expect(highlighted.primary).toBe('highlight')
    expect(readerToolReducer(highlighted, { type: 'toggle', mode: 'highlight' }).primary).toBe('idle')
  })

  it('고정된 검색은 마우스가 떠나도 접지 않는다', () => {
    const pinned = readerToolReducer(INITIAL_READER_TOOL_STATE, { type: 'set-search-pinned', pinned: true })
    expect(pinned).toMatchObject({ searchPinned: true, searchExpanded: true })
    expect(readerToolReducer(pinned, { type: 'collapse-search' }).searchExpanded).toBe(true)
  })

  it('임시 선택을 초기화해도 검색 상태는 보존한다', () => {
    expect(readerToolReducer(
      { primary: 'region-select', searchPinned: true, searchExpanded: true },
      { type: 'reset-selection' },
    )).toEqual({ primary: 'idle', searchPinned: true, searchExpanded: true })
  })
})
