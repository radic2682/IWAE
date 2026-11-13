import { useEffect, useRef } from 'react'
import type { VaultHandle } from '../../bridge/vault'
import { pageTextIndex, type PdfDocMeta } from '../../bridge/pdf'
import { isDesktop } from '../../bridge/window'
import { parseCanvasDocument, type CanvasDocumentV2 } from '../../core/canvasDocument'
import {
  addCanvasBlocks,
  arrangeCanvasBlocks,
  connectCanvasBlocks,
  deleteCanvasBlocks,
  findTextRegion,
  resolveCanvasTarget,
  summarizeCanvas,
  tidyCanvasOverlaps,
  updateCanvasBlocks,
  type CanvasBlockInput,
  type CanvasEdgeInput,
  type CanvasUpdateInput,
  type ResolvedCanvasBlockInput,
} from '../../core/canvasOps'
import { createInitialCanvasDocument } from '../../core/initialCanvasDocument'
import { createRegionExcerptSelection } from '../../core/pdfExcerpt'
import type { VaultTreeNode } from '../../core/vaultTree'
import { flushCanvasSaves, type CanvasStorage } from './useCanvasAutosave'
import { liveCanvas } from './liveCanvasRegistry'

interface WebviewRequest {
  readonly requestId: number
  readonly op: string
  readonly args: Record<string, unknown>
}

export interface McpCanvasBridgeDeps {
  readonly vault: VaultHandle | null
  /** 왼쪽 트리(노트 이름은 사용자가 보는 표시 이름이다) */
  readonly tree: readonly VaultTreeNode[]
  readonly storage: CanvasStorage
  readonly loadPdfById: (docId: string) => Promise<{ meta: PdfDocMeta; title: string }>
}

interface CanvasTarget {
  readonly path: string
  readonly title: string
  readonly folder: string
}

const IMAGE_TYPES: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

