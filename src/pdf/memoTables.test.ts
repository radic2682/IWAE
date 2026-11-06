// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { hasMemoFormatting, markdownToMemoHtml, plainMemoTextToHtml, sanitizeMemoHtml } from './memoRichText'
import { looksLikeMarkdown } from './memoEditing'

describe('노트·메모의 표', () => {
  it('Markdown 표를 머리줄·정렬·칸 서식까지 표로 바꾼다', () => {
    const html = plainMemoTextToHtml([
      '조건',
      '| 항목 | 최소 | 최대 |',
      '|:---|:---:|---:|',
      '| UVLO 상승 | **2.4** V | 2.7 V |',
      '| 파이프 \\| 글자 | 1 | 2 |',
    ].join('\n'))
    expect(html).toContain('조건')
    expect(html).toContain('<table><thead><tr><th align="left">항목</th><th align="center">최소</th><th align="right">최대</th></tr></thead>')
    expect(html).toContain('<td align="left">UVLO 상승</td><td align="center"><b>2.4</b> V</td>')
    expect(html).toContain('파이프 | 글자')
  })

  it('표가 아닌 | 글은 그대로 둔다', () => {
    expect(plainMemoTextToHtml('a | b')).toBe('a | b')
  })

  it('붙여 넣은 HTML 표는 칸 합치기·정렬만 남기고 나머지 속성은 지운다', () => {
    const html = sanitizeMemoHtml('<table class="x" onclick="y()"><tr><td colspan="2" style="width:9px" align="center" data-x="1">A</td></tr></table>')
    expect(html).toBe('<table><tbody><tr><td colspan="2" align="center">A</td></tr></tbody></table>')
    expect(hasMemoFormatting(html)).toBe(true)
  })

  it('MCP 의 Markdown(소제목 아닌 글 블록)을 서식 HTML 로', () => {
    const html = markdownToMemoHtml('**중요**\r\n- 하나\r\n- 둘\r\n\r\n| a | b |\r\n|---|---|\r\n| 1 | 2 |')
    expect(html).toContain('<b>중요</b>')
    expect(html).toContain('<ul><li>하나</li><li>둘</li></ul>')
    expect(html).toContain('<table>')
  })

  it('표 Markdown 을 붙여 넣으면 서식으로 바꾼다', () => {
    expect(looksLikeMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(true)
  })
})
