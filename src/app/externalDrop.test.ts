import { describe, expect, it } from 'vitest'
import { resolveExternalDrop } from './externalDrop'

const pt = { x: 10, y: 10 }

describe('resolveExternalDrop', () => {
  it('칸 위에 놓으면 그 칸에 연다(가져오지 않는다)', () => {
    expect(resolveExternalDrop(pt, { kind: 'reader' }, () => ({ kind: 'body', pane: 'p2' }))).toEqual({ kind: 'pane', pane: 'p2' })
    expect(resolveExternalDrop(pt, { kind: 'reader' }, () => ({ kind: 'strip', pane: 'p1' }))).toEqual({ kind: 'pane', pane: 'p1' })
  })
  it('칸 사이 틈이면 칸 없이 pane(지금 칸)', () => {
    expect(resolveExternalDrop(pt, { kind: 'reader' }, () => ({ kind: 'none' }))).toEqual({ kind: 'pane', pane: null })
  })
  it('왼쪽 바는 Vault 로 가져온다(폴더 자리 유지)', () => {
    const zone = { kind: 'vault' as const, folderPath: 'a/b' }
    expect(resolveExternalDrop(pt, zone, () => ({ kind: 'body', pane: 'p2' }))).toEqual({ kind: 'vault', zone })
  })
})
