import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('desktop window state', () => {
  it('앱 종료 후 창 위치와 크기를 자동 복원하는 플러그인을 등록한다', () => {
    const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8')
    const rust = readFileSync('src-tauri/src/lib.rs', 'utf8')

    expect(cargo).toContain('tauri-plugin-window-state')
    expect(rust).toContain('tauri_plugin_window_state::Builder::default().build()')
  })

  it('창이 만들어지기 전(setup 앞)에 등록한다 — setup 안에서 등록하면 메인 창을 놓쳐 빈 상태만 저장된다', () => {
    const rust = readFileSync('src-tauri/src/lib.rs', 'utf8')
    const plugin = rust.indexOf('tauri_plugin_window_state::Builder::default().build()')
    const setup = rust.indexOf('.setup(')
    expect(plugin).toBeGreaterThan(-1)
    expect(setup).toBeGreaterThan(-1)
    expect(plugin).toBeLessThan(setup)
  })
})
