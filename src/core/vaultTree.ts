import { MEMO_NOTES_FOLDER_KO, MEMO_NOTE_EXTENSION, memoNotesFolder, pickMemoNotesFolder } from './memoNote'
import { isMarkdownPath } from './markdownPath'
import type { VaultIndexEntry, VaultStorageKind } from './vaultIndex'

export interface LibraryDoc {
  docId: string
  title: string
  pages: number
  folderPath?: string
}

export interface NotebookNote {
  path: string
  title: string
}

export interface NotebookGroup {
  name: string
  notes: NotebookNote[]
}

export interface VaultTreeEntry {
  path: string
  isDirectory: boolean
}

export interface VaultFolderNode {
  id: string
  kind: 'folder'
  name: string
  path: string
  children: VaultTreeNode[]
}

export interface VaultPdfNode {
  id: string
  kind: 'pdf'
  name: string
  folderPath: string
  doc: LibraryDoc
}

export interface VaultNoteNode {
  id: string
  kind: 'note'
  name: string
  path: string
}

export interface VaultMarkdownNode {
  id: string
  kind: 'markdown'
  name: string
  path: string
  storage: VaultStorageKind
  indexId: string
}

export type VaultTreeNode = VaultFolderNode | VaultPdfNode | VaultNoteNode | VaultMarkdownNode

/**
 * 왼쪽 트리에서 항목을 아무 자리에나 놓는 요청. 부모가 바뀌면 실제 파일·폴더를 옮기고,
 * 그다음 그 부모 안의 놓은 자리(대상의 앞·뒤, 또는 폴더 안 맨 끝)에 순서를 둔다.
 */
export interface VaultTreePlaceRequest {
  nodeId: string
  fromParent: string
  /** 놓을 부모 폴더('' = Vault 맨 위) */
  toParent: string
  /** 기준 항목. null 이면 그 부모의 맨 끝 */
  targetNodeId: string | null
  position: 'before' | 'after' | 'inside'
}

/** 놓기 요청대로 순서를 고친다. 옮긴 뒤 항목 id 가 바뀌었으면(노트·폴더는 경로가 id) newNodeId 로 넣는다 */
export function placeInTreeOrder(
  order: VaultTreeOrder,
  request: VaultTreePlaceRequest,
  newNodeId: string = request.nodeId,
): Record<string, string[]> {
  const next: Record<string, string[]> = Object.fromEntries(Object.entries(order).map(([parent, ids]) => [parent, [...ids]]))
  const without = (ids: readonly string[]) => ids.filter((id) => id !== request.nodeId && id !== newNodeId)
  next[request.fromParent] = without(next[request.fromParent] ?? [])
  const siblings = without(next[request.toParent] ?? [])
  const targetIndex = request.targetNodeId === null || request.position === 'inside'
    ? -1
    : siblings.indexOf(request.targetNodeId)
  if (targetIndex < 0) siblings.push(newNodeId)
  else siblings.splice(request.position === 'before' ? targetIndex : targetIndex + 1, 0, newNodeId)
  next[request.toParent] = siblings
  return next
}

export interface VaultTreeReorderRequest {
  parentPath: string
  nodeId: string
  targetNodeId: string
  position: 'before' | 'after'
}

export type VaultTreeOrder = Readonly<Record<string, readonly string[]>>

/** 폴더 이름이 바뀌면 그 폴더(와 하위)의 정렬 순서도 새 경로로 옮긴다. 안 그러면 순서를 잃고 맨 뒤로 간다 */
export function renameFolderInTreeOrder(order: VaultTreeOrder, from: string, to: string): VaultTreeOrder {
  const move = (path: string) => path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path
  const moveId = (id: string) => {
    const colon = id.indexOf(':')
    if (colon < 0 || id.startsWith('pdf:')) return id
    return `${id.slice(0, colon + 1)}${move(id.slice(colon + 1))}`
  }
  return Object.fromEntries(Object.entries(order).map(([parent, ids]) => [move(parent), ids.map(moveId)]))
}