function canvases(tree: readonly VaultTreeNode[], folder = ''): CanvasTarget[] {
  return tree.flatMap((node): CanvasTarget[] => {
    if (node.kind === 'note') return [{ path: node.path, title: node.name, folder }]
    if (node.kind === 'folder') return canvases(node.children, node.path)
    return []
  })
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

async function loadImage(vault: VaultHandle, path: string): Promise<{ src: string; width: number; height: number }> {
  const extension = path.split('..').pop()?.toLowerCase() ?? ''
  const type = IMAGE_TYPES[extension]
  if (type === undefined) throw new Error(`그림은 png·jpg·webp·gif만 넣을 수 있습니다: ${path}`)
  const { readFile } = await import('@tauri-apps/plugin-fs')
  const { isAbsolute, join } = await import('@tauri-apps/api/path')
  const absolute = await isAbsolute(path) ? path : await join(vault.root, ...path.replaceAll('\\', '/').split('/'))
  const bytes = await readFile(absolute)
  if (bytes.byteLength > 12 * 1024 * 1024) throw new Error('그림이 너무 큽니다(12MB까지).')
  const bitmap = await createImageBitmap(new Blob([bytes], { type }))
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return { src: `data:${type};base64,${base64(bytes)}`, ...size }
}

/** 발췌·그림 블록을 파일에서 풀어 둔다 */
async function resolveBlocks(blocks: readonly CanvasBlockInput[], deps: McpCanvasBridgeDeps, vault: VaultHandle): Promise<ResolvedCanvasBlockInput[]> {
  const resolved: ResolvedCanvasBlockInput[] = []
  for (const [position, block] of blocks.entries()) {
    try {
      if (block.type === 'pdf_excerpt') {
        if (typeof block.doc_id !== 'string' || typeof block.page !== 'number') throw new Error('doc_id와 page(1부터)가 필요합니다.')
        const { meta, title } = await deps.loadPdfById(block.doc_id)
        const page = Math.floor(block.page) - 1
        if (page < 0 || page >= meta.pageCount) throw new Error(`쪽 번호가 범위를 벗어났습니다(1–${meta.pageCount}).`)
        const pageSize = meta.pageSizes[page]
        if (pageSize === undefined) throw new Error('쪽 크기를 알 수 없습니다.')
        const index = await pageTextIndex(meta.docId, page)
        const rect = block.rect ?? (typeof block.from_text === 'string'
          ? findTextRegion(index, block.from_text, block.to_text, { padding: block.padding, fullWidth: block.full_width, pageSize })
          : undefined)
        if (rect === undefined) throw new Error('rect 또는 from_text가 필요합니다.')
        const selection = createRegionExcerptSelection({ docId: meta.docId, page, rect, index, pageSize })
        resolved.push({ ...block, excerpt: { selection, sourceTitle: title } })
      } else if (block.type === 'image') {
        if (typeof block.path !== 'string') throw new Error('path가 필요합니다.')
        resolved.push({ ...block, image: await loadImage(vault, block.path) })
      } else {
        resolved.push(block)
      }
    } catch (cause) {
      throw new Error(`blocks[${position}]: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  return resolved
}

const RENDER_SETTLE_MS = 900

/**
 * 글 블록은 화면에 그려져야 실제 높이가 정해진다. 열린 캔버스면 그려질 때까지 기다렸다가 최신 문서로,
 * 닫힌 캔버스면 어림한 높이로, 새로 넣은 블록이 다른 블록과 겹치지 않게 아래로 민다.
 */
async function tidyAfterRender(
  path: string,
  ids: readonly string[],
  written: CanvasDocumentV2,
  deps: McpCanvasBridgeDeps,
): Promise<{ id: string; x: number; y: number }[]> {
  if (ids.length === 0) return []
  const open = liveCanvas(path)
  if (open !== undefined) {
    await new Promise((resolve) => window.setTimeout(resolve, RENDER_SETTLE_MS))
    const latest = liveCanvas(path)
    if (latest === undefined) return []
    const { document, moved } = tidyCanvasOverlaps(latest.get(), { ids })
    if (moved.length > 0) latest.replace(document)
    return moved
  }
  const { document, moved } = tidyCanvasOverlaps(written, { ids })
  if (moved.length > 0) await deps.storage.save(path, document)
  return moved
}

async function handle(op: string, args: Record<string, unknown>, deps: McpCanvasBridgeDeps): Promise<unknown> {
  const vault = deps.vault
  if (vault === null) throw new Error('IWAE에 열린 Vault가 없습니다.')
  const list = canvases(deps.tree)
  if (op === 'canvas_list') {
    return list.map((canvas) => {
      const open = liveCanvas(canvas.path)
      return { canvas: canvas.path, title: canvas.title, folder: canvas.folder, open: open !== undefined, ...(open === undefined ? {} : { blocks: open.get().nodes.length }) }
    })
  }
  if (typeof args.canvas !== 'string') throw new Error('canvas가 필요합니다(canvas_list의 canvas 값).')
  const target = resolveCanvasTarget(list, args.canvas)
  const open = liveCanvas(target.path)
  let current: CanvasDocumentV2
  if (open !== undefined) {
    current = open.get()
  } else {
    await flushCanvasSaves(target.path)
    current = parseCanvasDocument(await deps.storage.load(target.path) ?? createInitialCanvasDocument(target.title))
  }
  const commit = async (next: CanvasDocumentV2) => {
    if (open !== undefined) open.replace(next)
    else await deps.storage.save(target.path, next)
  }
  const header = { canvas: target.path, title: target.title, open: open !== undefined }

  switch (op) {
    case 'canvas_read':
      return { ...header, ...summarizeCanvas(current) }
    case 'canvas_add_blocks': {
      if (!Array.isArray(args.blocks)) throw new Error('blocks 배열이 필요합니다.')
      const blocks = await resolveBlocks(args.blocks as CanvasBlockInput[], deps, vault)
      const origin = args.origin as { x: number; y: number } | undefined
      const result = addCanvasBlocks(current, blocks, (args.edges as CanvasEdgeInput[] | undefined) ?? [], { origin, gap: args.gap as number | undefined })
      await commit(result.document)
      const ids = result.created.map(({ id }) => id)
      const tidied = args.tidy === false ? [] : await tidyAfterRender(target.path, ids, result.document, deps)
      const moved = new Map(tidied.map((item) => [item.id, item]))
      return {
        ...header,
        created: result.created.map((item) => ({ ...item, ...(moved.has(item.id) ? { x: moved.get(item.id)!.x, y: moved.get(item.id)!.y } : {}) })),
        edges: result.edges,
        ...(tidied.length > 0 ? { note: `${tidied.length} block(s) were moved down to avoid overlaps after their real heights were measured.` } : {}),
      }
    }
    case 'canvas_update_blocks': {
      if (!Array.isArray(args.updates)) throw new Error('updates 배열이 필요합니다.')
      const result = updateCanvasBlocks(current, args.updates as CanvasUpdateInput[])
      await commit(result.document)
      return { ...header, updated: result.updated }
    }
    case 'canvas_arrange': {
      const layout = args.layout
      if (layout !== 'grid' && layout !== 'column' && layout !== 'row' && layout !== 'stack') throw new Error('layout 값은 grid, column, row, stack 중 하나입니다.')
      const result = arrangeCanvasBlocks(current, {
        layout,
        ids: args.ids as string[] | undefined,
        columns: args.columns as number | undefined,
        gap: args.gap as number | undefined,
        x: args.x as number | undefined,
        y: args.y as number | undefined,
      })
      await commit(result.document)
      return { ...header, arranged: result.arranged }
    }
    case 'canvas_connect': {
      if (!Array.isArray(args.edges)) throw new Error('edges 배열이 필요합니다.')
      const result = connectCanvasBlocks(current, args.edges as CanvasEdgeInput[])
      await commit(result.document)
      return { ...header, edges: result.edges }
    }
    case 'canvas_delete_blocks': {
      if (!Array.isArray(args.ids)) throw new Error('ids 배열이 필요합니다.')
      const result = deleteCanvasBlocks(current, args.ids as string[])
      await commit(result.document)
      return { ...header, deleted: result.deleted }
    }
    default:
      throw new Error(`모르는 요청입니다: ${op}`)
  }
}

/** MCP canvas_* 도구의 요청을 받아 캔버스를 읽고 고친다. 데스크톱 앱에서만 돈다 */
export function useMcpCanvasBridge(deps: McpCanvasBridgeDeps & { readonly enabled?: boolean }): void {
  const depsRef = useRef(deps)
  depsRef.current = deps
  const enabled = deps.enabled !== false

  useEffect(() => {
    if (!isDesktop() || !enabled) return
    let alive = true
    let unlisten: (() => void) | null = null
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const { invoke } = await import('@tauri-apps/api/core')
      const stop = await listen<WebviewRequest>('mcp-webview-request', (event) => {
        const { requestId, op, args } = event.payload
        if (!op.startsWith('canvas_')) return
        void handle(op, args ?? {}, depsRef.current)
          .then((result) => invoke('mcp_webview_reply', { requestId, ok: true, result, error: null }))
          .catch((cause: unknown) => invoke('mcp_webview_reply', {
            requestId,
            ok: false,
            result: null,
            error: cause instanceof Error ? cause.message : String(cause),
          }))
      })
      if (alive) unlisten = stop
      else stop()
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [enabled])
}
