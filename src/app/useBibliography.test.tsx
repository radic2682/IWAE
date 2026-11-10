// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBibliography } from './useBibliography'
import { readBibliography, writeBibliography, type VaultHandle } from '../bridge/vault'
import { pageTextIndex, pdfMetadata } from '../bridge/pdf'
import { lookupDoi } from '../bridge/bibliography'

vi.mock('../bridge/vault', () => ({ readBibliography: vi.fn(), writeBibliography: vi.fn(), subscribeVaultFile: vi.fn(() => () => undefined), bibliographyCodec: {} }))
vi.mock('../bridge/pdf', () => ({ pdfMetadata: vi.fn(), pageTextIndex: vi.fn() }))
vi.mock('../bridge/bibliography', () => ({ lookupDoi: vi.fn() }))

const vault = { root: 'C:/Vault' } as VaultHandle

describe('useBibliography', () => {
  beforeEach(() => {
    vi.mocked(readBibliography).mockResolvedValue({ version: 1, entries: {} })
    vi.mocked(writeBibliography).mockResolvedValue(undefined)
    vi.mocked(pdfMetadata).mockResolvedValue({ title: 'Linked Paper', author: 'Kim, Lee', creationDate: 'D:20230115' })
    vi.mocked(pageTextIndex).mockResolvedValue({ text: 'doi:10.1000/xyz123', chars: [] })
  })

  it('extracts an entry from an opened PDF once and saves it', async () => {
    const { result } = renderHook(() => useBibliography(vault))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => { await result.current.autoExtract('doc1', 3) })
    expect(result.current.entries.doc1).toMatchObject({ title: 'Linked Paper', authors: ['Kim', 'Lee'], year: 2023, doi: '10.1000/xyz123', source: 'pdf' })
    expect(writeBibliography).toHaveBeenCalledTimes(1)

    await act(async () => { await result.current.autoExtract('doc1', 3) })
    expect(pdfMetadata).toHaveBeenCalledTimes(1)
  })

  it('keeps manual edits and fills from Crossref on request', async () => {
    vi.mocked(lookupDoi).mockResolvedValue({ title: ['From Crossref'], author: [{ given: 'A', family: 'B' }], DOI: '10.1/x' })
    const { result } = renderHook(() => useBibliography(vault))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.saveEntry('doc2', { title: '직접 입력', authors: ['홍길동'], source: 'manual', updatedAt: 'x' }))
    await act(async () => { await result.current.autoExtract('doc2', 2) })
    expect(result.current.entries.doc2?.title).toBe('직접 입력')

    let filled: Awaited<ReturnType<typeof result.current.fetchCrossref>> | undefined
    await act(async () => { filled = await result.current.fetchCrossref('10.1/x') })
    expect(filled).toMatchObject({ title: 'From Crossref', authors: ['A B'], source: 'crossref' })
  })

  it('works in memory without a vault', async () => {
    const { result } = renderHook(() => useBibliography(null))
    await waitFor(() => expect(result.current.ready).toBe(true))
    act(() => result.current.saveEntry('doc3', { authors: ['A'], source: 'manual', updatedAt: 'x' }))
    expect(result.current.entries.doc3?.authors).toEqual(['A'])
    expect(writeBibliography).not.toHaveBeenCalled()
  })
})
