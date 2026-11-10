/**
 * Markdown → PDF 로 바꿀 HTML 문서. PDF 리더로 열어 메모·형광펜·박스 메모·편집·화면 나누기·검색·목차·인쇄·버전 관리를
 * PDF 와 똑같이 쓰려고, 원문을 종이(A4) 모양으로 그린다. 상대 경로 그림은 <base> 로 원문 폴더에서 읽는다.
 */
import { renderMarkdown } from './markdown'
import { markdownSourceHash } from './markdownCapture'

/** PDF 캐시 키: 문서 id + 원문 해시(원문이 바뀌면 새 PDF). 파일 이름에 쓰므로 영숫자만 */
export function markdownPdfKey(docId: string, source: string): string {
  const safeId = docId.replace(/[^a-z0-9_]/giu, '_').slice(0, 60)
  return `${safeId}-${markdownSourceHash(source).replace(/[^a-z0-9]/giu, '').slice(0, 24)}`
}

/** 절대 경로의 폴더를 file:/// 주소로(끝에 /) */
export function folderFileUrl(absoluteFilePath: string): string {
  const normalized = absoluteFilePath.replaceAll('\\', '/')
  const folder = normalized.slice(0, normalized.lastIndexOf('/') + 1)
  return `file:///${folder.split('/').map((part, index) => (index === 0 && /^[a-z]:$/iu.test(part) ? part : encodeURIComponent(part))).join('/')}`
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

const STYLE = `
@page { size: A4; margin: 18mm 17mm 20mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #1d1d1f; font: 10.5pt/1.62 'Segoe UI Variable Text', 'Segoe UI', 'Malgun Gothic', system-ui, sans-serif; word-wrap: break-word; }
h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 0.5em; line-height: 1.3; font-weight: 700; break-after: avoid; }
h1 { font-size: 20pt; padding-bottom: 0.3em; border-bottom: 1px solid #d8d8d8; }
h2 { font-size: 15pt; padding-bottom: 0.25em; border-bottom: 1px solid #e4e4e4; }
h3 { font-size: 12.5pt; }
h4 { font-size: 11pt; }
p, ul, ol, blockquote, pre, table { margin: 0 0 0.8em; }
a { color: #1a5fb4; text-decoration: none; }
code { padding: 0.1em 0.35em; border-radius: 4px; background: #f0f0f0; font: 9pt/1.5 'Cascadia Mono', Consolas, monospace; }
pre { padding: 10px 12px; border-radius: 6px; background: #f5f5f5; overflow-wrap: anywhere; white-space: pre-wrap; break-inside: avoid; }
pre code { padding: 0; background: none; }
blockquote { padding: 0.2em 1em; border: 1px solid #e0e0e0; border-radius: 6px; background: #fafafa; color: #333; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
th, td { padding: 5px 8px; border: 1px solid #d0d0d0; vertical-align: top; }
th { background: #f2f2f2; font-weight: 700; }
tr { break-inside: avoid; }
img { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid #d8d8d8; margin: 1.5em 0; }
li > p { margin: 0.2em 0; }
`

/** 인쇄 화면이 읽을 수 있는 것: 이 PC 의 파일·data 그림뿐. 원격 주소는 불러오지 않는다(추적 그림·원격 CSS 방지) */
export const PRINT_CSP = "default-src 'none'; img-src file: data:; style-src 'unsafe-inline'; font-src file: data:"

/**
 * 원격(http·https·//) 주소의 그림은 인쇄하지 않는다: PDF 를 만드는 순간 그 주소로 요청이 나가 읽은 때와 IP 가 알려진다.
 * 그림 자리에는 대체 글(alt)만 남긴다. 상대 경로·file:·data: 그림은 그대로 둔다.
 */
export function stripRemoteImages(html: string): string {
  return html.replace(/<img\b[^>]*>/giu, (tag) => {
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(tag)
    const value = (src?.[1] ?? src?.[2] ?? src?.[3] ?? '').trim()
    if (!/^(?:https?:)?\/\//iu.test(value)) return tag
    const alt = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(tag)
    const text = alt?.[1] ?? alt?.[2] ?? ''
    return text === '' ? '' : `<span class="md-remote-image">${text}</span>`
  })
}

/** PDF 로 인쇄할 HTML 문서 전체 */
export function markdownPdfHtml(source: string, title: string, absoluteFilePath: string): string {
  // renderMarkdown 은 상대 그림을 data-md-src 로 옮겨 둔다(앱 안에서 직접 읽으려고) — 인쇄할 때는 <base> 로 바로 읽는다
  const body = stripRemoteImages(renderMarkdown(source).replaceAll('data-md-src=', 'src='))
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PRINT_CSP)}">`
    + `<base href="${escapeHtml(folderFileUrl(absoluteFilePath))}"><style>${STYLE}</style></head>`
    + `<body><article class="markdown-body">${body}</article></body></html>`
}
