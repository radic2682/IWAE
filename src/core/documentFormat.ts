import { t } from '../i18n'

/** IWAE 가 문서로 아는 파일 형식. 확장자 판단은 전부 여기서 한다 */
export type DocumentFormat = 'pdf' | 'markdown' | 'text' | 'html' | 'xml'
/** 문서를 여는 읽기 화면: PDF 는 페이지 이미지, 나머지는 흐르는 글(flow) 읽기 화면 */
export type ReaderKind = 'pdf' | 'flow'

const FORMAT_EXTENSIONS: Readonly<Record<DocumentFormat, readonly string[]>> = {
  pdf: ['pdf'],
  markdown: ['md', 'markdown'],
  text: ['txt', 'text', 'log'],
  html: ['html', 'htm', 'xhtml'],
  xml: ['xml'],
}

const FORMAT_BY_EXTENSION: ReadonlyMap<string, DocumentFormat> = new Map(
  (Object.entries(FORMAT_EXTENSIONS) as [DocumentFormat, readonly string[]][])
    .flatMap(([format, extensions]) => extensions.map((extension) => [extension, format] as const)),
)

/** 열 수 있는 문서 확장자(점 없이, 소문자). 열기 창·끌어다 놓기가 이 목록을 쓴다 */
export const DOCUMENT_EXTENSIONS: readonly string[] = [...FORMAT_BY_EXTENSION.keys()]

/** 형식별 확장자(열기 창의 형식별 거르개용) */
export function extensionsOfFormat(format: DocumentFormat): readonly string[] {
  return FORMAT_EXTENSIONS[format]
}

/**
 * 경로(이름)의 확장자로 문서 형식을 판단한다(대소문자 무시). 확장자가 없거나 모르는 것이면 null.
 * `notes/cmd` 처럼 점 없이 md 로 끝나는 이름은 문서 형식이 아니다.
 * `.md` 처럼 점으로 시작하는 이름도 점 뒤를 확장자로 본다(예전 isMarkdownPath 와 같다)
 */
export function documentFormatOf(path: string): DocumentFormat | null {
  const match = /\.([^.\\/]+)$/u.exec(path)
  if (match === null) return null
  return FORMAT_BY_EXTENSION.get(match[1]!.toLowerCase()) ?? null
}

export function readerKindOf(format: DocumentFormat): ReaderKind {
  return format === 'pdf' ? 'pdf' : 'flow'
}

/** 흐르는 글 읽기 화면으로 여는 문서(Markdown·텍스트·HTML·XML)인가 */
export function isFlowDocumentPath(path: string): boolean {
  const format = documentFormatOf(path)
  return format !== null && readerKindOf(format) === 'flow'
}

/** IWAE 에서 열 수 있는 문서(PDF 포함)인가 */
export function isOpenableDocumentPath(path: string): boolean {
  return documentFormatOf(path) !== null
}

/** 이름에서 문서 확장자(.pdf·.md·.txt 등)를 뗀다. 문서 확장자가 아니면 그대로 둔다 */
export function stripDocumentExtension(name: string): string {
  return documentFormatOf(name) === null ? name : name.replace(/\.[^.\\/]+$/u, '')
}

/** 화면에 보일 형식 이름 */
export function documentFormatLabel(format: DocumentFormat): string {
  switch (format) {
    case 'pdf': return 'PDF'
    case 'markdown': return 'Markdown'
    case 'text': return t('텍스트')
    case 'html': return 'HTML'
    case 'xml': return 'XML'
  }
}

/** PDF 문서인가 */
export function isPdfPath(path: string): boolean {
  return documentFormatOf(path) === 'pdf'
}
