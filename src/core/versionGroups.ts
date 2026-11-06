/**
 * 문서 판(version) 묶음. 같은 문서의 여러 판(PDF 파일 여러 개)을 왼쪽 바에서 한 줄로 겹쳐 보인다.
 * 각 판은 지금과 똑같은 PDF 하나(docId)라서 형광펜·핀·원본 출처는 판에 그대로 붙는다 — 이 파일은 「누가 누구와 묶였나」만 안다.
 *
 * - 대표 자리(anchorDocId): 왼쪽 바에서 묶음 줄이 놓이는 자리. 묶음을 만들 때 아래에 깔린 문서의 자리다.
 * - 기본 판(defaultDocId): 묶음 줄을 눌렀을 때 열리는 판. 핀으로 바꾼다. 탭에서 판을 바꾸는 것은 이 값을 건드리지 않는다.
 */

export interface DocVersion {
  readonly docId: string
  /** 드롭다운에 보일 이름(예: 1.4.0, Jul 2026) */
  readonly label: string
  readonly addedAt: string
}

export interface VersionGroup {
  readonly id: string
  /** 묶음 줄에 보일 문서 이름 */
  readonly title: string
  readonly anchorDocId: string
  readonly defaultDocId: string
  readonly versions: readonly DocVersion[]
}

export interface VersionGroupsFile {
  readonly version: 1
  readonly groups: Readonly<Record<string, VersionGroup>>
}

export const EMPTY_VERSION_GROUPS: VersionGroupsFile = { version: 1, groups: {} }

