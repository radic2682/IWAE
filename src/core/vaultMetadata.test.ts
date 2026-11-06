import { describe, expect, it } from 'vitest'
import {
  folderIconKey,
  setFileReadingPosition,
  parseVaultMetadata,
  setItemIcon,
  setNoteOrder,
  recordFileOpened,
  setFileFavorite,
  setMarkdownTheme,
} from './vaultMetadata'

describe('vault metadata', () => {
  it('uses the light theme for missing or unknown values', () => {
    expect(parseVaultMetadata(null).markdownTheme).toBe('light')
    expect(parseVaultMetadata({ version: 1, markdownTheme: 'missing' }).markdownTheme).toBe('light')
    expect(parseVaultMetadata(null).fileActivity).toEqual({})
  })

  it('preserves unrelated metadata when changing the global markdown theme', () => {
    const metadata = parseVaultMetadata({ version: 1, markdownTheme: 'github', futureSetting: true })

    expect(setMarkdownTheme(metadata, 'paper')).toEqual({
      version: 1,
      markdownTheme: 'paper',
      fileActivity: {},
      itemIcons: {},
      futureSetting: true,
    })
  })

  it('파일별 즐겨찾기와 마지막 연 시각을 안정 ID로 보존한다', () => {
    const metadata = parseVaultMetadata(null)
    const favorite = setFileFavorite(metadata, 'doc-1', true)
    const opened = recordFileOpened(favorite, 'doc-1', '2026-09-27T10:00:00.000Z')

    expect(opened.fileActivity['doc-1']).toEqual({
      favorite: true,
      lastOpenedAt: '2026-09-27T10:00:00.000Z',
    })
    expect(parseVaultMetadata(opened)).toEqual(opened)
  })

  it('손상된 파일 활동 항목만 버린다', () => {
    expect(parseVaultMetadata({
      version: 1,
      markdownTheme: 'light',
      fileActivity: {
        good: { favorite: true, lastOpenedAt: null },
        bad: { favorite: 'yes', lastOpenedAt: 3 },
      },
    }).fileActivity).toEqual({ good: { favorite: true, lastOpenedAt: null } })
  })
})

describe('itemIcons', () => {
  it('keeps valid emoji and drops malformed values', () => {
    const metadata = parseVaultMetadata({
      itemIcons: { a: '📚', b: 3, c: 'x'.repeat(17), d: '', [folderIconKey('논문')]: '🗂️' },
    })
    expect(metadata.itemIcons).toEqual({ a: '📚', 'folder:논문': '🗂️' })
  })

  it('treats a non-object itemIcons as empty', () => {
    expect(parseVaultMetadata({ itemIcons: ['📚'] }).itemIcons).toEqual({})
  })

  it('sets and clears an icon without touching other fields', () => {
    const base = parseVaultMetadata({ fileActivity: { a: { favorite: true, lastOpenedAt: null } } })
    const withIcon = setItemIcon(base, 'a', '🔥')
    expect(withIcon.itemIcons).toEqual({ a: '🔥' })
    expect(withIcon.fileActivity.a?.favorite).toBe(true)
    expect(setItemIcon(withIcon, 'a', null).itemIcons).toEqual({})
  })
})

describe('reading position', () => {
  it('keeps a positive whole page and drops anything else', () => {
    const metadata = parseVaultMetadata({
      fileActivity: {
        a: { favorite: false, lastOpenedAt: null, lastPage: 12 },
        b: { favorite: false, lastOpenedAt: null, lastPage: 0 },
        c: { favorite: false, lastOpenedAt: null, lastPage: 2.5 },
        d: { favorite: false, lastOpenedAt: null, lastPage: '7' },
      },
    })
    expect(metadata.fileActivity.a?.lastPage).toBe(12)
    expect(metadata.fileActivity.b).toEqual({ favorite: false, lastOpenedAt: null })
    expect(metadata.fileActivity.c?.lastPage).toBeUndefined()
    expect(metadata.fileActivity.d?.lastPage).toBeUndefined()
  })

  it('records the page without touching favorite or last-opened time', () => {
    const base = parseVaultMetadata({ fileActivity: { a: { favorite: true, lastOpenedAt: '2026-10-01T00:00:00Z' } } })
    expect(setFileReadingPosition(base, 'a', 33).fileActivity.a).toEqual({
      favorite: true,
      lastOpenedAt: '2026-10-01T00:00:00Z',
      lastPage: 33,
    })
    expect(setFileReadingPosition(base, 'new', 4).fileActivity.new).toEqual({ favorite: false, lastOpenedAt: null, lastPage: 4 })
  })

  it('노트 차례를 저장했다가 그대로 읽고, 겹치거나 잘못된 값은 버린다', () => {
    const saved = setNoteOrder(parseVaultMetadata({}), ['노트/B.iwnote', '노트/A.iwnote'])
    expect(parseVaultMetadata(JSON.parse(JSON.stringify(saved))).noteOrder).toEqual(['노트/B.iwnote', '노트/A.iwnote'])
    expect(parseVaultMetadata({ noteOrder: ['x', 3, 'x', ''] }).noteOrder).toEqual(['x'])
    expect(parseVaultMetadata({}).noteOrder).toBeUndefined()
  })
})

