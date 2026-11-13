// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { EmojiPicker } from './EmojiPicker'
import type { EmojiRow } from '../../core/emojiCatalog'

const rows: EmojiRow[] = [['😀', '활짝 웃는 얼굴', ['웃음'], 0], ['📚', '책 더미', ['공부'], 7]]
const loadRows = () => Promise.resolve(rows)

describe('EmojiPicker', () => {
  beforeEach(() => localStorage.clear())

  it('shows the first group and selects an emoji', async () => {
    const onSelect = vi.fn()
    render(<EmojiPicker anchor={{ x: 10, y: 10 }} onSelect={onSelect} onClose={() => {}} loadRows={loadRows} />)
    fireEvent.click(await screen.findByRole('button', { name: '활짝 웃는 얼굴' }))
    expect(onSelect).toHaveBeenCalledWith('😀')
    expect(JSON.parse(localStorage.getItem('iwae:recent-emoji') ?? '[]')).toEqual(['😀'])
  })

  it('searches in Korean across groups', async () => {
    render(<EmojiPicker anchor={{ x: 0, y: 0 }} onSelect={() => {}} onClose={() => {}} loadRows={loadRows} />)
    await screen.findByRole('button', { name: '활짝 웃는 얼굴' })
    fireEvent.change(screen.getByRole('searchbox', { name: '이모지 검색' }), { target: { value: '공부' } })
    expect(screen.getByRole('button', { name: '책 더미' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '활짝 웃는 얼굴' })).toBeNull()
  })

  it('offers remove only when an emoji is set, and Escape closes without bubbling', async () => {
    const onRemove = vi.fn()
    const onClose = vi.fn()
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    render(<EmojiPicker anchor={{ x: 0, y: 0 }} current="📚" onSelect={() => {}} onRemove={onRemove} onClose={onClose} loadRows={loadRows} />)
    fireEvent.click(await screen.findByRole('button', { name: '이모지 제거' }))
    expect(onRemove).toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('dialog', { name: '이모지 선택' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(outer).not.toHaveBeenCalled()
    document.removeEventListener('keydown', outer)
  })

  it('has no remove button without a current emoji', async () => {
    render(<EmojiPicker anchor={{ x: 0, y: 0 }} onSelect={() => {}} onRemove={() => {}} onClose={() => {}} loadRows={loadRows} />)
    await screen.findByRole('button', { name: '활짝 웃는 얼굴' })
    expect(screen.queryByRole('button', { name: '이모지 제거' })).toBeNull()
  })
})
