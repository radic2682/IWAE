import assert from 'node:assert/strict'
import test from 'node:test'
import { keepDrawable, trimEmojiData } from './build-emoji-data.mjs'

test('keeps base emoji up to version 15 and drops components and skins', () => {
  const rows = trimEmojiData([
    { emoji: '😀', label: '활짝 웃는 얼굴', tags: ['웃음'], group: 0, order: 1, version: 1, skins: [{ emoji: 'x' }] },
    { emoji: '🫨', label: '흔들리는 얼굴', tags: [], group: 0, order: 2, version: 15 },
    { emoji: '🫩', label: '새 얼굴', tags: [], group: 0, order: 3, version: 16 },
    { emoji: '🏻', label: '피부톤', tags: [], group: 2, order: 4, version: 1 },
    { emoji: '🇦', label: '지역 지표', tags: [], order: 5, version: 0 },
  ])
  assert.deepEqual(rows, [
    ['😀', '활짝 웃는 얼굴', ['웃음'], 0],
    ['🫨', '흔들리는 얼굴', [], 0],
  ])
})

test('keeps only emoji the font shapes into one real glyph', () => {
  const glyphs = { '😀': [5], '🚶‍♂️': [7, 0, 9], '❤️': [3], '⌚': [0] }
  const layout = (text) => ({ glyphs: (glyphs[text] ?? [0]).map((id) => ({ id })) })
  const rows = [['😀', 'a', [], 0], ['🚶‍♂️', 'b', [], 1], ['❤️', 'c', [], 8], ['⌚', 'd', [], 5]]
  assert.deepEqual(keepDrawable(rows, layout).map((row) => row[0]), ['😀', '❤️'])
})
