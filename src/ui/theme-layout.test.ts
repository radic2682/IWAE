import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('앱 창 크롬 레이어', () => {
  it('상단 탭 메뉴가 문서 도구 모음보다 위에 표시된다', () => {
    const css = readFileSync('src/ui/theme-layout.css', 'utf8')
    expect(css).toMatch(/\.topbar\s*\{[^}]*z-index:\s*80/su)
  })

  it('React Flow 출처 배지를 테마에 맞는 투명 상태로 유지한다', () => {
    const css = readFileSync('src/ui/note-followup.css', 'utf8')
    expect(css).toMatch(/\.note-canvas \.react-flow__attribution\s*\{[^}]*background:\s*transparent\s*!important/su)
  })
})

describe('PDF 영구 형광펜 스타일', () => {
  it('저장된 형광펜을 투명한 노란색으로 표시한다', () => {
    const css = readFileSync('src/ui/theme-layout.css', 'utf8')
    expect(css).toMatch(/\.selection-persistent-highlight\s*\{[^}]*fill:[^;}]*(?:#|rgb|color-mix|var\()/su)
    expect(css).toMatch(/\.selection-persistent-highlight\s*\{[^}]*pointer-events:\s*none/su)
  })
})

describe('노트 하단바 오버레이 스타일', () => {
  it('PDF 하단바와 같은 독립된 반투명 surface를 사용한다', () => {
    const css = readFileSync('src/ui/note-followup.css', 'utf8')
    expect(css).toMatch(/\.note-bottom-bar\s*\{[^}]*position:\s*absolute/su)
    expect(css).toMatch(/\.note-bottom-bar-surface\s*\{[^}]*background:[^;}]*(?:var|rgb|color-mix)/su)
    expect(css).toMatch(/\.note-bottom-bar-surface\s*\{[^}]*backdrop-filter:\s*blur/su)
  })
})

