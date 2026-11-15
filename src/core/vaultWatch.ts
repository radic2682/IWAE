import type { VaultIndexEntry } from './vaultIndex'

export interface VaultWatchEvent {
  paths: string[]
  /** tauri-plugin-fs 의 이벤트 종류. 삭제는 { remove: { kind } } */
  type?: unknown
}

function isRemoveEvent(event: VaultWatchEvent): boolean {
  const kind = event.type
  return typeof kind === 'object' && kind !== null && 'remove' in kind
}

export interface VaultWatchClassification {
  reloadIds: string[]
  conflictIds: string[]
  shouldReindex: boolean
}

function normalize(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/{2,}/gu, '/').replace(/\/$/u, '').toLocaleLowerCase()
}

function absoluteEntryPath(entry: VaultIndexEntry, vaultRoot: string): string {
  if (entry.storage === 'reference' || /^[A-Za-z]:[/\\]/u.test(entry.path) || entry.path.startsWith('/')) {
    return normalize(entry.path)
  }
  return normalize(`${vaultRoot}/${entry.path}`)
}

export function isIgnoredVaultEvent(path: string): boolean {
  const normalized = normalize(path)
  const filename = normalized.split('/').at(-1) ?? normalized
  return (
    normalized.includes('/.iwae/')
    || normalized.endsWith('/.iwae')
    // GitHub 에서 가져온 폴더의 git 내부 파일(fetch·pull 때 수백 개가 한꺼번에 바뀐다)
    || normalized.includes('/.git/')
    || normalized.endsWith('/.git')
    || filename.startsWith('.iwae-')
    || filename.startsWith('~$')
    || /\.(?:part|swp|temp|tmp)$/u.test(filename)
    || /(?:conflicted|conflict) copy/u.test(filename)
  )
}

export function classifyVaultEvents(
  events: readonly VaultWatchEvent[],
  index: readonly VaultIndexEntry[],
  dirtyIds: ReadonlySet<string>,
  vaultRoot: string,
): VaultWatchClassification {
  const byPath = new Map(index.map((entry) => [absoluteEntryPath(entry, vaultRoot), entry]))
  const reloadIds = new Set<string>()
  const conflictIds = new Set<string>()
  let shouldReindex = false

  for (const event of events) for (const path of event.paths) {
    if (isIgnoredVaultEvent(path)) continue
    const entry = byPath.get(normalize(path))
    if (entry === undefined) {
      shouldReindex = true
      continue
    }
    if (isRemoveEvent(event)) {
      // 지워진 파일은 다시 읽을 수 없다. 색인을 새로 맞춰 없는 파일로 표시한다
      shouldReindex = true
      if (dirtyIds.has(entry.id)) conflictIds.add(entry.id)
      continue
    }
    if (dirtyIds.has(entry.id)) conflictIds.add(entry.id)
    else reloadIds.add(entry.id)
  }

  return {
    reloadIds: [...reloadIds],
    conflictIds: [...conflictIds],
    shouldReindex,
  }
}

