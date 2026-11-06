// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readRecentEmoji, rememberRecentEmoji, rowsInGroup, searchEmoji, type EmojiRow } from './emojiCatalog'

const rows: EmojiRow[] = [
  ['😀', '활짝 웃는 얼굴', ['웃음', '행복'], 0],
  ['📚', '책 더미', ['책', '공부'], 7],
  ['🔥', '불', ['뜨거움'], 5],
]

describe('emojiCatalog', () => {
  beforeEach(() => localStorage.clear())

  it('searches labels and tags case-insensitively, ignoring spaces', () => {
    expect(searchEmoji(rows, '공부').map((r) => r[0])).toEqual(['📚'])
    expect(searchEmoji(rows, '웃는얼굴').map((r) => r[0])).toEqual(['😀'])
    expect(searchEmoji(rows, '  ')).toEqual([])
  })

  it('filters by group', () => {
    expect(rowsInGroup(rows, 7).map((r) => r[0])).toEqual(['📚'])
  })

  it('keeps the 24 most recent emoji, newest first, without duplicates', () => {
    rememberRecentEmoji('📚')
    rememberRecentEmoji('🔥')
    expect(rememberRecentEmoji('📚')).toEqual(['📚', '🔥'])
    for (let i = 0; i < 30; i += 1) rememberRecentEmoji(String.fromCodePoint(0x1f600 + i))
    expect(readRecentEmoji()).toHaveLength(24)
  })

  it('survives a throwing localStorage', () => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    expect(readRecentEmoji()).toEqual([])
    Storage.prototype.getItem = original
  })
})
