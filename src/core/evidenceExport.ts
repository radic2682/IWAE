/**
 * 노트 + 근거 묶음 내보내기의 순수한 부분. 캔버스 문서와 미리 그려 둔 그림(data URL)만 받아
 * 한 파일짜리 HTML 을 만든다 — 브라우저·파일·PDF 엔진을 모르므로 그대로 시험할 수 있다.
 */

import type { Anchor } from './anchor'
import type { PersistedCanvasEdge, PersistedCanvasNode } from './canvasDocument'
import { getLocale, t } from '../i18n'

const SKIPPED_KINDS = new Set(['rectangle', 'square', 'ellipse', 'diamond', 'arrow'])
const MAP_WIDTH = 1000
const MAP_PADDING = 24

export interface EvidencePage {
  /** 0-기반 */
  readonly page: number
  readonly anchors: readonly Anchor[]
}

export interface EvidenceGroup {
  readonly docId: string
  /** 발췌 블록에 적힌 문서 제목. 서지 정보가 있으면 그쪽이 우선이다 */
  readonly title: string
  readonly pages: readonly EvidencePage[]
}

export interface EvidenceDocMeta {
  readonly title?: string
  readonly authors: readonly string[]
  readonly year?: number
  readonly doi?: string
}

export interface EvidenceModel {
  readonly title: string
  /** 사람이 읽는 날짜 문자열 */
  readonly exportedAt: string
  readonly nodes: readonly PersistedCanvasNode[]
  readonly edges: readonly PersistedCanvasEdge[]
  /** 발췌 블록 id → 잘라 낸 그림 */
  readonly crops: Readonly<Record<string, string | null>>
  /** `docId:page`(0-기반) → 강조를 그려 넣은 쪽 전체 그림. null 이면 불러오지 못한 쪽 */
  readonly pages: Readonly<Record<string, string | null>>
  readonly docs: Readonly<Record<string, EvidenceDocMeta>>
}

export const evidencePageKey = (docId: string, page: number) => `${docId}:${page}`
/** 문서 id 는 노트 파일에서 오므로 속성에 넣기 전에 id 에 쓸 수 있는 글자만 남긴다 */
const evidenceAnchorId = (docId: string, page: number) => `evidence-${docId.replace(/[^\w-]/gu, '_')}-p${page + 1}`

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** data URL 만 그림으로 넣는다. 그 밖의 주소(로컬 경로·원격)는 받는 사람 쪽에서 열리지 않는다 */
const isDataUrl = (value: unknown): value is string => typeof value === 'string' && value.startsWith('data:image/')

/**
 * 읽는 순서. 위에서 아래로 줄을 나누되, 세로로 겹치는 블록은 같은 줄로 보고 왼쪽부터 읽는다.
 * 도형과 화살표는 꾸밈이라 본문에서 뺀다.
 */
export function readingOrder(nodes: readonly PersistedCanvasNode[]): PersistedCanvasNode[] {
  const content = nodes
    .filter((node) => !SKIPPED_KINDS.has(node.data.block.kind))
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  const rows: PersistedCanvasNode[][] = []
  let rowBottom = Number.NEGATIVE_INFINITY
  for (const node of content) {
    const top = node.position.y
    const bottom = top + Math.max(node.data.block.height, 1)
    if (rows.length > 0 && top < rowBottom) {
      rows[rows.length - 1]!.push(node)
      rowBottom = Math.max(rowBottom, bottom)
    } else {
      rows.push([node])
      rowBottom = bottom
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.position.x - b.position.x))
}

