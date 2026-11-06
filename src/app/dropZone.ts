import type { DropPoint } from '../bridge/fileDrop'

/** 왼쪽 트리에서 놓을 자리: 어느 줄의 앞·뒤, 또는 폴더 안 */
export interface TreeDropPlace {
  /** 기준 줄의 트리 id(예: `pdf:<docId>`, `folder:<path>`) */
  readonly nodeId: string
  readonly position: 'before' | 'after' | 'inside'
}

/**
 * 탐색기에서 끌어 온 파일을 놓은 자리:
 * - 'reader': PDF(문서) 자리 → 가져오지 않고 열기만
 * - 'vault': 왼쪽 바 → Vault 로 복사해 가져오기. folderPath 는 들어갈 폴더(null = Vault 맨 위),
 *   place 는 트리에서 놓은 줄(그 줄 앞·뒤, 또는 폴더 안). place 가 없으면 폴더 끝에 붙는다
 */
export type DropZone =
  | { readonly kind: 'reader' }
  | {
    readonly kind: 'vault'
    readonly folderPath: string | null
    readonly place?: TreeDropPlace
    /** PDF 줄 가운데에 놓았다: 가져온 뒤 그 문서 위에 판으로 겹친다 */
    readonly stackOnDocId?: string
  }

export function dropZoneAt(point: DropPoint | undefined, root: Document = document): DropZone {
  const element = point === undefined ? null : root.elementFromPoint(point.x, point.y)
  if (element === null) return { kind: 'vault', folderPath: null }
  if (element.closest('.sidebar, .sidebar-inner') !== null) {
    // 펼친 라이브러리: 폴더 줄, 또는 폴더를 보고 있는 표
    const library = element.closest<HTMLElement>('[data-library-folder], [data-drop-folder]')
    if (library !== null) return { kind: 'vault', folderPath: library.dataset.libraryFolder ?? library.dataset.dropFolder ?? '' }
    const node = element.closest<HTMLElement>('[data-internal-drop="tree-node"]')
    if (node === null || node.dataset.section === 'notes') return { kind: 'vault', folderPath: null }
    const nodeId = node.dataset.nodeId ?? ''
    const parentPath = node.dataset.parentPath ?? ''
    const isFolder = node.dataset.kind === 'folder'
    // 줄 높이에서 어디쯤인가: 폴더는 가운데 절반이면 그 안, 위·아래 끝이면 그 줄 앞·뒤(안쪽 트리 끌기와 같은 셈)
    const row = node.querySelector(':scope > .side-tree-row') ?? node
    const bounds = row.getBoundingClientRect()
    const ratio = point === undefined || bounds.height <= 0 ? 0.5 : (point.y - bounds.top) / bounds.height
    if (isFolder && ratio > 0.25 && ratio < 0.75) {
      return { kind: 'vault', folderPath: node.dataset.path ?? '', ...(nodeId === '' ? {} : { place: { nodeId, position: 'inside' } }) }
    }
    // PDF 줄 가운데: 그 문서의 새 판으로 겹치기(안쪽 트리 끌기와 같은 규칙)
    if (node.dataset.kind === 'pdf' && nodeId.startsWith('pdf:') && ratio > 0.3 && ratio < 0.7) {
      return { kind: 'vault', folderPath: parentPath, place: { nodeId, position: 'inside' }, stackOnDocId: nodeId.slice('pdf:'.length) }
    }
    if (nodeId === '') return { kind: 'vault', folderPath: isFolder ? node.dataset.path ?? '' : parentPath }
    return { kind: 'vault', folderPath: parentPath, place: { nodeId, position: ratio < 0.5 ? 'before' : 'after' } }
  }
  if (element.closest('.pane, .panes') !== null) return { kind: 'reader' }
  return { kind: 'vault', folderPath: null }
}
