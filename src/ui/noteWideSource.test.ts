import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(__dirname, 'note-wide.css'), 'utf8').split(String.fromCharCode(13)).join('')

describe('메모만 보기(넓은 노트)의 원문 줄', () => {
  it('원문 상자 전체에는 형광펜 바탕이 없고, 따옴표 글(.note-source-quote)에만 입힌다', () => {
    const box = css.match(/\.pdf-memo-card-quote\.note-source\.note-source \{[^}]*\}/u)?.[0] ?? ''
    expect(box).toContain('background: transparent !important')
    expect(box).not.toContain('--hlc-dot')
    const quote = css.match(/\.note-source-quote \{[^}]*\}/u)?.[0] ?? ''
    expect(quote).toContain('--hlc-dot')
  })

  it('쪽 번호는 색 밖 오른쪽 끝에 놓인다', () => {
    expect(css).toContain('.note-source-page { margin-left: auto; }')
  })
})
