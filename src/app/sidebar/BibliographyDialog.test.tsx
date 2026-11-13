// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BibliographyDialog } from './BibliographyDialog'
import type { BibEntry } from '../../core/bibliography'

const entry: BibEntry = { title: 'Linked Paper', authors: ['Kim', 'Lee'], year: 2023, doi: '10.1000/xyz', source: 'pdf', updatedAt: 'x' }

function setup(over: Partial<React.ComponentProps<typeof BibliographyDialog>> = {}) {
  const props = {
    documentTitle: '논문 A',
    entry,
    onSave: vi.fn(),
    onClose: vi.fn(),
    onFetchCrossref: vi.fn(),
    ...over,
  }
  render(<BibliographyDialog {...props} />)
  return props
}

const field = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement

describe('BibliographyDialog', () => {
  it('edits fields and saves them as a manual entry', () => {
    const props = setup()
    fireEvent.change(field('제목'), { target: { value: '고친 제목' } })
    fireEvent.change(field('저자 (한 줄에 한 명)'), { target: { value: '홍길동\n김철수\n' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: '연도' }), { target: { value: '2024' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: '고친 제목', authors: ['홍길동', '김철수'], year: 2024, doi: '10.1000/xyz', source: 'manual',
    }))
  })

  it('fills from Crossref and keeps values when the lookup fails', async () => {
    const onFetchCrossref = vi.fn()
      .mockResolvedValueOnce({ title: 'From Crossref', authors: ['A B'], journal: 'Nature', source: 'crossref', updatedAt: 'y' })
      .mockRejectedValueOnce(new Error('Crossref 에 연결하지 못했습니다'))
    const props = setup({ onFetchCrossref })
    fireEvent.click(screen.getByRole('button', { name: 'Crossref에서 채우기' }))
    await waitFor(() => expect(field('제목').value).toBe('From Crossref'))
    expect(field('학술지').value).toBe('Nature')

    fireEvent.click(screen.getByRole('button', { name: 'Crossref에서 채우기' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Crossref 에 연결하지 못했습니다')
    expect(field('제목').value).toBe('From Crossref')

    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ title: 'From Crossref', source: 'crossref' }))
  })

  it('disables the Crossref button without a DOI and closes on Escape', () => {
    const props = setup({ entry: { authors: [], source: 'pdf', updatedAt: 'x' } })
    expect((screen.getByRole('button', { name: 'Crossref에서 채우기' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog', { name: '논문 정보: 논문 A' }), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })
})
