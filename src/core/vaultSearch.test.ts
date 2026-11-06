import { describe, expect, it } from 'vitest'
import { buildSearchRecords, searchVault, searchVaultPages } from './vaultSearch'
import type { VaultIndexEntry } from './vaultIndex'

const entries: VaultIndexEntry[] = [
  {
    id: 'exact', kind: 'pdf', storage: 'vault', path: 'Specs/protocol.pdf', displayName: 'HTTP',
    contentHash: null, size: 1, modifiedAt: null, addedAt: '2026-09-27T00:00:00.000Z', missing: false,
  },
  {
    id: 'filename', kind: 'pdf', storage: 'vault', path: 'Specs/HTTP.pdf', displayName: 'Controller',
    contentHash: null, size: 1, modifiedAt: null, addedAt: '2026-09-26T00:00:00.000Z', missing: false,
  },
  {
    id: 'content', kind: 'markdown', storage: 'vault', path: 'Notes/controller.md', displayName: '회의 기록',
    contentHash: null, size: 1, modifiedAt: null, addedAt: '2026-09-25T00:00:00.000Z', missing: true,
  },
]

describe('vault search', () => {
  it('표시 이름, 파일 이름, 본문 순서로 결과를 정렬한다', () => {
    const records = buildSearchRecords(entries, { content: 'HTTP implementation notes' })
    expect(searchVault(records, 'http').map((record) => record.id)).toEqual(['exact', 'filename', 'content'])
  })

  it('유니코드를 정규화하고 종류·폴더·누락 필터를 적용한다', () => {
    const records = buildSearchRecords(entries, {})
    expect(searchVault(records, 'ＨＴＴＰ', { kind: 'pdf', folder: 'Specs' }).map((record) => record.id))
      .toEqual(['exact', 'filename'])
    expect(searchVault(records, '', { missing: true }).map((record) => record.id)).toEqual(['content'])
  })

  it('캐시용 직렬화 후에도 stable id를 유지한다', async () => {
    const module = await import('./vaultSearch')
    const records = buildSearchRecords(entries, {})
    expect(module.parseSearchRecords(module.serializeSearchRecords(records)).map((record) => record.id))
      .toEqual(['exact', 'filename', 'content'])
  })

  it('페이지 정보가 없던 기존 검색 레코드는 빈 페이지 인덱스로 읽는다', async () => {
    const module = await import('./vaultSearch')
    const records = buildSearchRecords(entries, {})
    const legacy = JSON.stringify({ version: 1, records: records.map(({ pages: _pages, ...record }) => record) })
    expect(module.parseSearchRecords(legacy).every((record) => record.pages.length === 0)).toBe(true)
  })

  it('즐겨찾기와 최근 파일을 필터링하고 최근 파일은 마지막 연 시각으로 정렬한다', () => {
    const records = buildSearchRecords(entries, {}, {
      exact: { favorite: true, lastOpenedAt: '2026-09-27T08:00:00.000Z' },
      filename: { lastOpenedAt: '2026-09-27T10:00:00.000Z' },
    })

    expect(searchVault(records, '', { favorite: true }).map((record) => record.id)).toEqual(['exact'])
    expect(searchVault(records, '', { recent: true }).map((record) => record.id)).toEqual(['filename', 'exact'])
  })

  it('PDF 본문을 페이지별 문맥과 함께 찾고 대소문자·완전한 단어 옵션을 적용한다', () => {
    const records = buildSearchRecords(entries, {}, {}, {
      exact: [
        { page: 0, text: 'Transfer overview and protocol basics.' },
        { page: 3, text: 'The transfer sends a private message.' },
      ],
    })

    const insensitive = searchVaultPages(records, 'transfer', { kind: 'pdf' })
    expect(insensitive.map((hit) => hit.page)).toEqual([0, 3])
    expect(insensitive[0]?.snippet).toContain('Transfer')
    expect(searchVaultPages(records, 'transfer', { kind: 'pdf', caseSensitive: true }).map((hit) => hit.page))
      .toEqual([3])
    expect(searchVaultPages(records, 'trans', { kind: 'pdf', wholeWord: true })).toEqual([])
  })

  it('일부 페이지만 인덱싱된 PDF도 즉시 검색한다', () => {
    const records = buildSearchRecords(entries, {}, {}, {
      filename: [{ page: 7, text: 'partial indexing result' }],
    })

    expect(searchVaultPages(records, 'indexing')).toEqual([
      expect.objectContaining({ record: expect.objectContaining({ id: 'filename' }), page: 7 }),
    ])
  })
})
