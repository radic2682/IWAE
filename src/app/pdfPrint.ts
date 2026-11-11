import { pageImageUrl } from '../bridge/pdf'
import { inkPath, type PdfLine, type PdfOverlay, type PdfTextBox } from '../core/pdfOverlays'
import { addTransientSheet } from './runtimeStyle'

/** 인쇄용 쪽 그림 폭(px). A4·Letter 를 약 200dpi 로 */
const PRINT_WIDTH = 1700

export type PrintOrientation = 'auto' | 'portrait' | 'landscape'
export type PrintPaper = 'A4' | 'Letter' | 'A3'

/** 용지 크기(mm, 세로 기준 폭 × 높이) */
export const PAPER_SIZES_MM: Readonly<Record<PrintPaper, readonly [number, number]>> = {
  A4: [210, 297],
  Letter: [215.9, 279.4],
  A3: [297, 420],
}

export interface PrintOptions {
  /** 위·아래·왼쪽·오른쪽 모두 같은 여백(mm) */
  readonly marginMm: number
  /** auto = 첫 쪽 모양(가로가 길면 가로)을 따른다 */
  readonly orientation: PrintOrientation
  /** 용지. 여백을 네 방향 똑같이 맞추려면 앱이 용지 크기를 알아야 한다 */
  readonly paper: PrintPaper
}

export const DEFAULT_PRINT_OPTIONS: PrintOptions = { marginMm: 10, orientation: 'auto', paper: 'A4' }
const PRINT_OPTIONS_KEY = 'iwae:print-options:v1'

export function readPrintOptions(): PrintOptions {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PRINT_OPTIONS_KEY) ?? 'null')
    if (raw === null || typeof raw !== 'object') return DEFAULT_PRINT_OPTIONS
    const value = raw as Partial<PrintOptions>
    return {
      marginMm: typeof value.marginMm === 'number' && value.marginMm >= 0 && value.marginMm <= 40 ? value.marginMm : DEFAULT_PRINT_OPTIONS.marginMm,
      orientation: value.orientation === 'portrait' || value.orientation === 'landscape' ? value.orientation : 'auto',
      paper: value.paper === 'Letter' || value.paper === 'A3' ? value.paper : 'A4',
    }
  } catch {
    return DEFAULT_PRINT_OPTIONS
  }
}

export function writePrintOptions(options: PrintOptions): void {
  try { window.localStorage.setItem(PRINT_OPTIONS_KEY, JSON.stringify(options)) } catch { /* 이번 실행에만 */ }
}

/** 실제로 쓸 용지 방향. auto 면 쪽 크기(폭, 높이)로 정한다 */
export function resolveOrientation(orientation: PrintOrientation, pageSize: readonly [number, number] | undefined): 'portrait' | 'landscape' {
  if (orientation !== 'auto') return orientation
  return pageSize !== undefined && pageSize[0] > pageSize[1] ? 'landscape' : 'portrait'
}

/** 용지(방향 반영)의 폭·높이 mm */
export function paperSizeMm(paper: PrintPaper, orientation: 'portrait' | 'landscape'): readonly [number, number] {
  const [short, long] = PAPER_SIZES_MM[paper]
  return orientation === 'landscape' ? [long, short] : [short, long]
}

/**
 * 고른 쪽을 그림으로 그려 시스템 인쇄 창을 띄운다. 쪽마다 용지 한 장을 채우고(여백 안 가운데, 비율 유지),
 * 여백은 네 방향 모두 같다. 쪽 그림을 다 받기 전에는 인쇄 창을 열지 않는다(빈 쪽이 찍히지 않게).
 */
