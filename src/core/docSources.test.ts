import { describe, expect, it } from 'vitest'
import { addSource, createDocSource, isValidSourceTarget, normalizeSourceTarget, parseDocSources, sourceDisplayLabel, sourceTargetKind } from './docSources'

describe('문서 출처', () => {
  it('주소와 경로를 가른다', () => {
    expect(sourceTargetKind('https://example.com/a.pdf')).toBe('url')
    expect(sourceTargetKind('G:\Drive\docs\a.pdf')).toBe('path')
    expect(sourceTargetKind('\\server\share\a.pdf')).toBe('path')
  })

  it('입력을 다듬고 위험한 주소는 거른다', () => {
    expect(normalizeSourceTarget('  "www.example.com/x" ')).toBe('https://www.example.com/x')
    expect(isValidSourceTarget('javascript:alert(1)')).toBe(false)
    expect(isValidSourceTarget('file:///C:/x')).toBe(false)
    expect(isValidSourceTarget('ftp://x')).toBe(false)
    expect(isValidSourceTarget('')).toBe(false)
    expect(isValidSourceTarget('D:\docs\a.pdf')).toBe(true)
  })

  it('같은 주소는 두 번 더하지 않는다(끝 슬래시·대소문자 무시)', () => {
    const first = createDocSource({ label: '원본', target: 'https://Example.com/x/' })
    const list = addSource([], first)
    expect(addSource(list, createDocSource({ target: 'https://example.com/x' }))).toBe(list)
    expect(addSource(list, createDocSource({ target: 'https://example.com/y' }))).toHaveLength(2)
  })

  it('라벨이 없으면 호스트나 마지막 이름을 보인다', () => {
    expect(sourceDisplayLabel({ label: '', target: 'https://docs.example.com/a' })).toBe('docs.example.com')
    expect(sourceDisplayLabel({ label: '', target: 'D:/a/b/c.pdf' })).toBe('c.pdf')
    expect(sourceDisplayLabel({ label: '벤더 포털', target: 'https://x.y' })).toBe('벤더 포털')
  })

  it('저장 파일을 읽을 때 나쁜 항목은 버린다', () => {
    const file = parseDocSources({ version: 1, sources: { a: [{ id: '1', label: 'ok', target: 'https://x.y', addedAt: '2026-01-01' }, { target: 'javascript:x' }, 5], b: 'nope' } })
    expect(Object.keys(file.sources)).toEqual(['a'])
    expect(file.sources.a).toHaveLength(1)
  })
})
