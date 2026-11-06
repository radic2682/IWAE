// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { folderFileUrl, markdownPdfHtml, markdownPdfKey } from './markdownPdf'

describe('Markdown → PDF HTML', () => {
  it('원문 폴더를 base 로 두고 상대 그림을 그대로 읽게 한다', () => {
    const html = markdownPdfHtml('# 제목\n\n![그림](images/a.png)\n\n본문', 'Spec', 'C:\\Vault\\Docs\\Spec.md')
    expect(html).toContain('<title>Spec</title>')
    expect(html).toContain('<base href="file:///C:/Vault/Docs/">')
    expect(html).toContain('src="images/a.png"')
    expect(html).not.toContain('data-md-src')
    expect(html).toContain('<h1')
  })

  it('폴더 주소는 이름을 인코딩한다', () => {
    expect(folderFileUrl('C:/Vault/Example docs/a.md')).toBe('file:///C:/Vault/Example%20docs/')
  })

  it('캐시 키는 문서 id 와 원문 해시로, 원문이 바뀌면 달라진다', () => {
    const a = markdownPdfKey('ab12', 'hello')
    expect(a).toMatch(/^ab12-[a-z0-9]+$/iu)
    expect(markdownPdfKey('ab12', 'hello!')).not.toBe(a)
    expect(markdownPdfKey('ab12', 'hello')).toBe(a)
  })
})

import { markdownHeadings } from '../app/MarkdownOutline'
describe('Markdown 목차', () => {
  it('제목만, 코드 블록 안의 # 은 빼고', () => {
    expect(markdownHeadings('# A\n\ntext\n```\n# not\n```\n## B **bold**\n### C ###')).toEqual([
      { depth: 1, title: 'A' }, { depth: 2, title: 'B bold' }, { depth: 3, title: 'C' },
    ])
  })
})

import { markdownSectionPreviews } from '../app/MarkdownOutline'
describe('Markdown 절 미리보기', () => {
  it('h1–h3 절마다 제목과 첫 줄들(표 구분선·기호는 뺀다)', () => {
    const sections = markdownSectionPreviews('# A\n\nfirst **line**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n## B\n- item\n#### deep\ntext')
    expect(sections.map((section) => section.title)).toEqual(['A', 'B'])
    expect(sections[0]!.excerpt).toContain('first line')
    expect(sections[0]!.excerpt).not.toContain('---')
    expect(sections[1]!.excerpt).toContain('item')
  })
})
