/**
 * 두 창이 같은 Vault 파일을 고칠 때 쓰는 세 갈래 병합.
 *
 * 저장소는 모두 「메모리 상태 전체를 파일에 다시 쓰는」 방식이라, 한 창의 저장이 다른 창이 방금 쓴
 * 내용을 지울 수 있다. 그래서 저장하기 직전에 디스크의 현재 내용(remote)을, 이 창이 마지막으로 알던 내용(base)과
 * 이 창이 쓰려는 내용(local)에 맞춰 합친다. 결과 = remote + (local − base).
 *
 * 규칙(JSON 값 단위):
 * - 객체: 열쇠마다 합친다. 한쪽만 바뀐 열쇠는 그쪽을 따르고, 둘 다 바꿨으면 안쪽으로 내려가 합친다
 * - `id` 가 있는 객체의 배열: id 로 짝지어 합친다(추가·삭제·수정이 서로 지워지지 않는다)
 * - id 가 없는 객체 배열: 같은 값끼리 집합처럼 합친다(번역 기록 등)
 * - 그 밖의 배열·값: 둘 다 바꿨으면 local(지금 저장하는 쪽)이 이긴다
 * - 한쪽이 지운 항목을 다른 쪽이 고쳤다면 지우지 않고 고친 쪽을 남긴다(내용을 잃는 쪽보다 낫다)
 */

type Json = unknown

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function jsonEqual(left: Json, right: Json): boolean {
  if (left === right) return true
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]))
  }
  if (isRecord(left)) {
    if (!isRecord(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => key in right && jsonEqual(left[key], right[key]))
  }
  return false
}

function hasId(item: Json): item is Record<string, Json> & { id: string } {
  return isRecord(item) && typeof item.id === 'string'
}

function allHaveIds(list: readonly Json[]): boolean {
  return list.every(hasId)
}

function mergeArrays(base: readonly Json[], local: readonly Json[], remote: readonly Json[]): Json {
  const identified = (base.length === 0 || allHaveIds(base)) && (local.length === 0 || allHaveIds(local)) && (remote.length === 0 || allHaveIds(remote))
  const objects = [...base, ...local, ...remote].every(isRecord)
  const anyItems = base.length + local.length + remote.length > 0
  if (anyItems && identified && objects) return mergeById(base as Record<string, Json>[], local as Record<string, Json>[], remote as Record<string, Json>[])
  if (anyItems && objects) return mergeAsSets(base, local, remote)
  // 원시값 배열(순서가 뜻을 갖는다): 한쪽만 바뀌었으면 그쪽, 둘 다면 local
  if (jsonEqual(local, remote)) return local
  if (jsonEqual(base, local)) return remote
  return local
}

function mergeById(
  base: readonly Record<string, Json>[],
  local: readonly Record<string, Json>[],
  remote: readonly Record<string, Json>[],
): Json {
  const key = (item: Record<string, Json>) => String(item.id)
  const baseById = new Map(base.map((item) => [key(item), item]))
  const localById = new Map(local.map((item) => [key(item), item]))
  const remoteIds = new Set(remote.map(key))
  const result: Json[] = []
  for (const remoteItem of remote) {
    const id = key(remoteItem)
    const baseItem = baseById.get(id)
    const localItem = localById.get(id)
    if (localItem === undefined) {
      // local 이 지웠다. 그 사이 remote 가 고쳤다면 남긴다
      if (baseItem !== undefined && jsonEqual(baseItem, remoteItem)) continue
      result.push(remoteItem)
      continue
    }
    result.push(mergeValue(baseItem, localItem, remoteItem))
  }
  for (const localItem of local) {
    const id = key(localItem)
    if (remoteIds.has(id)) continue
    const baseItem = baseById.get(id)
    // remote 가 지웠다. 그 사이 local 이 고쳤다면 남긴다
    if (baseItem !== undefined && jsonEqual(baseItem, localItem)) continue
    result.push(localItem)
  }
  return result
}