describe('좁은 분할 화면 UI 경계', () => {
  it('노트 상단 도구는 패널 안에서 가로 스크롤되어 모든 기능에 접근할 수 있다', () => {
    const css = readFileSync('src/ui/note-followup.css', 'utf8')
    expect(css).toMatch(/\.note-toolbar-controls,\s*\.note-toolbar-secondary-controls\s*\{[^}]*min-width:\s*0/su)
    expect(css).toMatch(/\.note-toolbar-controls,\s*\.note-toolbar-secondary-controls\s*\{[^}]*overflow-x:\s*auto/su)
    expect(css).toMatch(/\.note-toolbar-controls,\s*\.note-toolbar-secondary-controls\s*\{[^}]*scrollbar-width:\s*none/su)
  })

  it('PDF 하단바와 확장 검색 도구는 자신의 패널 폭을 넘지 않는다', () => {
    const pdfCss = readFileSync('src/ui/pdf-followup.css', 'utf8')
    expect(pdfCss).toMatch(/.pane-doc .pdf-bottom-bar-surface\s*\{[^}]*max-width:\s*100%/su)
    expect(pdfCss).toMatch(/.pane-doc .pdf-bottom-bar-surface\s*\{[^}]*overflow-x:\s*auto/su)
    expect(pdfCss).toMatch(/.pane-doc .pdf-bottom-bar-surface\s*\{[^}]*scrollbar-width:\s*none/su)
    expect(pdfCss).toMatch(/.pane-doc .pdf-search-floating-tool-expanded\s*\{[^}]*width:\s*min\([^;]*100%/su)
  })
})

describe('노트 블록 상호작용 스타일', () => {
  it('REF·연결선·상단 정렬 핸들과 자석 결합 상태를 충분히 강조한다', () => {
    const css = `${readFileSync('src/ui/theme-layout.css', 'utf8')}\n${readFileSync('src/ui/canvas-followup.css', 'utf8')}`
    expect(css).toMatch(/\.pdf-excerpt-source\s*\{[^}]*font-size:\s*(?:1[3-9]|[2-9]\d)px/su)
    expect(css).toMatch(/\.canvas-block-drag-handle\s*\{[^}]*top:\s*(?:[0-9]|1[0-9])px/su)
    expect(css).toMatch(/\.source-trace-layer path\s*\{[^}]*stroke-width:\s*(?:2(?:\.\d+)?|[3-9](?:\.\d+)?)px/su)
    expect(css).toMatch(/canvas-node-attached/su)
  })

  it('드롭 애니메이션이 React Flow 위치 transform을 덮어쓰지 않는다', () => {
    const layout = readFileSync('src/ui/theme-layout.css', 'utf8')
    const followup = readFileSync('src/ui/canvas-followup.css', 'utf8')
    expect(layout).not.toMatch(/\.canvas-node-snap-settle\s*\{/u)
    expect(followup).not.toMatch(/\.react-flow__node\.canvas-node-snap-settle\s*\{/u)
    expect(followup).toMatch(/\.react-flow__node\.canvas-node-snap-settle \.canvas-block-shell\s*\{[^}]*animation:/su)
  })

  it('붙은 블록 왼쪽에 별도의 장식점을 그리지 않는다', () => {
    const css = `${readFileSync('src/ui/theme-layout.css', 'utf8')}\n${readFileSync('src/ui/canvas-followup.css', 'utf8')}`
    expect(css).not.toMatch(/\.canvas-node-attached \.canvas-block-shell::after/u)
  })

  it('블록 껍데기의 최소 높이가 캔버스 크기 규칙과 같은 40px이다', () => {
    const css = readFileSync('src/ui/theme-layout.css', 'utf8')
    expect(css).toMatch(/\.canvas-block-shell\s*\{[^}]*min-height:\s*40px/su)
  })
})

describe('공통 스타일 토큰 경계', () => {
  it('문서와 캔버스가 공유하는 의미 기반 토큰을 한곳에서 정의한다', () => {
    const tokens = readFileSync('src/ui/tokens.css', 'utf8')
    for (const token of [
      '--surface-app',
      '--surface-pane',
      '--surface-elevated',
      '--text-primary',
      '--text-muted',
      '--border-subtle',
      '--accent',
      '--source-edge',
      '--toolbar-height',
      '--bottom-bar-height',
      '--radius-control',
      '--shadow-page',
    ]) expect(tokens).toContain(`${token}:`)
    expect(tokens).toContain('--toolbar-height: 38px')
    expect(tokens).toContain('--bottom-bar-height: 37px')
  })

  it('반복되는 떠 있는 컨트롤 색상과 크기를 tokens.css 밖에 직접 쓰지 않는다', () => {
    const css = readdirSync('src/ui')
      .filter((file) => file.endsWith('.css') && file !== 'tokens.css')
      .map((file) => readFileSync(`src/ui/${file}`, 'utf8'))
      .join('\n')
    const repeatedLiterals = [
      '#171a1f',
      '#69727d',
      '#8d99a8',
      'rgb(18 24 33 / 10%)',
      'rgb(177 186 197 / 88%)',
      'rgb(252 252 251 / 91%)',
      'rgb(252 252 251 / 96%)',
    ]

    for (const literal of repeatedLiterals) expect(css).not.toContain(literal)
    expect(css).not.toMatch(/(?:width|height|min-width|max-width):\s*34px/u)
  })

  it('후순위 UI 스타일이 라이트 전용 흰색 surface로 테마 토큰을 덮지 않는다', () => {
    const followupCss = [
      'src/ui/pdf-followup.css',
      'src/ui/note-followup.css',
      'src/ui/canvas-followup.css',
    ].map((file) => readFileSync(file, 'utf8')).join('\n')

    expect(followupCss).not.toMatch(/background:\s*(?:#fff(?:fff)?|rgb\(255 255 255)/u)
  })

  it('PDF와 노트의 떠 있는 surface가 같은 토큰을 사용한다', () => {
    const pdfCss = readFileSync('src/ui/pdf-followup.css', 'utf8')
    const noteCss = readFileSync('src/ui/note-followup.css', 'utf8')

    expect(pdfCss).toMatch(/.pane-doc .pdf-bottom-bar-surface\s*\{[^}]*background:\s*var\(--control-surface-floating\)/su)
    expect(noteCss).toMatch(/\.note-bottom-bar-surface\s*\{[^}]*background:\s*var\(--control-surface-floating\)/su)
    expect(noteCss).toMatch(/\.note-canvas > \.note-toolbar\s*\{[^}]*background:\s*var\(--control-surface-expanded\)/su)
  })

  it('다크 캔버스의 문서 발췌는 전용 프레임으로 원문과 작업 공간을 구분한다', () => {
    const css = readFileSync('src/ui/canvas-followup.css', 'utf8')
    expect(css).toMatch(/:root\[data-theme='dark'\] \.pdf-excerpt-node-body\s*\{[^}]*border:/su)
    expect(css).toMatch(/:root\[data-theme='dark'\] \.pdf-excerpt-node-body\s*\{[^}]*box-shadow:/su)
  })
})

describe('스크롤 영역 레이아웃 안정성', () => {
  it('스크롤바가 나타나도 주요 surface 폭이 흔들리지 않는다', () => {
    const css = readFileSync('src/ui/theme-layout.css', 'utf8')
    expect(css).toMatch(/\.side-scroll\s*\{[^}]*scrollbar-gutter:\s*stable/su)
    expect(css).toMatch(/\.settings-modal-body\s*\{[^}]*scrollbar-gutter:\s*stable/su)
    expect(css).toMatch(/\.pdf-search-panel\s*\{[^}]*scrollbar-gutter:\s*stable/su)
  })
})

describe('설정 및 업데이트 surface', () => {
  it('설정 창을 탐색과 상세 패널의 2열 레이아웃으로 표시한다', () => {
    const css = readFileSync('src/ui/theme-layout.css', 'utf8')
    expect(css).toMatch(/\.settings-modal-workspace\s*\{[^}]*grid-template-columns:\s*190px\s+minmax\(0,\s*1fr\)/su)
    expect(css).toMatch(/\.settings-modal-nav\s*\{[^}]*border-right:\s*1px\s+solid\s+var\(--divider\)/su)
  })

  it('업데이트 알림은 상단 바 아래 떠 있는 작은 surface다', () => {
    const css = readFileSync('src/ui/theme-layout.css', 'utf8')
    expect(css).toMatch(/\.update-banner\s*\{[^}]*position:\s*fixed/su)
    expect(css).toMatch(/\.update-banner\s*\{[^}]*backdrop-filter:\s*blur/su)
  })
})
