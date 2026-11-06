// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { githubSlug, renderMarkdown, resolveMarkdownLink, resolveRelativePath } from './markdown'

describe('renderMarkdown', () => {
  it('제목·강조·목록·인용·코드를 HTML 로 바꾸고 제목에 GitHub 식 id 를 붙인다', () => {
    const html = renderMarkdown([
      '# 제목',
      '## Boot Flow',
      '## Boot Flow',
      '',
      '문단의 **굵은 글씨**, *기울임*, `코드`, [링크](https://example.com).',
      '',
      '- 첫 항목',
      '',
      '> 인용',
      '',
      '```ts',
      'const value = 1 < 2',
      '```',
    ].join('\n'))
    expect(html).toContain('<h1 id="제목">제목</h1>')
    expect(html).toContain('<h2 id="boot-flow">Boot Flow</h2>')
    expect(html).toContain('<h2 id="boot-flow-1">Boot Flow</h2>')
    expect(html).toContain('<strong>굵은 글씨</strong>')
    expect(html).toContain('<a href="https://example.com" rel="noreferrer noopener">링크</a>')
    expect(html).toContain('<li>첫 항목</li>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('const value = 1 &lt; 2')
  })

  it('표를 그리고 가로 스크롤 상자로 감싼다', () => {
    const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<div class="markdown-table-wrap"><table>')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<td>2</td>')
  })

  it('상대 경로 그림은 주소를 data-md-src 로 옮긴다(HTML 조각 안의 그림도)', () => {
    const html = renderMarkdown('![그림](images/boot.png)\n\n<img src="./a/b.svg" width="200">')
    expect(html).toContain('data-md-src="images/boot.png"')
    expect(html).toContain('data-md-src="./a/b.svg"')
    expect(html).not.toMatch(/\ssrc="images\/boot\.png"/u)
  })

  it('스크립트·이벤트 속성·javascript: 링크를 지운다', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script> [실행](javascript:alert(1))')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/href="javascript:/u)
    expect(html).toContain('실행')
  })
})

describe('Markdown 링크 풀기', () => {
  it('상대 경로를 지금 문서 폴더 기준으로 푼다', () => {
    expect(resolveRelativePath('../images/a.png', 'GitHub/example-docs/docs/spec/x.md')).toBe('GitHub/example-docs/docs/images/a.png')
    expect(resolveRelativePath('b.md', 'C:/Users/me/docs/a.md')).toBe('C:/Users/me/docs/b.md')
    expect(resolveRelativePath('../../../x.md', 'a/b.md')).toBeNull()
  })
  it('바깥 주소·같은 문서 제목·다른 문서를 가른다', () => {
    expect(resolveMarkdownLink('https://github.com', 'docs/a.md')).toEqual({ kind: 'external', url: 'https://github.com' })
    expect(resolveMarkdownLink('#boot-flow', 'docs/a.md')).toEqual({ kind: 'anchor', id: 'boot-flow' })
    expect(resolveMarkdownLink('./sub/b.md#reset', 'docs/a.md')).toEqual({ kind: 'document', path: 'docs/sub/b.md', anchor: 'reset' })
    expect(resolveMarkdownLink('javascript:alert(1)', 'docs/a.md')).toBeNull()
  })
  it('GitHub 식 제목 id', () => {
    const used = new Map<string, number>()
    expect(githubSlug('3.1 Reset & Boot', used)).toBe('31-reset--boot')
    expect(githubSlug('3.1 Reset & Boot', used)).toBe('31-reset--boot-1')
  })
})