/** 인용한 PDF 쪽을 문서별로 모은다. 문서는 처음 인용된 순서, 쪽은 오름차순이다 */
export function collectEvidence(ordered: readonly PersistedCanvasNode[]): EvidenceGroup[] {
  const groups = new Map<string, { title: string; pages: Map<number, Anchor[]> }>()
  for (const node of ordered) {
    const block = node.data.block
    if (block.kind !== 'pdfExcerpt') continue
    const anchor = block.source.anchor
    const group = groups.get(anchor.docId) ?? { title: block.excerpt.sourceTitle, pages: new Map<number, Anchor[]>() }
    group.pages.set(anchor.page, [...(group.pages.get(anchor.page) ?? []), anchor])
    groups.set(anchor.docId, group)
  }
  return [...groups.entries()].map(([docId, group]) => ({
    docId,
    title: group.title,
    pages: [...group.pages.entries()].sort((a, b) => a[0] - b[0]).map(([page, anchors]) => ({ page, anchors })),
  }))
}

function blockLabel(node: PersistedCanvasNode): string {
  const block = node.data.block
  switch (block.kind) {
    case 'title':
    case 'paragraph':
    case 'code':
    case 'translation':
      return block.text
    case 'pdfExcerpt':
      return block.excerpt.text
    case 'markdownExcerpt':
      return block.selection.quote
    default:
      return ''
  }
}

const WIDE = /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿＀-｠]/u

/** 첫 줄을 폭(px)에 맞춰 자른다. 글꼴을 잴 수 없어 한글·한자는 글자 크기만큼, 나머지는 그 절반 남짓으로 친다 */
const firstLine = (value: string, maxWidth: number, size: number) => {
  const line = value.split(/\r?\n/u).map((part) => part.trim()).find(Boolean) ?? ''
  const advance = (char: string) => (WIDE.test(char) ? size : size * 0.56)
  const chars = Array.from(line)
  if (chars.reduce((sum, char) => sum + advance(char), 0) <= maxWidth) return line
  let used = advance('…')
  let end = 0
  while (end < chars.length && used + advance(chars[end]!) <= maxWidth) used += advance(chars[end++]!)
  return `${chars.slice(0, end).join('').trimEnd()}…`
}

/** 캔버스 배치를 그대로 축소한 지도. 글 블록은 첫 줄, 발췌는 잘라 낸 그림, 연결선은 직선이다 */
export function canvasMapSvg(
  nodes: readonly PersistedCanvasNode[],
  edges: readonly PersistedCanvasEdge[],
  crops: Readonly<Record<string, string | null>>,
): string {
  if (nodes.length === 0) return ''
  const left = Math.min(...nodes.map((node) => node.position.x)) - MAP_PADDING
  const top = Math.min(...nodes.map((node) => node.position.y)) - MAP_PADDING
  const right = Math.max(...nodes.map((node) => node.position.x + node.data.block.width)) + MAP_PADDING
  const bottom = Math.max(...nodes.map((node) => node.position.y + node.data.block.height)) + MAP_PADDING
  const width = right - left
  const height = bottom - top
  const shown = Math.min(MAP_WIDTH, width)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const center = (node: PersistedCanvasNode) => [
    node.position.x + node.data.block.width / 2,
    node.position.y + node.data.block.height / 2,
  ] as const

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${shown}" height="${Math.round((height * shown) / width)}" role="img" aria-label="${escapeHtml(t('캔버스 지도'))}">`)
  parts.push('<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#64748b"/></marker></defs>')
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (source === undefined || target === undefined) continue
    const [x1, y1] = center(source)
    const [x2, y2] = center(target)
    const start = edge.startMarker === 'arrow' ? ' marker-start="url(#arrow)"' : ''
    const end = edge.endMarker === 'arrow' ? ' marker-end="url(#arrow)"' : ''
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="2"${start}${end}/>`)
  }
  for (const node of nodes) {
    const block = node.data.block
    const { x, y } = node.position
    const { width: w, height: h } = block
    if (block.kind === 'ellipse') {
      parts.push(`<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="#fff" stroke="#94a3b8" stroke-width="2"/>`)
      continue
    }
    if (block.kind === 'diamond') {
      parts.push(`<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" fill="#fff" stroke="#94a3b8" stroke-width="2"/>`)
      continue
    }
    if (block.kind === 'arrow') {
      parts.push(`<line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" stroke="#64748b" stroke-width="3" marker-end="url(#arrow)"/>`)
      continue
    }
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#fff" stroke="#cbd5e1" stroke-width="2"/>`)
    const crop = block.kind === 'pdfExcerpt' ? crops[node.id] : block.kind === 'image' ? block.src : null
    if (isDataUrl(crop)) {
      parts.push(`<image href="${escapeHtml(crop)}" x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" preserveAspectRatio="xMidYMid meet"/>`)
      continue
    }
    const size = block.kind === 'title' ? 22 : 15
    const label = firstLine(blockLabel(node), w - 20, size)
    if (label !== '') {
      parts.push(`<text x="${x + 10}" y="${y + Math.min(h - 8, size + 8)}" font-size="${size}" font-weight="${block.kind === 'title' ? 700 : 400}" fill="#1e293b">${escapeHtml(label)}</text>`)
    }
  }
  parts.push('</svg>')
  return parts.join('')
}

