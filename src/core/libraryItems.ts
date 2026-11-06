import type { LibraryDoc, NotebookNote, VaultFolderNode, VaultMarkdownNode, VaultTreeNode } from './vaultTree'
import type { VaultSearchRecord } from './vaultSearch'
import type { BibEntry } from './bibliography'
import { t } from '../i18n'

export type LibraryItemKind = 'pdf' | 'markdown' | 'note'

/** 항목을 열 때 App 이 받는 값. 사이드바 트리의 열기 콜백과 같은 모양이다 */
export type LibraryOpenTarget =
  | { kind: 'pdf'; doc: LibraryDoc }
  | { kind: 'markdown'; node: VaultMarkdownNode }
  | { kind: 'note'; note: NotebookNote }

export interface LibraryItem {
  /** 이동·즐겨찾기·이모지에 쓰는 항목 id. 검색 레코드가 없으면 경로다 */
  id: string
  kind: LibraryItemKind
  name: string
  /** 들어 있는 폴더. Vault 루트는 '' */
  folder: string
  storage: 'vault' | 'reference'
  favorite: boolean
  lastOpenedAt: string | null
  addedAt: string | null
  /** 표에 보일 저자. 서지 정보가 없으면 빈 문자열 */
  authors: string
  year: number | null
  open: LibraryOpenTarget
}

export type LibraryCollection =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'recent' }
  | { kind: 'folder'; path: string }

export type LibrarySortKey = 'name' | 'author' | 'year' | 'kind' | 'folder' | 'date' | 'storage'

const RECENT_LIMIT = 30
const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })
const KIND_ORDER: Record<LibraryItemKind, number> = { pdf: 0, markdown: 1, note: 2 }

function parentFolder(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).slice(0, -1).join('/')
}

/** 트리의 파일 노드를 표의 행으로 편다. 순서는 트리 순서 그대로다 */
/** 첫 저자만 보이고 나머지는 수로 줄인다 */
function authorLabel(authors: readonly string[]): string {
  if (authors.length === 0) return ''
  return authors.length === 1 ? authors[0]! : t('{first} 외 {count}명', { first: authors[0]!, count: authors.length - 1 })
}

export function collectLibraryItems(
  tree: readonly VaultTreeNode[],
  records: readonly VaultSearchRecord[],
  bibliography: Readonly<Record<string, BibEntry>> = {},
): LibraryItem[] {
  const byId = new Map(records.map((record) => [record.id, record]))
  const byPath = new Map(records.map((record) => [record.path, record]))
  const items: LibraryItem[] = []
  const visit = (nodes: readonly VaultTreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        visit(node.children)
        continue
      }
      const record = node.kind === 'pdf' ? byId.get(node.doc.docId) : byPath.get(node.path)
      const base = {
        name: node.name,
        storage: record?.storage ?? 'vault',
        favorite: record?.favorite ?? false,
        lastOpenedAt: record?.lastOpenedAt ?? null,
        addedAt: record?.addedAt ?? null,
        authors: '',
        year: null as number | null,
      }
      if (node.kind === 'pdf') {
        const bib = bibliography[node.doc.docId]
        items.push({
          ...base,
          authors: authorLabel(bib?.authors ?? []),
          year: bib?.year ?? null,
          id: node.doc.docId,
          kind: 'pdf',
          folder: node.folderPath,
          open: { kind: 'pdf', doc: node.doc },
        })
      } else if (node.kind === 'markdown') {
        items.push({
          ...base,
          id: record?.id ?? node.path,
          kind: 'markdown',
          storage: node.storage,
          folder: parentFolder(node.path),
          open: { kind: 'markdown', node },
        })
      } else {
        items.push({
          ...base,
          id: record?.id ?? node.path,
          kind: 'note',
          folder: parentFolder(node.path),
          open: { kind: 'note', note: { path: node.path, title: node.name } },
        })
      }
    }
  }
  visit(tree)
  return items
}

/** 폴더만 남은 트리 노드. 자식도 폴더뿐이라는 것을 타입으로 보장한다 */
export interface LibraryFolder extends Omit<VaultFolderNode, 'children'> {
  children: LibraryFolder[]
}

/** 왼쪽 모음 트리용. 파일을 걷어 내고 폴더만 남긴다 */
export function libraryFolders(tree: readonly VaultTreeNode[]): LibraryFolder[] {
  return tree.flatMap((node) => node.kind === 'folder'
    ? [{ ...node, children: libraryFolders(node.children) }]
    : [])
}

/** 폴더를 고르면 하위 폴더의 항목도 보인다(Zotero 의 "하위 모음 항목 표시") */
const inFolder = (folder: string, path: string) => path === '' || folder === path || folder.startsWith(`${path}/`)

export function filterLibraryItems(
  items: readonly LibraryItem[],
  collection: LibraryCollection,
  query: string,
): LibraryItem[] {
  let result: LibraryItem[]
  if (collection.kind === 'favorites') {
    result = items.filter((item) => item.favorite)
  } else if (collection.kind === 'recent') {
    result = items
      .filter((item) => item.lastOpenedAt !== null)
      .sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))
      .slice(0, RECENT_LIMIT)
  } else if (collection.kind === 'folder') {
    result = items.filter((item) => inFolder(item.folder, collection.path))
  } else {
    result = [...items]
  }
  const needle = query.trim().toLocaleLowerCase('ko-KR')
  return needle === '' ? result : result.filter((item) => item.name.toLocaleLowerCase('ko-KR').includes(needle))
}

export function sortLibraryItems(
  items: readonly LibraryItem[],
  key: LibrarySortKey,
  direction: 'asc' | 'desc',
): LibraryItem[] {
  const sign = direction === 'asc' ? 1 : -1
  const date = (item: LibraryItem) => item.lastOpenedAt ?? item.addedAt ?? ''
  const compare = (a: LibraryItem, b: LibraryItem): number => {
    switch (key) {
      case 'kind': return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      case 'folder': return collator.compare(a.folder, b.folder)
      case 'date': return date(a).localeCompare(date(b))
      case 'storage': return a.storage.localeCompare(b.storage)
      // 빈 값은 방향과 상관없이 맨 뒤로 보낸다. 여기서 sign 을 미리 곱해 두어 아래의
      // 전체 sign 과 상쇄되게 한다.
      case 'author':
        if ((a.authors === '') !== (b.authors === '')) return (a.authors === '' ? 1 : -1) * sign
        return collator.compare(a.authors, b.authors)
      case 'year':
        if ((a.year === null) !== (b.year === null)) return (a.year === null ? 1 : -1) * sign
        return (a.year ?? 0) - (b.year ?? 0)
      case 'name': return 0
    }
  }
  // 이름은 모든 열의 동점 처리 기준이다. 방향도 함께 뒤집혀야 내림차순
  // 이름 정렬이 오름차순의 정확한 역순이 된다.
  return [...items].sort((a, b) => (compare(a, b) || collator.compare(a.name, b.name)) * sign)
}

/** Shift+클릭 범위. 기준 항목이 목록에서 사라졌으면 누른 항목 하나만 고른다 */
export function selectRange(orderedIds: readonly string[], anchorId: string, targetId: string): string[] {
  const from = orderedIds.indexOf(anchorId)
  const to = orderedIds.indexOf(targetId)
  if (to === -1) return []
  if (from === -1) return [targetId]
  const [start, end] = from <= to ? [from, to] : [to, from]
  return orderedIds.slice(start, end + 1)
}
