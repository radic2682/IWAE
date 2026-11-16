import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_EXTENSIONS,
  documentFormatLabel,
  documentFormatOf,
  extensionsOfFormat,
  isFlowDocumentPath,
  isOpenableDocumentPath,
  readerKindOf,
} from './documentFormat'

describe('documentFormatOf', () => {
  it('확장자마다 형식을 정한다', () => {
    const cases: [string, string][] = [
      ['a.pdf', 'pdf'],
      ['a.md', 'markdown'], ['a.markdown', 'markdown'],
      ['a.txt', 'text'], ['a.text', 'text'], ['a.log', 'text'],
      ['a.html', 'html'], ['a.htm', 'html'], ['a.xhtml', 'html'],
      ['a.xml', 'xml'],
    ]
    for (const [path, format] of cases) expect(documentFormatOf(path)).toBe(format)
  })

  it('대소문자와 폴더 경로는 상관없다', () => {
    expect(documentFormatOf('C:\\Docs\\A.PDF')).toBe('pdf')
    expect(documentFormatOf('x/y/Guide.Markdown')).toBe('markdown')
    expect(documentFormatOf('/home/u/Page.HTM')).toBe('html')
    expect(documentFormatOf('Report.Xml')).toBe('xml')
  })

  it('확장자가 없거나 모르는 이름은 null', () => {
    for (const path of ['', 'README', 'notes/cmd', 'readmemd', 'notes/xmarkdown', 'a.mdx', 'a.md.bak', 'a.png', 'a.canvas', 'a.', 'notes.md/readme']) {
      expect(documentFormatOf(path)).toBeNull()
    }
  })

  it('폴더 이름의 점은 확장자가 아니다', () => {
    expect(documentFormatOf('v1.2/readme')).toBeNull()
    expect(documentFormatOf('v1.2/readme.txt')).toBe('text')
  })

  it('앞에 점이 붙은 이름은 점 뒤를 확장자로 본다(예전 isMarkdownPath 와 같다)', () => {
    expect(documentFormatOf('.md')).toBe('markdown')
    expect(documentFormatOf('.gitignore')).toBeNull()
  })
})

describe('reader kind and helpers', () => {
  it('PDF 만 pdf 읽기 화면이고 나머지는 flow 다', () => {
    expect(readerKindOf('pdf')).toBe('pdf')
    for (const format of ['markdown', 'text', 'html', 'xml'] as const) expect(readerKindOf(format)).toBe('flow')
  })

  it('isFlowDocumentPath · isOpenableDocumentPath', () => {
    expect(isFlowDocumentPath('a.md')).toBe(true)
    expect(isFlowDocumentPath('a.xml')).toBe(true)
    expect(isFlowDocumentPath('a.pdf')).toBe(false)
    expect(isFlowDocumentPath('a.png')).toBe(false)
    expect(isOpenableDocumentPath('a.pdf')).toBe(true)
    expect(isOpenableDocumentPath('a.log')).toBe(true)
    expect(isOpenableDocumentPath('a.png')).toBe(false)
  })

  it('확장자 목록은 형식별 목록을 모두 합친 것이다', () => {
    expect([...DOCUMENT_EXTENSIONS].sort()).toEqual(['htm', 'html', 'log', 'markdown', 'md', 'pdf', 'text', 'txt', 'xhtml', 'xml'])
    expect(extensionsOfFormat('html')).toEqual(['html', 'htm', 'xhtml'])
  })

  it('형식마다 이름이 있다', () => {
    for (const format of ['pdf', 'markdown', 'text', 'html', 'xml'] as const) expect(documentFormatLabel(format)).not.toBe('')
  })
})