export type PdfAttachmentPolicy =
  | { kind: 'reference' }
  | { kind: 'copy-current-folder'; folderPath: string }
  | { kind: 'copy-another-folder'; folderPath: string }

function normalizedParts(path: string): string[] {
  return path.replaceAll('\\', '/').split('/').filter((part) => part.length > 0)
}

/**
 * 문서 트리에서 뺄 경로를 가려내는 함수. 「노트」 폴더(메모 노트)는 왼쪽 바의 노트 구역이 따로 보이므로 통째로 뺀다.
 * 영어 Vault 의 「Notes」는 사용자가 PDF·Markdown 을 넣어 둔 폴더일 수도 있어서, 노트 파일(.iwnote)과
 * 노트만 든 폴더만 빼고 나머지는 그대로 둔다.
 */
function reservedMatcher(entries: readonly VaultTreeEntry[]): (parts: readonly string[]) => boolean {
  const top = entries.flatMap((entry) => {
    const parts = normalizedParts(entry.path)
    return parts.length === 1 && entry.isDirectory ? [parts[0] ?? ''] : []
  })
  const folder = pickMemoNotesFolder(top) ?? memoNotesFolder()
  const koreanFolder = folder === MEMO_NOTES_FOLDER_KO
  // 노트 말고 다른 파일이 든 폴더(그 위 폴더 포함)
  const mixed = new Set<string>()
  const directories = new Set(entries.filter((entry) => entry.isDirectory).map((entry) => normalizedParts(entry.path).join('/')))
  if (!koreanFolder) {
    for (const entry of entries) {
      const parts = normalizedParts(entry.path)
      if (entry.isDirectory || parts[0] !== folder || entry.path.toLowerCase().endsWith(MEMO_NOTE_EXTENSION)) continue
      for (let length = 1; length < parts.length; length += 1) mixed.add(parts.slice(0, length).join('/'))
    }
  }
  return (parts) => {
    if (parts.includes('.iwae') || parts.includes('assets')) return true
    if (parts[0] !== folder) return false
    if (koreanFolder) return true
    const path = parts.join('/')
    return directories.has(path) ? !mixed.has(path) : path.toLowerCase().endsWith(MEMO_NOTE_EXTENSION)
  }
}

export function buildNotebookTree(entries: readonly VaultTreeEntry[]): NotebookGroup[] {
  const isReserved = reservedMatcher(entries)
  const notebooks = new Map<string, NotebookNote[]>()

  for (const entry of entries) {
    const parts = normalizedParts(entry.path)
    if (parts.length === 0 || isReserved(parts)) continue

    const notebook = parts[0]
    if (notebook === undefined) continue

    if (entry.isDirectory && parts.length === 1) {
      if (!notebooks.has(notebook)) notebooks.set(notebook, [])
      continue
    }

    const filename = parts[parts.length - 1]
    if (entry.isDirectory || parts.length < 2 || filename === undefined || !filename.endsWith('.canvas')) {
      continue
    }

    const notes = notebooks.get(notebook) ?? []
    notes.push({
      path: parts.join('/'),
      title: filename.slice(0, -'.canvas'.length),
    })
    notebooks.set(notebook, notes)
  }

  return [...notebooks.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, notes]) => ({
      name,
      notes: notes.sort((left, right) => left.path.localeCompare(right.path)),
    }))
}

function normalizedPath(path: string | undefined): string {
  return normalizedParts(path ?? '').join('/')
}

function nodeName(node: VaultTreeNode): string {
  return node.name.toLocaleLowerCase()
}

