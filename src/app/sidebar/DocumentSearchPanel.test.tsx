// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDocumentSearch } from './DocumentSearchPanel'

describe('useDocumentSearch', () => {
  it('a blank or whitespace-only query clears the previous results', () => {
    const { result } = renderHook(() => useDocumentSearch())
    act(() => result.current.run('hello'))
    expect(result.current.submitted).toBe('hello')
    act(() => result.current.run('   '))
    expect(result.current.submitted).toBe('')
  })
})
