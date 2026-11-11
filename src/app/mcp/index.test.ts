// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPS, isMcpOp, registeredOps } from './index'

/** Rust 의 도구 표(app_tools.rs): 웹뷰가 처리하는(Memo·App) 도구와 그 성격 */
function rustTable(): Map<string, string> {
  const source = readFileSync(join(__dirname, '../../../src-tauri/src/mcp/app_tools.rs'), 'utf8')
  const table = new Map<string, string>()
  for (const match of source.matchAll(/\bt\("([a-z_]+)",\s*(R|W|D|Ui),\s*\d+,\s*(Core|Page|Memo|App)\)/gu)) {
    if (match[3] === 'Memo' || match[3] === 'App') table.set(match[1]!, match[2]!)
  }
  return table
}

const CLASS: Record<string, string> = { R: 'read', W: 'write', D: 'destructive', Ui: 'ui' }

describe('MCP op 표와 Rust 도구 표', () => {
  it('Rust 가 웹뷰로 보내는 op 를 모두 처리하고, 그 밖의 op 는 없다(doc_flags 만 보조로 더 있다)', () => {
    const rust = rustTable()
    expect(rust.size).toBeGreaterThan(40)
    const ours = new Set(registeredOps())
    for (const name of rust.keys()) expect(ours.has(name), `${name} 를 웹뷰가 처리해야 합니다`).toBe(true)
    for (const name of ours) expect(rust.has(name) || name === 'doc_flags', `${name} 은 Rust 표에 없습니다`).toBe(true)
  })

  it('성격(read/write/destructive/ui)이 Rust 표와 같다', () => {
    for (const [name, rustClass] of rustTable()) {
      // 파일로 내보내는 export 는 Rust 가 쓰기로 보지만 웹뷰에서는 읽기 경로로 처리한다(되돌릴 변경 없음)
      if (name === 'note_export_markdown') continue
      expect(OPS[name]!.cls, name).toBe(CLASS[rustClass])
    }
  })

  it('캔버스 op 는 이 표에 없다(다른 다리가 받는다)', () => {
    expect(isMcpOp('canvas_add_blocks')).toBe(false)
    expect(isMcpOp('note_build')).toBe(true)
  })
})