function orderedNodes(
  nodes: readonly VaultTreeNode[],
  parentPath: string,
  order: VaultTreeOrder,
): VaultTreeNode[] {
  const positions = new Map((order[parentPath] ?? []).map((id, index) => [id, index]))
  return [...nodes].sort((left, right) => {
    const leftPosition = positions.get(left.id)
    const rightPosition = positions.get(right.id)
    if (leftPosition !== undefined || rightPosition !== undefined) {
      if (leftPosition === undefined) return 1
      if (rightPosition === undefined) return -1
      return leftPosition - rightPosition
    }
    const leftRank = left.kind === 'folder' ? 0 : 1
    const rightRank = right.kind === 'folder' ? 0 : 1
    if (leftRank !== rightRank) return leftRank - rightRank
    const byName = nodeName(left).localeCompare(nodeName(right))
    return byName === 0 ? left.id.localeCompare(right.id) : byName
  })
}

export function buildVaultWorkspaceTree(
  entries: readonly VaultTreeEntry[],
  library: readonly LibraryDoc[],
  order: VaultTreeOrder = {},
  displayNames: ReadonlyMap<string, string> = new Map(),
  indexedDocuments: readonly VaultIndexEntry[] = [],
): VaultTreeNode[] {
  const root: VaultFolderNode = {
    id: 'folder:',
    kind: 'folder',
    name: '',
    path: '',
    children: [],
  }
  const isReserved = reservedMatcher(entries)
  const folders = new Map<string, VaultFolderNode>([['', root]])
  const indexedMarkdownByPath = new Map(indexedDocuments
    .filter((entry) => entry.kind === 'markdown' && entry.storage === 'vault')
    .map((entry) => [normalizedPath(entry.path).toLocaleLowerCase(), entry]))

  const ensureFolder = (folderPath: string): VaultFolderNode => {
    const path = normalizedPath(folderPath)
    const existing = folders.get(path)
    if (existing !== undefined) return existing
    const parts = normalizedParts(path)
    const name = parts.at(-1) ?? ''
    const parentPath = parts.slice(0, -1).join('/')
    const folder: VaultFolderNode = {
      id: `folder:${path}`,
      kind: 'folder',
      name,
      path,
      children: [],
    }
    folders.set(path, folder)
    ensureFolder(parentPath).children.push(folder)
    return folder
  }

  for (const entry of entries) {
    const parts = normalizedParts(entry.path)
    if (parts.length === 0 || isReserved(parts)) continue
    if (entry.isDirectory) {
      ensureFolder(parts.join('/'))
      continue
    }
    const filename = parts.at(-1)
    if (filename === undefined) continue
    const path = parts.join('/')
    const lowerFilename = filename.toLowerCase()
    if (lowerFilename.endsWith('.canvas')) {
      ensureFolder(parts.slice(0, -1).join('/')).children.push({
        id: `note:${path}`,
        kind: 'note',
        // 예전에 파일 이름 그대로(확장자 포함) 등록된 표시 이름은 확장자를 떼어 보인다
        name: (displayNames.get(path) ?? filename).replace(/\.canvas$/iu, ''),
        path,
      })
    } else if (isMarkdownPath(lowerFilename)) {
      const indexed = indexedMarkdownByPath.get(path.toLocaleLowerCase())
      ensureFolder(parts.slice(0, -1).join('/')).children.push({
        id: `markdown:${indexed?.id ?? path}`,
        kind: 'markdown',
        name: (displayNames.get(path) ?? filename).replace(/\.(?:md|markdown)$/iu, ''),
        path,
        storage: 'vault',
        indexId: indexed?.id ?? path,
      })
    }
  }

  for (const indexed of indexedDocuments) {
    if (indexed.kind !== 'markdown' || indexed.storage !== 'reference' || indexed.missing) continue
    root.children.push({
      id: `markdown:${indexed.id}`,
      kind: 'markdown',
      name: indexed.displayName,
      path: indexed.path,
      storage: 'reference',
      indexId: indexed.id,
    })
  }

  for (const doc of library) {
    const folderPath = normalizedPath(doc.folderPath)
    ensureFolder(folderPath).children.push({
      id: `pdf:${doc.docId}`,
      kind: 'pdf',
      name: doc.title,
      folderPath,
      doc,
    })
  }

  const sortFolder = (folder: VaultFolderNode): VaultFolderNode => ({
    ...folder,
    children: orderedNodes(folder.children.map((node) => (
      node.kind === 'folder' ? sortFolder(node) : node
    )), folder.path, order),
  })

  return sortFolder(root).children
}

