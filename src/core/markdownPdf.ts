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

/** HTML 속성 값 안의 문자 참조(&#92; &bsol; &amp; …)를 풀고, URL 파서가 지우는 공백·제어 문자를 뺀다 */
function decodeAttribute(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', bsol: '\\', sol: '/', colon: ':', period: '.', tab: '', newline: '' }
  const decoded = value
    .replace(/&#x([0-9a-f]+);?/giu, (_, hex: string) => String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff)))
    .replace(/&#(\d+);?/gu, (_, digits: string) => String.fromCodePoint(Math.min(Number.parseInt(digits, 10), 0x10ffff)))
    .replace(/&([a-z]+);/giu, (whole, name: string) => named[name.toLowerCase()] ?? whole)
  // eslint-disable-next-line no-control-regex
  return decoded.replace(/[\u0000-\u001f\u007f]/gu, '').trim()
}

function pathParts(path: string): string[] {
  return path.replaceAll('\\', '/').split('/').filter((part) => part !== '')
}

/** 그림 주소가 인쇄해도 되는 것인가: data 그림, 또는 원문 폴더 기준으로 풀었을 때 이 PC 의 로컬 경로(Vault 안)로 끝나는 것 */
export function isPrintableImageSource(rawSource: string, absoluteFilePath: string, vaultRoot?: string): boolean {
  const value = decodeAttribute(rawSource)
  if (value === '') return false
  if (/^data:image\//iu.test(value)) return true
  // 서버 꼴(\\host\share, /\host, //host)은 안 된다. 한 개짜리 / 나 C:/ 로 시작하는 절대 경로는 아래에서 Vault 안인지 본다
  if (/^[\\/]{2}/u.test(value)) return false
  const absolute = /^(?:[\\/]|[a-z]:[\\/])/iu.test(value)
  if (absolute && (vaultRoot === undefined || vaultRoot === '')) return false
  const scheme = absolute ? null : /^([a-z][a-z0-9+.-]*):/iu.exec(value)
  let parts: string[]
  if (absolute) {
    parts = []
    const drive = /^([a-z]:)[\\/]/iu.exec(value)
    if (drive !== null) parts.push(drive[1]!)
    for (const part of pathParts(value.slice(drive === null ? 0 : 2).split(/[?#]/u)[0]!)) {
      let name: string
      try { name = decodeURIComponent(part) } catch { return false }
      if (/[\\/:]/u.test(name)) return false
      if (name === '.') continue
      if (name === '..') {
        if (parts.length === 0) return false
        parts.pop()
        continue
      }
      parts.push(part)
    }
  } else if (scheme !== null) {
    // file:///C:/x.png 만. file://host/x.png(호스트 있는 것)·그 밖의 주소는 안 된다
    if (scheme[1]!.toLowerCase() !== 'file') return false
    const rest = value.slice('file:'.length).replaceAll('\\', '/')
    if (!rest.startsWith('///')) return false
    parts = []
    for (const part of pathParts(rest.slice(3))) parts.push(part)
  } else {
    parts = [...pathParts(absoluteFilePath).slice(0, -1)]
    for (const part of pathParts(value.split(/[?#]/u)[0]!)) {
      let name: string
      try { name = decodeURIComponent(part) } catch { return false }
      // 퍼센트로 숨긴 \ 나 드라이브(C:)·호스트 흔적은 거절한다
      if (/[\\/:]/u.test(name)) return false
      if (name === '.') continue
      if (name === '..') {
        if (parts.length === 0) return false
        parts.pop()
        continue
      }
      parts.push(part)
    }
  }
  if (parts.some((part) => part === '..')) return false
  if (vaultRoot === undefined || vaultRoot === '') return true
  const root = pathParts(vaultRoot).map((part) => part.toLowerCase())
  const target = parts.map((part) => { try { return decodeURIComponent(part).toLowerCase() } catch { return part.toLowerCase() } })
  return root.length <= target.length && root.every((part, index) => target[index] === part)
}

/**
 * 인쇄해도 되는 그림만 남긴다. 원격(http·https·//) 주소는 PDF 를 만드는 순간 요청이 나가 IP 가 알려지고,
 * \\host\share 나 /\host 꼴은 file://host/ 로 풀려 SMB 로 나가며 Windows 로그인 정보(NTLM)까지 새므로 모두 뺀다.
 * 그림 자리에는 대체 글(alt)만 남긴다. 원문 폴더 기준 상대 경로·file:///·data: 그림은 그대로 둔다(\`vaultRoot\` 를 주면 Vault 밖으로 나가는 것도 뺀다).
 */
export function stripRemoteImages(html: string, absoluteFilePath = 'C:/note.md', vaultRoot?: string): string {
  return sanitizePrintUrls(stripImgTags(html, absoluteFilePath, vaultRoot), absoluteFilePath, vaultRoot)
}

const FETCH_ATTRIBUTES = new Set(['src', 'poster', 'background', 'data', 'href', 'xlink:href', 'action', 'formaction', 'longdesc', 'manifest', 'codebase', 'lowsrc', 'dynsrc', 'icon'])
const DROPPED_ELEMENTS = 'style, link, meta, base, object, embed, iframe, frame, frameset, script, applet'
const UNSAFE_CSS = /url\s*\(|image-set|image\s*\(|src\s*\(|@import|expression|[\\]/iu

/**
 * 그림 말고도 주소를 불러오는 속성(svg image 의 href, poster, background, style 의 url() …)과 <style>·<link> 를
 * 같은 기준으로 거른다. style 은 url()·escape 가 든 선언만 빼고 색·정렬 같은 것은 남긴다.
 */
function sanitizePrintUrls(html: string, absoluteFilePath: string, vaultRoot?: string): string {
  if (typeof document === 'undefined') return html
  const template = document.createElement('template')
  template.innerHTML = html
  for (const element of Array.from(template.content.querySelectorAll(DROPPED_ELEMENTS))) element.remove()
  for (const element of Array.from(template.content.querySelectorAll('*'))) {
    const isLink = element.localName === 'a' || element.localName === 'area'
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name === 'srcset' || name === 'imagesrcset') { element.removeAttribute(attribute.name); continue }
      if (name === 'style') {
        const kept = attribute.value.split(';').filter((declaration) => !UNSAFE_CSS.test(declaration)).join(';')
        if (kept.trim() === '') element.removeAttribute(attribute.name)
        else element.setAttribute(attribute.name, kept)
        continue
      }
      if (FETCH_ATTRIBUTES.has(name)) {
        if (isLink && (name === 'href' || name === 'xlink:href')) continue
        if (!isPrintableImageSource(attribute.value, absoluteFilePath, vaultRoot)) element.removeAttribute(attribute.name)
        continue
      }
      if (UNSAFE_CSS.test(decodeAttribute(attribute.value))) element.removeAttribute(attribute.name)
    }
  }
  return template.innerHTML
}

function stripImgTags(html: string, absoluteFilePath: string, vaultRoot?: string): string {
  return html.replace(/<source\b[^>]*>/giu, '').replace(/<img\b[^>]*>/giu, (tag) => {
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(tag)
    const value = src?.[1] ?? src?.[2] ?? src?.[3] ?? ''
    // srcset 의 후보 주소도 같은 길로 나가므로 속성째 뺀다
    const plain = tag.replace(/\ssrcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, '')
    if (src === null || isPrintableImageSource(value, absoluteFilePath, vaultRoot)) return plain
    const alt = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(tag)
    const text = alt?.[1] ?? alt?.[2] ?? ''
    return text === '' ? '' : `<span class="md-remote-image">${text}</span>`
  })
}

/** PDF 로 인쇄할 HTML 문서 전체 */
export function markdownPdfHtml(source: string, title: string, absoluteFilePath: string, vaultRoot?: string): string {
  // renderMarkdown 은 상대 그림을 data-md-src 로 옮겨 둔다(앱 안에서 직접 읽으려고) — 인쇄할 때는 <base> 로 바로 읽는다
  const body = stripRemoteImages(renderMarkdown(source).replaceAll('data-md-src=', 'src='), absoluteFilePath, vaultRoot)
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PRINT_CSP)}">`
    + `<base href="${escapeHtml(folderFileUrl(absoluteFilePath))}"><style>${STYLE}</style></head>`
    + `<body><article class="markdown-body">${body}</article></body></html>`
}