let counter = 0
export function newGroupId(): string {
  counter += 1
  return `g${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

type Groups = Readonly<Record<string, VersionGroup>>

/** 문서가 속한 묶음. 없으면 null */
export function groupOfDoc(groups: Groups, docId: string): VersionGroup | null {
  return Object.values(groups).find((group) => group.versions.some((version) => version.docId === docId)) ?? null
}

/** 왼쪽 바 목록에서 숨길 문서들: 묶음의 대표 자리를 뺀 모든 판 */
export function hiddenVersionDocIds(groups: Groups): Set<string> {
  const hidden = new Set<string>()
  for (const group of Object.values(groups)) {
    for (const version of group.versions) if (version.docId !== group.anchorDocId) hidden.add(version.docId)
  }
  return hidden
}

/** 묶음의 기본 판(없으면 첫 판) */
export function defaultVersion(group: VersionGroup): DocVersion {
  return group.versions.find((version) => version.docId === group.defaultDocId) ?? group.versions[0]!
}

/** 두 문서를 새 묶음으로. base 가 대표 자리가 된다. 이미 어느 묶음에 있으면 null(먼저 빼야 한다) */
export function createGroup(
  groups: Groups,
  base: { docId: string; title: string; label: string },
  added: { docId: string; label: string },
  now: Date = new Date(),
): { groups: Groups; group: VersionGroup } | null {
  if (base.docId === added.docId) return null
  if (groupOfDoc(groups, base.docId) !== null || groupOfDoc(groups, added.docId) !== null) return null
  const at = now.toISOString()
  const group: VersionGroup = {
    id: newGroupId(),
    title: base.title,
    anchorDocId: base.docId,
    defaultDocId: base.docId,
    versions: [
      { docId: base.docId, label: base.label, addedAt: at },
      { docId: added.docId, label: added.label, addedAt: at },
    ],
  }
  return { groups: { ...groups, [group.id]: group }, group }
}

/** 판 관리 시작: 문서 하나만으로 묶음을 만든다(판은 나중에 더한다). 이미 묶였으면 null */
export function createSingleGroup(
  groups: Groups,
  base: { docId: string; title: string; label: string },
  now: Date = new Date(),
): { groups: Groups; group: VersionGroup } | null {
  if (groupOfDoc(groups, base.docId) !== null) return null
  const group: VersionGroup = {
    id: newGroupId(),
    title: base.title,
    anchorDocId: base.docId,
    defaultDocId: base.docId,
    versions: [{ docId: base.docId, label: base.label, addedAt: now.toISOString() }],
  }
  return { groups: { ...groups, [group.id]: group }, group }
}

/** 기존 묶음에 판을 더한다. 이미 어느 묶음에 있으면 같은 객체를 돌려준다 */
export function addVersion(groups: Groups, groupId: string, added: { docId: string; label: string }, now: Date = new Date()): Groups {
  const group = groups[groupId]
  if (group === undefined || groupOfDoc(groups, added.docId) !== null) return groups
  return { ...groups, [groupId]: { ...group, versions: [...group.versions, { docId: added.docId, label: added.label, addedAt: now.toISOString() }] } }
}

/**
 * 판 하나를 묶음에서 뺀다(파일은 그대로 — 독립 문서로 돌아간다). 판이 하나도 남지 않으면 묶음이 없어진다
 * (판 하나짜리 묶음도 그대로 둔다 — 「판 관리 끝내기」로 푼다). 대표 자리·기본 판을 뺐으면 남은 첫 판으로 옮긴다.
 */
export function removeVersion(groups: Groups, docId: string): Groups {
  const group = groupOfDoc(groups, docId)
  if (group === null) return groups
  const versions = group.versions.filter((version) => version.docId !== docId)
  const { [group.id]: _gone, ...rest } = groups
  if (versions.length === 0) return rest
  const first = versions[0]!.docId
  return {
    ...rest,
    [group.id]: {
      ...group,
      versions,
      anchorDocId: group.anchorDocId === docId ? first : group.anchorDocId,
      defaultDocId: group.defaultDocId === docId ? first : group.defaultDocId,
    },
  }
}

/** 묶음 풀기: 모든 판이 독립 문서로 */
export function dissolveGroup(groups: Groups, groupId: string): Groups {
  const { [groupId]: _gone, ...rest } = groups
  return rest
}

/** 핀: 이 판을 기본 판으로 */
export function setDefaultVersion(groups: Groups, docId: string): Groups {
  const group = groupOfDoc(groups, docId)
  if (group === null || group.defaultDocId === docId) return groups
  return { ...groups, [group.id]: { ...group, defaultDocId: docId } }
}

export function renameVersion(groups: Groups, docId: string, label: string): Groups {
  const group = groupOfDoc(groups, docId)
  const clean = label.trim()
  if (group === null || clean === '') return groups
  return { ...groups, [group.id]: { ...group, versions: group.versions.map((version) => version.docId === docId ? { ...version, label: clean } : version) } }
}

export function renameGroup(groups: Groups, groupId: string, title: string): Groups {
  const group = groups[groupId]
  const clean = title.trim()
  if (group === undefined || clean === '') return groups
  return { ...groups, [groupId]: { ...group, title: clean } }
}

/** 폴더 판(`folder:<경로>`)의 폴더를 옮겼다: 그 폴더(와 그 안 폴더)의 판 id 를 새 경로로 */
export function remapFolderVersions(groups: Groups, from: string, to: string): Groups {
  const move = (id: string) => {
    if (!id.startsWith('folder:')) return id
    const path = id.slice('folder:'.length)
    if (path === from) return `folder:${to}`
    if (path.startsWith(`${from}/`)) return `folder:${to}${path.slice(from.length)}`
    return id
  }
  let changed = false
  const next: Record<string, VersionGroup> = {}
  for (const [id, group] of Object.entries(groups)) {
    const versions = group.versions.map((version) => ({ ...version, docId: move(version.docId) }))
    const moved = versions.some((version, index) => version.docId !== group.versions[index]!.docId)
    changed ||= moved
    next[id] = moved ? { ...group, versions, anchorDocId: move(group.anchorDocId), defaultDocId: move(group.defaultDocId) } : group
  }
  return changed ? next : groups
}

/** 지워진 문서를 모든 묶음에서 뺀다 */
export function forgetDocs(groups: Groups, docIds: ReadonlySet<string>): Groups {
  let next = groups
  for (const docId of docIds) next = removeVersion(next, docId)
  return next
}

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December'

/**
 * 판 이름 추정: 파일 이름(없으면 제목)에서 버전·날짜를 찾는다. 못 찾으면 파일 이름 그대로.
 * 1.4.0 / v2.1 / Rev A / 2026-07 / Jul 2026 / 2026
 */
export function guessVersionLabel(fileName: string, title?: string): string {
  // 앱에 보이는 제목에 「(3.2) …」「(July 2026) …」처럼 판이 적혀 있으면 그것이 가장 믿을 만하다
  if (title !== undefined) {
    const fromTitle = findVersionLabel(title)
    if (fromTitle !== null) return fromTitle
  }
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/iu, '').trim()
  const found = findVersionLabel(stem)
  if (found !== null) return found
  const plain = stem.replaceAll('_', ' ')
  return plain.length > 40 ? `${plain.slice(0, 40)}…` : plain
}

/** 글에서 판 이름(버전·날짜)을 찾는다. 없으면 null */
function findVersionLabel(text: string): string | null {
  const stem = text.replaceAll('_', ' ').trim()
  // 1.4.0 / v2.1 / R4.1.4 / 2.00a / 1.05a-rc00
  const semver = /(?:^|[\s\-(]|(?<=\b[vr]))v?(\d+\.\d+(?:\.\d+){0,2}[a-z]?)(?=$|[\s\-)])/iu.exec(stem)
  if (semver !== null) return semver[1]!
  // Standard_3_3_1_20241020 → 3.3.1 (밑줄로 끊긴 숫자 버전 뒤에 날짜가 오는 이름)
  const spaced = /(?:^|\s)(\d{1,2}(?:\s\d{1,2}){1,3})(?=\s(?:19|20)\d{6}\b)/u.exec(stem)
  if (spaced !== null) return spaced[1]!.replaceAll(' ', '.')
  const rev = /\b(?:rev(?:ision)?|ver(?:sion)?)\.?\s*([a-z0-9]+(?:\.[0-9]+)*[a-z]?)(?![a-z0-9])/iu.exec(stem)
  if (rev !== null) return `Rev ${rev[1]!.toUpperCase()}`
  const monthYear = new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s*,?\\s*(20\\d{2})\\b`, 'iu').exec(stem)
  if (monthYear !== null) return `${monthYear[1]!.slice(0, 1).toUpperCase()}${monthYear[1]!.slice(1, 3).toLowerCase()} ${monthYear[2]}`
  const isoDate = /\b(20\d{2})[-.](\d{2})(?:[-.](\d{2}))?\b/u.exec(stem)
  if (isoDate !== null) return isoDate[3] === undefined ? `${isoDate[1]}-${isoDate[2]}` : `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`
  // 20241020 → 2024-10-20
  const compactDate = /\b(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/u.exec(stem)
  if (compactDate !== null) return `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`
  const year = /\b(20\d{2})\b/u.exec(stem)
  if (year !== null) return year[1]!
  return null
}

