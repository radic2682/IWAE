import type { PageTextIndex } from './textIndex'

type PageTextLoader = (page: number) => Promise<PageTextIndex>
type PageOcrLoader = (page: number) => Promise<string>

export interface ExtractedPdfPage {
  readonly page: number
  readonly text: string
}

export async function extractPdfDocumentPages(
  pageCount: number,
  loadPage: PageTextLoader,
  concurrency = 4,
  loadOcrPage?: PageOcrLoader,
  onPage?: (page: ExtractedPdfPage) => void,
): Promise<ExtractedPdfPage[]> {
  const total = Math.max(0, Math.trunc(pageCount))
  const workerCount = Math.min(total, Math.max(1, Math.trunc(concurrency)))
  const pages = Array.from<string>({ length: total }).fill('')
  let nextPage = 0

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextPage < total) {
      const page = nextPage
      nextPage += 1
      try {
        const embeddedText = (await loadPage(page)).text.trim()
        pages[page] = embeddedText === '' && loadOcrPage !== undefined
          ? (await loadOcrPage(page)).trim()
          : embeddedText
      } catch {
        pages[page] = ''
      }
      onPage?.({ page, text: pages[page] ?? '' })
    }
  }))

  return pages.map((text, page) => ({ page, text }))
}

export async function extractPdfDocumentText(
  pageCount: number,
  loadPage: PageTextLoader,
  concurrency = 4,
  loadOcrPage?: PageOcrLoader,
): Promise<string> {
  const pages = await extractPdfDocumentPages(pageCount, loadPage, concurrency, loadOcrPage)
  return pages.map(({ text }) => text).filter((text) => text !== '').join('\n\n')
}