function renderBlock(node: PersistedCanvasNode, model: EvidenceModel): string {
  const block = node.data.block
  switch (block.kind) {
    case 'title':
      return `<h2>${escapeHtml(block.text)}</h2>`
    case 'paragraph':
      return `<p class="text">${escapeHtml(block.text)}</p>`
    case 'code':
      return `<pre>${escapeHtml(block.text)}</pre>`
    case 'pdfExcerpt': {
      const anchor = block.source.anchor
      const crop = model.crops[node.id]
      const title = model.docs[anchor.docId]?.title ?? block.excerpt.sourceTitle
      return `<figure class="excerpt">${isDataUrl(crop) ? `<img src="${escapeHtml(crop)}" alt="">` : ''}`
        + `<blockquote>${escapeHtml(block.excerpt.text || anchor.quote)}</blockquote>`
        + `<figcaption><a href="#${evidenceAnchorId(anchor.docId, anchor.page)}">${escapeHtml(title)} · p.${anchor.page + 1}</a></figcaption></figure>`
    }
    case 'markdownExcerpt':
      return `<figure class="excerpt"><blockquote>${escapeHtml(block.selection.quote)}</blockquote>`
        + `<figcaption>${escapeHtml(block.selection.title || block.selection.path)}</figcaption></figure>`
    case 'translation':
      return `<div class="translation"><p class="text">${escapeHtml(block.text)}</p>`
        + `<small>${escapeHtml(t('번역'))} · ${escapeHtml(block.targetLanguage)} · ${escapeHtml(block.model)}</small></div>`
    case 'image':
      return isDataUrl(block.src) ? `<figure class="image"><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}"></figure>` : ''
    default:
      return ''
  }
}

