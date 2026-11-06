import { describe, expect, it } from 'vitest'
import {
  emptyVaultSearchTextCache,
  matchingCachedSearchPages,
  parseVaultSearchTextCache,
  updateVaultSearchTextCache,
} from './vaultSearchCache'

describe('Vault 검색 텍스트 캐시', () => {
  it('현재 콘텐츠 해시와 일치하는 본문만 복원한다', () => {
    const cache = updateVaultSearchTextCache(
      emptyVaultSearchTextCache(),
      'pdf-1',
      'hash-a',
      [{ page: 0, text: 'indexed body' }, { page: 1, text: 'second page' }],
    )

    expect(matchingCachedSearchPages([
      { id: 'pdf-1', contentHash: 'hash-a' },
      { id: 'pdf-2', contentHash: 'hash-b' },
    ], cache)).toEqual({
      'pdf-1': [{ page: 0, text: 'indexed body' }, { page: 1, text: 'second page' }],
    })
  })

  it('파일 콘텐츠 해시가 바뀌면 오래된 본문을 사용하지 않는다', () => {
    const cache = updateVaultSearchTextCache(
      emptyVaultSearchTextCache(),
      'pdf-1',
      'old-hash',
      [{ page: 0, text: 'stale body' }],
    )

    expect(matchingCachedSearchPages([
      { id: 'pdf-1', contentHash: 'new-hash' },
    ], cache)).toEqual({})
  })

  it('v1 문서 캐시는 첫 페이지의 부분 인덱스로 안전하게 마이그레이션한다', () => {
    expect(parseVaultSearchTextCache({
      version: 1,
      documents: { legacy: { contentHash: 'hash-a', text: 'legacy body' } },
    })).toEqual({
      version: 2,
      documents: {
        legacy: {
          contentHash: 'hash-a',
          pages: [{ page: 0, text: 'legacy body' }],
          complete: false,
        },
      },
    })
  })

  it('손상되거나 알 수 없는 버전의 캐시는 재생성 가능한 빈 캐시로 취급한다', () => {
    expect(parseVaultSearchTextCache(null)).toEqual(emptyVaultSearchTextCache())
    expect(parseVaultSearchTextCache({ version: 99, documents: {} })).toEqual(emptyVaultSearchTextCache())
    expect(parseVaultSearchTextCache({ version: 1, documents: { bad: { text: 4 } } }))
      .toEqual(emptyVaultSearchTextCache())
  })
})
