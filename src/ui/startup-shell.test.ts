import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('startup shell', () => {
  it('React가 준비되기 전에도 브랜드 로딩 화면을 표시한다', () => {
    const html = readFileSync('index.html', 'utf8')

    expect(html).toContain('class="app-boot"')
    expect(html).toContain('role="status"')
    expect(html).toContain('IWAE를 여는 중')
    expect(html).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/u)
  })

  it('React가 준비되기 전에도 창을 이동하고 최소화·최대화·닫을 수 있다', () => {
    const html = readFileSync('index.html', 'utf8')

    expect(html).toContain('class="app-boot-titlebar"')
    expect(html).toContain('data-tauri-drag-region="deep"')
    expect(html).toContain('aria-label="최소화"')
    expect(html).toContain('aria-label="최대화"')
    expect(html).toContain('aria-label="닫기"')
    expect(html).toContain('src="/startup-window.js"')
  })

  it('네이티브 WebView 배경도 부트 화면과 같은 색으로 시작한다', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
      app: { windows: Array<{ backgroundColor?: string }> }
    }

    expect(config.app.windows[0]?.backgroundColor).toBe('#171a1e')
  })
})