export async function printPdfPages(
  docId: string,
  pages: readonly number[],
  title: string,
  options: PrintOptions = DEFAULT_PRINT_OPTIONS,
  pageSize?: readonly [number, number],
  /** 쪽마다 크기와 PDF 위 편집(글 상자·선). 주면 편집한 쪽에는 그 내용도 함께 찍는다 */
  extras?: { readonly pageSizes: readonly (readonly [number, number])[]; readonly overlays: readonly PdfOverlay[] },
): Promise<void> {
  const root = document.createElement('div')
  root.className = 'iwae-print-root'
  root.setAttribute('aria-hidden', 'true')
  // 인쇄 칸 크기(mm)는 아래 @page 계산과 같은 값이다 — 편집 내용을 쪽 비율대로 얹으려면 그림이 차지하는 크기를 알아야 한다
  const printOrientation = resolveOrientation(options.orientation, pageSize)
  const [printPaperWidth, printPaperHeight] = paperSizeMm(options.paper, printOrientation)
  const printMargin = Math.min(options.marginMm, Math.min(printPaperWidth, printPaperHeight) / 2 - 10)
  const sheetWidthMm = printPaperWidth - printMargin * 2
  const sheetHeightMm = printPaperHeight - printMargin * 2 - 0.5
  const images = pages.map((page) => {
    const sheet = document.createElement('div')
    sheet.className = 'iwae-print-sheet'
    const image = document.createElement('img')
    image.alt = ''
    image.src = pageImageUrl(docId, page, PRINT_WIDTH)
    const onPage = extras?.overlays.filter((item) => item.page === page) ?? []
    const size = extras?.pageSizes[page]
    if (onPage.length > 0 && size !== undefined && size[0] > 0 && size[1] > 0) {
      sheet.appendChild(printedPageWithOverlays(image, onPage, size, sheetWidthMm, sheetHeightMm))
    } else {
      sheet.appendChild(image)
    }
    root.appendChild(sheet)
    return image
  })
  // 용지 방향·여백. @page 는 인쇄 동안만 넣는다
  // 쪽 칸 크기를 용지 크기 - 여백×2 로 정확히 준다(인쇄에서 vh 는 용지를 따르지 않아 위아래 여백이 어긋났다).
  // 0.5mm 덜어 반올림으로 빈 장이 끼지 않게 한다
  const orientation = resolveOrientation(options.orientation, pageSize)
  const [paperWidth, paperHeight] = paperSizeMm(options.paper, orientation)
  const margin = Math.min(options.marginMm, Math.min(paperWidth, paperHeight) / 2 - 10)
  const removeStyle = addTransientSheet([
    `@page { size: ${paperWidth}mm ${paperHeight}mm; margin: ${margin}mm; }`,
    `@media print { .iwae-print-sheet { width: ${paperWidth - margin * 2}mm; height: ${paperHeight - margin * 2 - 0.5}mm; } }`,
  ].join(' '))
  document.body.appendChild(root)
  await Promise.all(images.map((image) => image.decode().catch(() => undefined)))
  const previousTitle = document.title
  document.title = title
  document.documentElement.classList.add('iwae-printing')
  document.body.classList.add('iwae-printing')
  const cleanup = () => {
    document.documentElement.classList.remove('iwae-printing')
    document.body.classList.remove('iwae-printing')
    document.title = previousTitle
    root.remove()
    removeStyle()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
  // afterprint 를 주지 않는 환경도 있어 잠시 뒤 한 번 더 치운다
  window.setTimeout(() => { if (root.isConnected) cleanup() }, 60_000)
}

/**
 * 인쇄할 쪽 그림 위에 글 상자·선을 얹은 묶음. 그림이 인쇄 칸 안에서 차지하는 크기(mm)를 계산해 그 크기의 상자 안에
 * 쪽 좌표(points)를 비율로 놓는다(글자 크기·선 굵기도 같은 비율로 줄이거나 늘린다).
 */
export function printedPageWithOverlays(
  image: HTMLImageElement,
  overlays: readonly PdfOverlay[],
  pageSize: readonly [number, number],
  sheetWidthMm: number,
  sheetHeightMm: number,
): HTMLElement {
  const [pageW, pageH] = pageSize
  const fitWidth = Math.min(sheetWidthMm, sheetHeightMm * (pageW / pageH))
  const fitHeight = fitWidth * (pageH / pageW)
  const mmPerPoint = fitWidth / pageW
  const wrap = document.createElement('div')
  wrap.className = 'iwae-print-page'
  wrap.style.width = `${fitWidth}mm`
  wrap.style.height = `${fitHeight}mm`
  image.className = 'iwae-print-page-image'
  wrap.appendChild(image)

  const svgNs = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNs, 'svg')
  svg.setAttribute('viewBox', `0 0 ${pageW} ${pageH}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('class', 'iwae-print-lines')
  for (const item of overlays) {
    if (item.kind === 'line') appendPrintedLine(svg, svgNs, item)
    if (item.kind === 'ink') {
      const path = document.createElementNS(svgNs, 'path')
      path.setAttribute('d', inkPath(item.points))
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', item.color)
      path.setAttribute('stroke-width', String(item.width))
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      svg.appendChild(path)
    }
  }
  wrap.appendChild(svg)

  for (const item of overlays) {
    if (item.kind === 'text') wrap.appendChild(printedText(item, pageW, pageH, mmPerPoint))
  }
  return wrap
}

function appendPrintedLine(svg: Element, ns: string, line: PdfLine) {
  const stroke = (element: Element) => {
    element.setAttribute('stroke', line.color)
    element.setAttribute('stroke-width', String(line.width))
    element.setAttribute('stroke-linecap', 'round')
    element.setAttribute('fill', 'none')
  }
  const body = document.createElementNS(ns, 'line')
  body.setAttribute('x1', String(line.x1))
  body.setAttribute('y1', String(line.y1))
  body.setAttribute('x2', String(line.x2))
  body.setAttribute('y2', String(line.y2))
  stroke(body)
  if (line.dashed === true) body.setAttribute('stroke-dasharray', `${line.width * 3} ${line.width * 2}`)
  svg.appendChild(body)
  if (line.arrow === true) {
    const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1)
    const size = Math.max(6, line.width * 4)
    const spread = Math.PI / 7
    const head = document.createElementNS(ns, 'polyline')
    head.setAttribute('points', [
      `${line.x2 - Math.cos(angle - spread) * size},${line.y2 - Math.sin(angle - spread) * size}`,
      `${line.x2},${line.y2}`,
      `${line.x2 - Math.cos(angle + spread) * size},${line.y2 - Math.sin(angle + spread) * size}`,
    ].join(' '))
    stroke(head)
    head.setAttribute('stroke-linejoin', 'round')
    svg.appendChild(head)
  }
}

function printedText(box: PdfTextBox, pageW: number, pageH: number, mmPerPoint: number): HTMLElement {
  const element = document.createElement('div')
  element.className = `iwae-print-text${box.border === true ? ' iwae-print-text-border' : ''}`
  element.textContent = box.text
  element.style.left = `${(box.x / pageW) * 100}%`
  element.style.top = `${(box.y / pageH) * 100}%`
  element.style.width = `${(box.w / pageW) * 100}%`
  element.style.fontSize = `${box.size * mmPerPoint}mm`
  element.style.color = box.color
  element.style.fontFamily = "'Segoe UI Variable Text', 'Segoe UI', 'Malgun Gothic', system-ui, sans-serif"
  element.style.fontWeight = box.bold === true ? '700' : '400'
  if (box.fill !== undefined) element.style.background = box.fill === 'white' ? '#ffffff' : '#fff3a8'
  return element
}

/**
 * Markdown 인쇄: 보이는 본문(형광펜 포함)을 그대로 종이에 흘려 찍는다. 여백·용지는 PDF 인쇄 설정을 따른다.
 */
export function printMarkdown(title: string, html: string, options: PrintOptions = readPrintOptions()): void {
  const root = document.createElement('div')
  root.className = 'iwae-print-root iwae-print-markdown'
  root.setAttribute('aria-hidden', 'true')
  const article = document.createElement('article')
  article.className = 'markdown-pane markdown-print-body'
  article.innerHTML = html
  root.appendChild(article)
  const orientation = options.orientation === 'landscape' ? 'landscape' : 'portrait'
  const [paperWidth, paperHeight] = paperSizeMm(options.paper, orientation)
  const removeStyle = addTransientSheet([
    `@page { size: ${paperWidth}mm ${paperHeight}mm; margin: ${options.marginMm}mm; }`,
    '@media print { .iwae-print-markdown .markdown-print-body { display: block; height: auto; overflow: visible; padding: 0; color: #111; background: #fff; font-size: 10.5pt; } .iwae-print-markdown .markdown-print-body > * { max-width: none; zoom: 1; } }',
  ].join(' '))
  document.body.appendChild(root)
  const previousTitle = document.title
  document.title = title
  document.documentElement.classList.add('iwae-printing')
  document.body.classList.add('iwae-printing')
  const cleanup = () => {
    document.documentElement.classList.remove('iwae-printing')
    document.body.classList.remove('iwae-printing')
    document.title = previousTitle
    root.remove()
    removeStyle()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  window.print()
  window.setTimeout(() => { if (root.isConnected) cleanup() }, 60_000)
}

