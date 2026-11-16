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

/** 열기 창의 파일 형식 거르개 하나(이름 + 점 없는 확장자 목록) */
export interface DocumentPickerFilter {
  readonly name: string
  readonly extensions: readonly string[]
}

/** 형식별 거르개 차례: 열기 창 목록에 이 순서로 나온다 */
const PICKER_FORMAT_ORDER: readonly DocumentFormat[] = ['pdf', 'markdown', 'text', 'html', 'xml']

/**
 * 문서 열기 창의 거르개. 맨 앞 「문서」는 열 수 있는 확장자 전부(처음 보이는 목록),
 * 뒤로 형식별 거르개가 이어진다
 */
export function documentPickerFilters(): readonly DocumentPickerFilter[] {
  return [
    { name: t('문서'), extensions: DOCUMENT_EXTENSIONS },
    ...PICKER_FORMAT_ORDER.map((format) => ({ name: documentFormatLabel(format), extensions: extensionsOfFormat(format) })),
  ]
}

/**
 * 목록·탭에 보일 이름. 표시 이름이 파일 이름에서 확장자만 뗀 기본값이면(고쳐 쓰지 않았으면),
 * 텍스트·HTML·XML 은 확장자를 붙여 보인다. 같은 폴더의 `a.md` 와 `a.txt` 가 둘 다 "a" 로 보이지 않게 하려는 것이다.
 * PDF·Markdown 은 예전처럼 확장자 없이 보인다
 */
export function shownDocumentName(path: string, displayName: string): string {
  const base = path.split(/[\\/]/u).at(-1) ?? path
  const format = documentFormatOf(base)
  if ((format === 'text' || format === 'html' || format === 'xml') && displayName === stripDocumentExtension(base)) return base
  return displayName
}
