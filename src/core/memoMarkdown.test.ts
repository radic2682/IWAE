// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { memoHtmlToMarkdown, memoToMarkdown, plainTextToMarkdown } from './memoMarkdown'
import { renderNoteMarkdown } from './markdownExport'

describe('memoHtmlToMarkdown', () => {
  it('제목 · 굵게 · 기울임 · 취소선 · 코드', () => {
    expect(memoHtmlToMarkdown('<h2>큰 제목</h2><h3>작은</h3><div>가 <b>굵게</b> <i>기울임</i> <s>취소</s> <code>x = 1</code></div>'))
      .toBe('## 큰 제목\n\n### 작은\n\n가 **굵게** *기울임* ~~취소~~ `x = 1`')
  })
  it('굵게 표시 안쪽의 앞뒤 공백은 밖으로 뺀다', () => {
    expect(memoHtmlToMarkdown('가<b> 나 </b>다')).toBe('가 **나** 다')
  })
  it('글머리 · 번호(시작 번호) · 할 일 · 안쪽 목록', () => {
    expect(memoHtmlToMarkdown('<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>')).toBe('- a\n- b\n  - c')
    expect(memoHtmlToMarkdown('<ol start="3"><li>a</li><li>b</li></ol>')).toBe('3. a\n4. b')
    expect(memoHtmlToMarkdown('<ul data-type="check"><li data-checked="true">끝</li><li data-checked="false">할 일</li></ul>')).toBe('- [x] 끝\n- [ ] 할 일')
  })
  it('코드 블록 · 인용 · 구분선 · 줄바꿈', () => {
    expect(memoHtmlToMarkdown('<pre>a<br>  b</pre>')).toBe('```\na\n  b\n```')
    expect(memoHtmlToMarkdown('<blockquote>가<br>나</blockquote>')).toBe('> 가  \n> 나')
    expect(memoHtmlToMarkdown('가<hr>나')).toBe('가\n\n---\n\n나')
    expect(memoHtmlToMarkdown('줄1<br>줄2<div>줄3</div>')).toBe('줄1  \n줄2\n\n줄3')
  })
  it('표', () => {
    const html = '<table><thead><tr><th>이름</th><th align="right">값</th></tr></thead><tbody><tr><td>a|b</td><td><b>1</b></td></tr></tbody></table>'
    expect(memoHtmlToMarkdown(html)).toBe('| 이름 | 값 |\n| --- | ---: |\n| a\\|b | **1** |')
  })
  it('링크', () => {
    expect(memoHtmlToMarkdown('<a href="https://a.com/x y">링크</a>')).toBe('[링크](https://a.com/x%20y)')
  })
  it('글 속의 표시는 표시로 읽히지 않게 막는다', () => {
    expect(memoHtmlToMarkdown('<div>2026. 11. 15. 회의록</div>')).toBe('2026\\. 11. 15. 회의록')
    expect(memoHtmlToMarkdown('<div>1. 안건</div>')).toBe('1\\. 안건')
    expect(memoHtmlToMarkdown('<div># 해시<br>- 대시</div>')).toBe('\\# 해시  \n\\- 대시')
    expect(memoHtmlToMarkdown('<div>a*b* snake_case _x_</div>')).toBe('a\\*b\\* snake_case \\_x\\_')
  })
})

describe('plainTextToMarkdown', () => {
  it('글만 있는 메모의 줄바꿈을 살린다', () => {
    expect(plainTextToMarkdown('가\n나\n\n다')).toBe('가  \n나\n\n다')
  })
  it('목록 · 코드 블록 줄은 건드리지 않는다', () => {
    expect(plainTextToMarkdown('- a\n- b\n\n```\nx\ny\n```')).toBe('- a\n- b\n\n```\nx\ny\n```')
  })
})

describe('노트 내보내기의 서식', () => {
  it('글 블록과 메모 카드의 서식을 Markdown 으로 옮긴다', () => {
    const md = renderNoteMarkdown({
      title: 'T',
      exportedAt: '2026-11-15',
      blocks: [
        { kind: 'text', text: '굵게 목록', html: '<h2>제목</h2><ul><li><b>굵게</b></li></ul>' },
        { kind: 'text', text: '가\n나' },
        { kind: 'memo', quotes: [{ text: '원문', page: 1, docTitle: 'D' }], note: '할 일', noteHtml: '<ul data-type="check"><li data-checked="true">끝</li></ul>' },
      ],
    })
    expect(md).toContain('## 제목\n\n- **굵게**')
    expect(md).toContain('가  \n나')
    expect(md).toContain('- [x] 끝')
  })
  it('html 이 비면 글로 대신한다', () => {
    expect(memoToMarkdown('가', '')).toBe('가')
  })
})
