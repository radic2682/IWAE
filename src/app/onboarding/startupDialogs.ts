import { useEffect, useSyncExternalStore } from 'react'

/**
 * 시작할 때 저절로 뜨는 대화상자(새 버전 안내, 접두키 고르기 …)의 순서 정리.
 * 둘 이상이 한꺼번에 해당하면 하나씩, 앞 것이 닫힌 뒤에 다음 것이 뜬다. 겹쳐 뜨지 않는다.
 *
 * 쓰는 법: 대화상자를 그리는 컴포넌트에서
 *   const open = useStartupDialog('prefix-keys', needsPrefixDialog)
 * 를 부르고 `open` 일 때만 그린다. 해당 여부(wanted)가 false 가 되면(닫음·건너뜀) 자리를 내놓고 다음 것이 뜬다.
 * priority 가 작을수록 먼저, 같으면 먼저 줄 선 것이 먼저다.
 */
interface Entry { readonly id: string; readonly priority: number; readonly seq: number }

let entries: readonly Entry[] = []
let sequence = 0
const listeners = new Set<() => void>()

function head(): string | null {
  return entries[0]?.id ?? null
}

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function request(id: string, priority: number): void {
  if (entries.some((entry) => entry.id === id)) return
  sequence += 1
  entries = [...entries, { id, priority, seq: sequence }].sort((a, b) => a.priority - b.priority || a.seq - b.seq)
  emit()
}

function release(id: string): void {
  if (!entries.some((entry) => entry.id === id)) return
  entries = entries.filter((entry) => entry.id !== id)
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 이 대화상자가 지금 뜰 차례인가. wanted 가 false 면 줄에 서지 않는다 */
export function useStartupDialog(id: string, wanted: boolean, priority = 50): boolean {
  const current = useSyncExternalStore(subscribe, head, head)
  useEffect(() => {
    if (!wanted) return undefined
    request(id, priority)
    return () => release(id)
  }, [id, wanted, priority])
  return wanted && current === id
}

/** 시험용: 줄을 비운다 */
export function resetStartupDialogs(): void {
  entries = []
  sequence = 0
  emit()
}
