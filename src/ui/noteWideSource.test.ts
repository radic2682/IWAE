import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'note-wide.css'), 'utf8').split(String.fromCharCode(13)).join('')

describe('넓은 노트의 메모 카드', () => {
  it('카드 모양을 바꾸는 규칙이 없다(원문 줄 · 검색 흐림 모두 좁은 칸과 같다)', () => {
    // 넓은 칸은 글 칸 폭과 목차만 바꾼다. 사용자가 「너비가 커졌을 때 메모 디자인이 안 바뀌었으면」 했다(2026-11-13)
    expect(css).not.toContain('.pdf-memo-card-quote')
    expect(css).not.toContain('.note-source-quote')
    expect(css).not.toContain('.pdf-memo-card-dim')
    expect(css).not.toContain('--hlc-dot')
  })

  it('넓은 칸은 글 칸을 가운데 708px 로 두고 왼쪽에 목차를 놓는다', () => {
    expect(css).toContain('width: min(100%, 708px)')
    expect(css).toContain('.note-outline {')
  })
})