const MONTH_INDEX: Readonly<Record<string, number>> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** 판 이름을 비교할 수 있는 숫자 열로(1.4.0 → [1,4,0], Jul 2026 → [2026,7], Rev B → [2]). 모르면 null */
function versionKey(label: string): number[] | null {
  const clean = label.trim()
  const monthYear = /^([a-z]{3})[a-z]*\s+(\d{4})$/iu.exec(clean)
  if (monthYear !== null) {
    const month = MONTH_INDEX[monthYear[1]!.toLowerCase()]
    return month === undefined ? null : [Number(monthYear[2]), month]
  }
  const rev = /^rev\s+([a-z])$/iu.exec(clean)
  if (rev !== null) return [rev[1]!.toUpperCase().charCodeAt(0) - 64]
  const numbers = /^(?:rev\s+)?v?(\d+(?:[.-]\d+)*)([a-z]?)$/iu.exec(clean)
  if (numbers === null) return null
  const parts = numbers[1]!.split(/[.-]/u).map(Number)
  // 끝 글자(2.00a, 1.05b)는 마지막 자리 뒤의 작은 차이로 본다
  if (numbers[2] !== '') parts.push(numbers[2]!.toLowerCase().charCodeAt(0) - 96)
  return parts
}

/**
 * 두 판 이름 중 어느 쪽이 새 판인가: a 가 새것이면 양수, b 면 음수, 같거나 비교할 수 없으면 0.
 * 같은 꼴(둘 다 버전 번호, 둘 다 날짜)일 때만 비교한다.
 */
