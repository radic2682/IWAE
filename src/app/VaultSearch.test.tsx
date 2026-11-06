// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VaultSearch } from './VaultSearch'
import { CANVAS_ENABLED } from '../core/features'
import type { VaultSearchRecord } from '../core/vaultSearch'

const records: VaultSearchRecord[] = [
  {
    id: 'doc-1', kind: 'pdf', storage: 'vault', path: 'Specs/http.pdf', folder: 'Specs',
    filename: 'http.pdf', displayName: 'HTTP Guide', extractedText: '', pages: [{ page: 4, text: 'content negotiation procedure' }], missing: false,
    favorite: false, lastOpenedAt: null, addedAt: '2026-09-27T00:00:00.000Z',
  },
  {
    id: 'doc-2', kind: 'markdown', storage: 'reference', path: 'C:/notes/missing.md', folder: 'C:/notes',
    filename: 'missing.md', displayName: 'Missing note', extractedText: '', pages: [], missing: true,
    favorite: true, lastOpenedAt: '2026-09-27T09:00:00.000Z', addedAt: '2026-09-26T00:00:00.000Z',
  },
  {
    id: 'doc-3', kind: 'canvas', storage: 'vault', path: 'Boards/plan.canvas', folder: 'Boards',
    filename: 'plan.canvas', displayName: 'Plan board', extractedText: '', pages: [], missing: false,
    favorite: false, lastOpenedAt: null, addedAt: '2026-09-25T00:00:00.000Z',
  },
]

describe('VaultSearch', () => {
  it('키보드로 검색 결과를 열고 누락 참조를 표시한다', () => {
    const onOpen = vi.fn()
    render(<VaultSearch records={records} onOpen={onOpen} />)

    fireEvent.click(screen.getByRole('button', { name: 'Vault 검색' }))
    const input = screen.getByRole('searchbox', { name: 'Vault 검색어' })
    fireEvent.change(input, { target: { value: 'missing' } })

    expect(screen.getByText('찾을 수 없음')).toBeDefined()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ record: expect.objectContaining({ id: 'doc-2' }) }))
  })

  it('종류 필터로 PDF만 남긴다', () => {
    render(<VaultSearch records={records} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Vault 검색' }))
    fireEvent.click(screen.getByRole('button', { name: 'PDF만 보기' }))
    expect(screen.getByText('HTTP Guide')).toBeDefined()
    expect(screen.queryByText('Missing note')).toBeNull()
  })

  it('폴더·즐겨찾기·최근·누락 필터를 검색창 안에서 조합한다', () => {
    render(<VaultSearch records={records} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Vault 검색' }))

    fireEvent.change(screen.getByRole('combobox', { name: '폴더 필터' }), { target: { value: 'C:/notes' } })
    fireEvent.click(screen.getByRole('button', { name: '즐겨찾기만 보기' }))
    fireEvent.click(screen.getByRole('button', { name: '최근 파일만 보기' }))
    fireEvent.click(screen.getByRole('button', { name: '누락 파일만 보기' }))

    expect(screen.getByText('Missing note')).toBeDefined()
    expect(screen.queryByText('HTTP Guide')).toBeNull()
    expect(screen.queryByText('Plan board')).toBeNull()
  })

  it.skipIf(!CANVAS_ENABLED)('캔버스를 포함한 모든 파일 종류를 필터링한다', () => {
    render(<VaultSearch records={records} onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Vault 검색' }))
    fireEvent.click(screen.getByRole('button', { name: '캔버스만 보기' }))

    expect(screen.getByText('Plan board')).toBeDefined()
    expect(screen.queryByText('HTTP Guide')).toBeNull()
  })

  it('검색 바깥을 누르면 결과 패널을 닫는다', () => {
    render(<><VaultSearch records={records} onOpen={vi.fn()} /><button type="button">바깥</button></>)
    fireEvent.click(screen.getByRole('button', { name: 'Vault 검색' }))
    expect(screen.getByRole('searchbox', { name: 'Vault 검색어' })).toBeDefined()

    fireEvent.pointerDown(screen.getByRole('button', { name: '바깥' }))
    expect(screen.queryByRole('searchbox', { name: 'Vault 검색어' })).toBeNull()
  })

  it('검색 결과에서 즐겨찾기를 토글한다', () => {
    const onFavoriteChange = vi.fn()
    render(<VaultSearch records={records} onOpen={vi.fn()} onFavoriteChange={onFavoriteChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Vault 검색' }))

    fireEvent.click(screen.getByRole('button', { name: 'HTTP Guide 즐겨찾기 추가' }))
    fireEvent.click(screen.getByRole('button', { name: 'Missing note 즐겨찾기 해제' }))

    expect(onFavoriteChange).toHaveBeenNthCalledWith(1, 'doc-1', true)
    expect(onFavoriteChange).toHaveBeenNthCalledWith(2, 'doc-2', false)
  })

  it('PDF 본문 결과에 페이지와 문맥을 표시하고 해당 페이지를 연다', () => {
    const onOpen = vi.fn()
    render(<VaultSearch records={records} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Vault 검색' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Vault 검색어' }), { target: { value: 'negotiation' } })

    expect(screen.getByText('5페이지')).toBeDefined()
    expect(screen.getByText(/content negotiation/u)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /HTTP Guide.*5페이지/u }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ page: 4, query: 'negotiation' }))
  })

  it('백그라운드 PDF 인덱싱 진행률을 검색 결과와 함께 표시한다', () => {
    render(<VaultSearch records={records} onOpen={vi.fn()} indexingProgress={{ indexed: 2, total: 5 }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Vault 검색' }))
    expect(screen.getByRole('status').textContent).toContain('2/5')
  })
})
