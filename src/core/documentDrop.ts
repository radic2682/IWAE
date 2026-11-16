import { isOpenableDocumentPath } from './documentFormat'

// .ppt·.pptx 는 그대로 넣지 않고, 물어본 뒤 PDF 로 바꿔 넣는다(App)
const CONVERTIBLE_EXTENSIONS = ['.ppt', '.pptx'] as const

function isSupportedDocumentPath(path: string) {
  const normalized = path.toLocaleLowerCase()
  return isOpenableDocumentPath(path) || CONVERTIBLE_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

export function partitionDroppedDocumentPaths(paths: readonly string[]) {
  const accepted: string[] = []
  const rejected: string[] = []
  const seen = new Set<string>()

  for (const path of paths) {
    const normalized = path.toLocaleLowerCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)

    if (!path.trim() || /[\\/]$/.test(path) || !isSupportedDocumentPath(path)) {
      rejected.push(path)
      continue
    }

    accepted.push(path)
  }

  return { accepted, rejected }
}
