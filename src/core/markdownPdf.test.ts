// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { folderFileUrl, markdownPdfHtml, markdownPdfKey, PRINT_CSP, stripRemoteImages } from './markdownPdf'

describe('Markdown → PDF HTML', () => {
  it('원문 폴더를 base 로 두고 상대 그림을 그대로 읽게 한다', () => {
    const html = markdownPdfHtml('# 제목\n\n![그림](images/a.png)\n\n본문', 'Spec', 'C:\\Vault\\Docs\\Spec.md')
    expect(html).toContain('<title>Spec</title>')
    expect(html).toContain('<base href="file:///C:/Vault/Docs/">')
    expect(html).toContain('src="images/a.png"')
    expect(html).not.toContain('data-md-src')
    expect(html).toContain('<h1')
  })

  it('인쇄 화면은 원격 주소를 읽지 못하게 CSP 를 붙이고 원격 그림은 뺀다', () => {
    const html = markdownPdfHtml('![로고](https://tracker.example/pixel.png)\n\n![내 그림](images/a.png)\n\n<img src="//cdn.example/x.png" alt="없음">', 'Spec', 'C:\\Vault\\Docs\\Spec.md')
    expect(html).toContain(`http-equiv="Content-Security-Policy" content="${PRINT_CSP}"`)
    expect(html).not.toContain('tracker.example')
    expect(html).not.toContain('cdn.example')
    expect(html).toContain('src="images/a.png"')
    expect(PRINT_CSP).not.toMatch(/https?:/u)
  })

  it('stripRemoteImages 는 원격 그림만 alt 글로 바꾼다', () => {
    expect(stripRemoteImages('<p><img src="http://a.example/p.png" alt="점"></p>')).toBe('<p><span class="md-remote-image">점</span></p>')
    expect(stripRemoteImages("<img alt='' src='https://a.example/p.png'>")).toBe('')
    expect(stripRemoteImages('<img src=HTTP://a.example/p.png>')).toBe('')
    for (const keep of ['<img src="images/a.png">', '<img src="file:///C:/x.png">', '<img src="data:image/png;base64,AAAA">', '<img alt="https://x" src="a.png">']) {
      expect(stripRemoteImages(keep)).toBe(keep)
    }
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