export function compareVersionLabels(a: string, b: string): number {
  const left = versionKey(a)
  const right = versionKey(b)
  if (left === null || right === null) return 0
  // 날짜(2026-07)와 버전(1.4)을 섞어 비교하지 않는다
  const isDate = (key: number[]) => key[0]! >= 1900
  if (isDate(left) !== isDate(right)) return 0
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 묶음 이름: 제목 앞뒤에 붙은 판 표시(「(3.3.1) Specification」의 「(3.3.1)」)를 걷어 낸다. 다 걷히면 원래 제목 */
export function groupTitleFromDocTitle(title: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  // 「(1.4.0)」「(v2.1)」는 제목 어디에 있든 걷어 내고, 남은 앞뒤 구분 기호·겹친 공백을 정리한다
  const stripped = title
    .replace(new RegExp(`\\(\\s*v?${escaped}\\s*\\)`, 'giu'), ' ')
    .replace(/\s{2,}/gu, ' ')
    .replace(/^[\s\-–·:]+|[\s\-–·:]+$/gu, '')
    .trim()
  return stripped === '' ? title : stripped
}

export function parseVersionGroups(value: unknown): VersionGroupsFile {
  if (typeof value !== 'object' || value === null) return EMPTY_VERSION_GROUPS
  const raw = (value as { groups?: unknown }).groups
  if (typeof raw !== 'object' || raw === null) return EMPTY_VERSION_GROUPS
  const groups: Record<string, VersionGroup> = {}
  const seen = new Set<string>()
  for (const [id, item] of Object.entries(raw)) {
    if (typeof item !== 'object' || item === null) continue
    const { title, anchorDocId, defaultDocId, versions } = item as Record<string, unknown>
    if (typeof title !== 'string' || !Array.isArray(versions)) continue
    const list = versions.flatMap((entry: unknown): DocVersion[] => {
      if (typeof entry !== 'object' || entry === null) return []
      const { docId, label, addedAt } = entry as Record<string, unknown>
      // 한 문서는 한 묶음에만
      if (typeof docId !== 'string' || docId === '' || seen.has(docId)) return []
      seen.add(docId)
      return [{ docId, label: typeof label === 'string' && label.trim() !== '' ? label : docId.slice(0, 8), addedAt: typeof addedAt === 'string' ? addedAt : new Date(0).toISOString() }]
    })
    if (list.length < 1) continue
    const has = (docId: unknown) => typeof docId === 'string' && list.some((version) => version.docId === docId)
    groups[id] = {
      id,
      title: title.trim() === '' ? list[0]!.label : title,
      anchorDocId: has(anchorDocId) ? anchorDocId as string : list[0]!.docId,
      defaultDocId: has(defaultDocId) ? defaultDocId as string : list[0]!.docId,
      versions: list,
    }
  }
  return { version: 1, groups }
}

interface OutlineEntry { readonly title: string; readonly page: number | null }

/** 목차 제목 비교용: 대소문자·공백·끝 점을 무시한다 */
function normalizeHeading(title: string): string {
  return title.toLowerCase().replace(/\s+/gu, ' ').replace(/[.:]+$/u, '').trim()
}

/**
 * 판을 바꿀 때 읽던 자리 맞추기: 옛 판에서 지금 쪽이 속한 절(목차 항목)을 찾아 새 판의 같은 제목 절로 간다(절 안에서 몇 쪽째였는지도 유지).
 * 같은 절이 없으면 같은 쪽 번호. 쪽은 0-기반, 결과는 새 판 쪽 수 안으로 자른다.
 */
export function matchVersionPage(
  fromOutline: readonly OutlineEntry[],
  fromPage: number,
  toOutline: readonly OutlineEntry[],
  toPageCount: number,
): number {
  const clamp = (page: number) => Math.min(Math.max(page, 0), Math.max(toPageCount - 1, 0))
  // 지금 쪽 이전에서 가장 가까이 시작한 절(같은 쪽이면 뒤에 나온 = 더 깊은 절)
  let current: { title: string; page: number } | null = null
  for (const entry of fromOutline) {
    if (entry.page === null || entry.page > fromPage) continue
    if (current === null || entry.page >= current.page) current = { title: entry.title, page: entry.page }
  }
  if (current !== null) {
    const wanted = normalizeHeading(current.title)
    const target = toOutline.find((entry) => entry.page !== null && normalizeHeading(entry.title) === wanted)
    if (target !== undefined && target.page !== null) return clamp(target.page + (fromPage - current.page))
  }
  return clamp(fromPage)
}

/** 판 표시(버전·날짜·Rev)를 뺀 이름 — 같은 문서의 다른 판인지 가늠하는 열쇠 */
export function versionlessName(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,5}$/iu, '')
    .replaceAll('_', ' ')
    .replace(/\b(?:19|20)\d{2}[-.]?(?:0[1-9]|1[0-2])[-.]?(?:0[1-9]|[12]\d|3[01])\b/gu, ' ')
    .replace(/(?:^|\s)\d{1,2}(?:\s\d{1,2}){1,3}(?=\s|$)/gu, ' ')
    .replace(new RegExp(`\\b(?:${MONTHS})[a-z]*\\.?\\s*,?\\s*20\\d{2}\\b`, 'giu'), ' ')
    .replace(/\b(?:rev(?:ision)?|ver(?:sion)?)\.?\s*[a-z0-9]+(?:\.\d+)*[a-z]?\b/giu, ' ')
    .replace(/(?:^|[\s\-(])[vr]?\d+(?:\.\d+)+[a-z]?(?:-[a-z0-9]+)?(?=$|[\s\-)])/giu, ' ')
    .replace(/[()[\]\-–·:]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
}

/**
 * 새로 가져온 문서와 같은 폴더에 있는 「같은 문서의 다른 판」을 찾는다(판 표시를 뺀 이름이 같고, 아직 묶이지 않은 문서).
 * 하나만 있을 때만 돌려준다(여럿이면 어느 것인지 모르므로 묻지 않는다).
 */
export function findVersionSibling(
  added: { readonly docId: string; readonly title: string; readonly folderPath?: string },
  library: readonly { readonly docId: string; readonly title: string; readonly folderPath?: string }[],
  groups: Groups,
): string | null {
  const key = versionlessName(added.title)
  if (key.length < 3 || groupOfDoc(groups, added.docId) !== null) return null
  const folder = added.folderPath ?? ''
  const matches = library.filter((doc) => doc.docId !== added.docId
    && (doc.folderPath ?? '') === folder
    && versionlessName(doc.title) === key
    && versionlessName(doc.title) !== doc.title.toLowerCase().trim().replaceAll('_', ' '))
  // 묶음이 있으면 그 묶음의 대표 자리로
  const anchors = new Set(matches.map((doc) => groupOfDoc(groups, doc.docId)?.anchorDocId ?? doc.docId))
  return anchors.size === 1 ? [...anchors][0]! : null
}