function mergeAsSets(base: readonly Json[], local: readonly Json[], remote: readonly Json[]): Json {
  const result: Json[] = []
  for (const item of remote) {
    const removedLocally = base.some((candidate) => jsonEqual(candidate, item)) && !local.some((candidate) => jsonEqual(candidate, item))
    if (!removedLocally) result.push(item)
  }
  for (const item of local) {
    if (result.some((candidate) => jsonEqual(candidate, item))) continue
    const removedRemotely = base.some((candidate) => jsonEqual(candidate, item)) && !remote.some((candidate) => jsonEqual(candidate, item))
    if (!removedRemotely) result.push(item)
  }
  return result
}

function emptyLike(value: Json): Json {
  if (Array.isArray(value)) return []
  if (isRecord(value)) return {}
  return undefined
}

/** base(이 창이 알던 내용)·local(쓰려는 내용)·remote(디스크의 현재 내용)를 합친다 */
export function mergeValue(base: Json, local: Json, remote: Json): Json {
  if (jsonEqual(local, remote)) return local
  if (jsonEqual(base, local)) return remote
  if (jsonEqual(base, remote)) return local
  if (Array.isArray(local) && Array.isArray(remote)) {
    return mergeArrays(Array.isArray(base) ? base : [], local, remote)
  }
  if (isRecord(local) && isRecord(remote)) {
    const baseRecord = isRecord(base) ? base : {}
    const keys = [...new Set([...Object.keys(remote), ...Object.keys(local)])]
    const merged: Record<string, Json> = {}
    for (const key of keys) {
      const inLocal = key in local
      const inRemote = key in remote
      const baseValue = baseRecord[key]
      if (inLocal && inRemote) {
        merged[key] = mergeValue(baseValue ?? emptyLike(local[key]), local[key], remote[key])
      } else if (inLocal) {
        // remote 에 없다: 처음부터 없었고 local 이 더했다면 남기고, remote 가 지웠다면 local 이 안 고친 한 지운다
        if (!(key in baseRecord) || !jsonEqual(baseRecord[key], local[key])) merged[key] = local[key]
      } else if (!(key in baseRecord) || !jsonEqual(baseRecord[key], remote[key])) {
        merged[key] = remote[key]
      }
    }
    return merged
  }
  return local
}

/** 글 모양(들여쓰기·끝 줄바꿈)을 local 에서 따라 한다 */
function stringify(value: Json, like: string): string {
  const pretty = /\n {2}"/u.test(like)
  const text = JSON.stringify(value, null, pretty ? 2 : undefined)
  return like.endsWith('\n') ? `${text}\n` : text
}

function parseOrNull(text: string | null): { ok: true; value: Json } | { ok: false } {
  if (text === null) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(text) as Json }
  } catch {
    return { ok: false }
  }
}

/**
 * 글(JSON) 단위 병합. local 이나 remote 가 JSON 이 아니면 null(병합할 수 없다 — 호출한 쪽이 충돌로 다룬다).
 * base 가 null 이면(처음부터 없던 파일) 빈 값에서 시작한 것으로 본다.
 */
export function mergeJsonText(base: string | null, local: string, remote: string): string | null {
  const parsedLocal = parseOrNull(local)
  const parsedRemote = parseOrNull(remote)
  const parsedBase = parseOrNull(base)
  if (!parsedLocal.ok || !parsedRemote.ok || !parsedBase.ok) return null
  if (jsonEqual(parsedLocal.value, parsedRemote.value)) return local
  if (jsonEqual(parsedBase.value, parsedLocal.value)) return remote
  return stringify(mergeValue(parsedBase.value ?? emptyLike(parsedLocal.value), parsedLocal.value, parsedRemote.value), local)
}

/**
 * 되돌리기·다시 하기를 병합으로 적용한다. 되돌리기는 「그 동작 직후 상태(after)」에서 「동작 전 상태(before)」로 가는 변화만
 * 현재 상태(current: 다른 창의 변경이 들어와 있을 수 있다)에 얹는다 — 옛 스냅숏으로 통째로 덮으면 남의 추가가 지워진다.
 * 다시 하기는 before·after 를 바꿔 부른다: applySnapshotChange(before, after, current)
 */
export function applySnapshotChange<T>(from: T, to: T, current: T): T {
  return mergeValue(from, to, current) as T
}