function bibliographyLine(meta: EvidenceDocMeta | undefined): string {
  if (meta === undefined) return ''
  const parts = [
    meta.authors.join(', '),
    meta.year === undefined ? '' : String(meta.year),
    meta.doi === undefined ? '' : `doi:${meta.doi}`,
  ].filter(Boolean)
  return parts.length === 0 ? '' : `<p class="bib">${escapeHtml(parts.join(' · '))}</p>`
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f8fafc; color: #1e293b; font: 15px/1.65 "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; background: #fff; }
header h1 { margin: 0 0 4px; font-size: 28px; line-height: 1.3; }
header p { margin: 0; color: #64748b; font-size: 13px; }
section { margin-top: 40px; }
section > h2.section { margin: 0 0 16px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 14px; letter-spacing: 0; }
.map { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; padding: 8px; }
.map svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
h2 { font-size: 21px; margin: 28px 0 8px; }
.text { white-space: pre-wrap; margin: 0 0 14px; }
pre { white-space: pre-wrap; background: #f1f5f9; padding: 12px; border-radius: 6px; font-size: 13px; }
figure { margin: 18px 0; }
.excerpt img { display: block; max-width: 100%; border: 1px solid #e2e8f0; border-radius: 4px; }
blockquote { margin: 8px 0 4px; padding: 2px 0 2px 12px; border-left: 3px solid #f2c94c; color: #334155; white-space: pre-wrap; }
figcaption, .translation small { color: #64748b; font-size: 12px; }
figcaption a { color: #2563eb; text-decoration: none; }
.translation { margin: 14px 0; padding: 10px 12px; background: #f1f5f9; border-radius: 6px; }
.image img { max-width: 100%; }
.evidence-doc { margin-top: 28px; }
.evidence-doc h3 { margin: 0; font-size: 18px; }
.bib { margin: 2px 0 12px; color: #64748b; font-size: 13px; }
.evidence-page { margin: 16px 0 28px; }
.evidence-page h4 { margin: 0 0 6px; font-size: 13px; color: #475569; }
.evidence-page img { display: block; width: 100%; border: 1px solid #e2e8f0; }
.evidence-page ul { margin: 8px 0 0; padding-left: 18px; color: #334155; font-size: 13px; }
.missing { padding: 24px; border: 1px dashed #cbd5e1; color: #64748b; text-align: center; }
footer { margin-top: 48px; color: #94a3b8; font-size: 12px; text-align: center; }
@media print {
  body { background: #fff; }
  main { padding: 0; max-width: none; }
  .evidence-doc { break-before: page; }
  .evidence-page { break-inside: avoid; }
  a { color: inherit; }
}
`

/** 한 파일짜리 HTML. 스크립트는 넣지 않는다 — 받는 사람이 안심하고 열 수 있어야 한다 */
export function renderEvidenceHtml(model: EvidenceModel): string {
  const ordered = readingOrder(model.nodes)
  const groups = collectEvidence(ordered)
  const map = canvasMapSvg(model.nodes, model.edges, model.crops)
  const body = ordered.map((node) => renderBlock(node, model)).filter(Boolean).join('\n')
  const evidence = groups.map((group) => {
    const meta = model.docs[group.docId]
    const pages = group.pages.map(({ page, anchors }) => {
      const image = model.pages[evidencePageKey(group.docId, page)]
      const quotes = [...new Set(anchors.map((anchor) => anchor.quote.trim()).filter(Boolean))]
      return `<article class="evidence-page" id="${evidenceAnchorId(group.docId, page)}"><h4>p.${page + 1}</h4>`
        + (isDataUrl(image) ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(group.title)} ${escapeHtml(t('{page}쪽', { page: page + 1 }))}">` : `<p class="missing">${escapeHtml(t('원본 쪽을 불러오지 못했습니다'))}</p>`)
        + (quotes.length > 0 ? `<ul>${quotes.map((quote) => `<li>${escapeHtml(quote)}</li>`).join('')}</ul>` : '')
        + '</article>'
    }).join('\n')
    return `<section class="evidence-doc"><h3>${escapeHtml(meta?.title ?? group.title)}</h3>${bibliographyLine(meta)}${pages}</section>`
  }).join('\n')

  return `<!doctype html>
<html lang="${getLocale()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="IWAE">
<title>${escapeHtml(model.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header><h1>${escapeHtml(model.title)}</h1><p>${escapeHtml(model.exportedAt)} · ${escapeHtml(t('IWAE에서 내보냄'))}</p></header>
${map === '' ? '' : `<section><h2 class="section">${escapeHtml(t('캔버스'))}</h2><div class="map">${map}</div></section>`}
<section><h2 class="section">${escapeHtml(t('노트'))}</h2>
${body}
</section>
${groups.length === 0 ? '' : `<section><h2 class="section">${escapeHtml(t('근거'))}</h2>\n${evidence}\n</section>`}
<footer>${escapeHtml(t('근거 그림은 원문 쪽을 그대로 옮긴 것이고, 노란 표시가 인용한 부분입니다.'))}</footer>
</main>
</body>
</html>
`
}
