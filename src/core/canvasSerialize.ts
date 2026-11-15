import type { CanvasDocumentV2 } from './canvasDocument'

export function emptyCanvasDoc(): CanvasDocumentV2 {
  return {
    version: 2,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function idOf(value: unknown): string {
  return isRecord(value) && typeof value.id === 'string' ? value.id : ''
}

function sortedValue(value: unknown, parentKey: string | null = null): unknown {
  if (Array.isArray(value)) {
    // nodes 의 배열 순서가 쌓임 순서(z)라 정렬하지 않는다. edges 는 순서에 뜻이 없어 id 로 정렬한다
    const items = parentKey === 'edges'
      ? [...value].sort((left, right) => idOf(left).localeCompare(idOf(right)))
      : value
    return items.map((item) => sortedValue(item))
  }
  if (!isRecord(value)) return value

  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortedValue(value[key], key)
  }
  return sorted
}

export function serializeCanvasDoc(doc: unknown): string {
  return `${JSON.stringify(sortedValue(doc), null, 2)}\n`
}
