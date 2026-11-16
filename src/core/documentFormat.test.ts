import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_EXTENSIONS,
  documentFormatLabel,
  documentFormatOf,
  documentPickerFilters,
  shownDocumentName,
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

describe('documentPickerFilters', () => {
  it('맨 앞 「문서」 거르개는 열 수 있는 확장자 전부이고, 형식별 거르개가 뒤따른다', () => {
    const filters = documentPickerFilters()
    expect(filters[0]).toEqual({ name: '문서', extensions: DOCUMENT_EXTENSIONS })
    expect(filters.map((filter) => filter.name)).toEqual(['문서', 'PDF', 'Markdown', '텍스트', 'HTML', 'XML'])
    expect(filters.find((filter) => filter.name === 'HTML')?.extensions).toEqual(['html', 'htm', 'xhtml'])
    // 형식별 확장자를 합치면 「문서」 와 같다(빠진 것도 겹치는 것도 없다)
    expect(filters.slice(1).flatMap((filter) => [...filter.extensions]).sort()).toEqual([...DOCUMENT_EXTENSIONS].sort())
    // 점·별표 없이 소문자 확장자만
    for (const extension of DOCUMENT_EXTENSIONS) expect(extension).toMatch(/^[a-z]+$/u)
  })
})

describe('shownDocumentName', () => {
  it('텍스트·HTML·XML 은 기본 이름에 확장자를 붙여 보이고 PDF·Markdown 은 그대로 둔다', () => {
    expect(shownDocumentName('Docs/a.txt', 'a')).toBe('a.txt')
    expect(shownDocumentName('Docs/page.HTML', 'page')).toBe('page.HTML')
    expect(shownDocumentName('c:/x/data.xml', 'data')).toBe('data.xml')
    expect(shownDocumentName('Docs/a.md', 'a')).toBe('a')
    expect(shownDocumentName('Docs/a.pdf', 'a')).toBe('a')
  })
  it('고쳐 쓴 표시 이름은 건드리지 않는다', () => {
    expect(shownDocumentName('Docs/a.txt', '내 메모')).toBe('내 메모')
    expect(shownDocumentName('Docs/a.txt', 'a.txt')).toBe('a.txt')
  })
})