export function buildLegacyWorkspaceTree(
  library: readonly LibraryDoc[],
  notebooks: readonly NotebookGroup[],
): VaultTreeNode[] {
  const libraryFolder: VaultFolderNode = {
    id: 'folder:Library',
    kind: 'folder',
    name: 'Library',
    path: 'Library',
    children: library.map((doc) => ({
      id: `pdf:${doc.docId}`,
      kind: 'pdf',
      name: doc.title,
      folderPath: 'Library',
      doc,
    })),
  }
  const notebookFolder: VaultFolderNode = {
    id: 'folder:Notebooks',
    kind: 'folder',
    name: 'Notebooks',
    path: 'Notebooks',
    children: notebooks.map((group) => ({
      id: `folder:Notebooks/${group.name}`,
      kind: 'folder',
      name: group.name,
      path: `Notebooks/${group.name}`,
      children: group.notes.map((note): VaultNoteNode | VaultMarkdownNode => (
        note.path.toLowerCase().endsWith('.md')
          ? {
              id: `markdown:${note.path}`,
              kind: 'markdown',
              name: note.title,
              path: note.path,
              storage: 'vault',
              indexId: note.path,
            }
          : {
              id: `note:${note.path}`,
              kind: 'note',
              name: note.title,
              path: note.path,
            }
      )),
    })),
  }
  return [libraryFolder, notebookFolder]
}

export function reorderVaultTreeNode(
  tree: readonly VaultTreeNode[],
  request: VaultTreeReorderRequest,
): VaultTreeNode[] {
  const reorder = (nodes: readonly VaultTreeNode[], parentPath: string): VaultTreeNode[] => {
    if (parentPath === request.parentPath) {
      const currentIndex = nodes.findIndex((node) => node.id === request.nodeId)
      const requestedTargetIndex = nodes.findIndex((node) => node.id === request.targetNodeId)
      if (currentIndex < 0 || requestedTargetIndex < 0 || currentIndex === requestedTargetIndex) {
        return [...nodes]
      }
      const next = [...nodes]
      const [node] = next.splice(currentIndex, 1)
      const targetIndex = next.findIndex((candidate) => candidate.id === request.targetNodeId)
      const insertIndex = request.position === 'before' ? targetIndex : targetIndex + 1
      if (node !== undefined) next.splice(insertIndex, 0, node)
      return next
    }
    return nodes.map((node) => node.kind === 'folder'
      ? { ...node, children: reorder(node.children, node.path) }
      : node)
  }
  return reorder(tree, '')
}

function projectNodes(
  nodes: readonly VaultTreeNode[],
  accepts: (node: VaultTreeNode) => boolean,
): VaultTreeNode[] {
  const projected: VaultTreeNode[] = []
  for (const node of nodes) {
    if (node.kind !== 'folder') {
      if (accepts(node)) projected.push(node)
      continue
    }
    const children = projectNodes(node.children, accepts)
    if (children.length > 0 || node.children.length === 0) {
      projected.push({ ...node, children })
    }
  }
  return projected
}

export function projectVaultTree(tree: readonly VaultTreeNode[]): {
  documents: VaultTreeNode[]
  notes: VaultTreeNode[]
} {
  return {
    documents: projectNodes(tree, (node) => node.kind === 'pdf' || node.kind === 'markdown'),
    notes: projectNodes(tree, (node) => node.kind === 'note'),
  }
}

export function vaultTreeOrder(tree: readonly VaultTreeNode[]): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  const visit = (nodes: readonly VaultTreeNode[], parentPath: string) => {
    result[parentPath] = nodes.map((node) => node.id)
    for (const node of nodes) {
      if (node.kind === 'folder') visit(node.children, node.path)
    }
  }
  visit(tree, '')
  return result
}
