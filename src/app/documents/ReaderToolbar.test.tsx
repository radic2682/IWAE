// @vitest-environment jsdom
import { useReducer } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { INITIAL_READER_TOOL_STATE, readerToolReducer } from '../../core/readerTools'
import { ReaderToolbar } from './ReaderToolbar'

function Harness({ onQueryChange = vi.fn() }: { onQueryChange?: (query: string) => void }) {
  const [state, dispatch] = useReducer(readerToolReducer, INITIAL_READER_TOOL_STATE)
  return <ReaderToolbar state={state} dispatch={dispatch} query="" onQueryChange={onQueryChange} />
}

describe('ReaderToolbar', () => {
  it('검색은 hover로 임시 확장되고 클릭하면 고정된다', () => {
    render(<Harness />)
    const toolbar = screen.getByRole('toolbar', { name: '문서 읽기 도구' })
    const search = screen.getByRole('button', { name: '검색' })

    fireEvent.mouseEnter(search.parentElement as Element)
    expect(screen.getByRole('searchbox', { name: '문서 검색' })).not.toBeNull()
    fireEvent.mouseLeave(search.parentElement as Element)
    expect(screen.queryByRole('searchbox', { name: '문서 검색' })).toBeNull()

    fireEvent.click(search)
    fireEvent.mouseLeave(search.parentElement as Element)
    expect(screen.getByRole('searchbox', { name: '문서 검색' })).not.toBeNull()
    expect(toolbar.contains(search)).toBe(true)
  })

  it('primary 도구는 하나만 눌린 상태가 된다', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '텍스트 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '영역 선택' }))
    expect(screen.getByRole('button', { name: '텍스트 선택' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '영역 선택' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('검색어 변경을 전달한다', () => {
    const onQueryChange = vi.fn()
    render(<Harness onQueryChange={onQueryChange} />)
    fireEvent.click(screen.getByRole('button', { name: '검색' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '문서 검색' }), { target: { value: 'HTTP' } })
    expect(onQueryChange).toHaveBeenCalledWith('HTTP')
  })
})
