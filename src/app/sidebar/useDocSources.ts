import { useCallback, useEffect, useRef, useState } from 'react'
import { docSourcesCodec, readDocSources, subscribeVaultFile, writeDocSources, type VaultHandle } from '../../bridge/vault'
import { addSource, createDocSource, type DocSource } from '../../core/docSources'

/**
 * 문서별 원본 출처. Vault 가 있으면 `.iwae/sources.json` 에 두고, 쓰기는 하나씩 줄을 세운다
 * (서지 정보와 같은 방식). 판(version)이 생기면 판 id 가 열쇠다.
 */
export function useDocSources(vault: VaultHandle | null) {
  const [sources, setSources] = useState<Readonly<Record<string, readonly DocSource[]>>>({})
  const ref = useRef<Readonly<Record<string, readonly DocSource[]>>>({})

  useEffect(() => {
    let active = true
    ref.current = {}
    setSources({})
    if (vault === null) return () => { active = false }
    void readDocSources(vault)
      .then((file) => {
        if (!active) return
        ref.current = file.sources
        setSources(file.sources)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [vault])

  // 다른 창이 출처를 고치면 이 창에 합친다
  useEffect(() => {
    if (vault === null) return undefined
    return subscribeVaultFile(vault, 'sources.json', docSourcesCodec, (rebase) => {
      const next = rebase({ version: 1, sources: ref.current }).sources
      if (next === ref.current) return
      ref.current = next
      setSources(next)
    })
  }, [vault])

  const commit = useCallback((next: Readonly<Record<string, readonly DocSource[]>>) => {
    // 비어 버린 문서는 열쇠를 지운다
    const cleaned = Object.fromEntries(Object.entries(next).filter(([, list]) => list.length > 0))
    ref.current = cleaned
    setSources(cleaned)
    if (vault === null) return
    void writeDocSources(vault, { version: 1, sources: cleaned }).catch(() => undefined)
  }, [vault])

  /** 출처를 더한다. 같은 주소가 이미 있으면 더하지 않고 false */
  const add = useCallback((docId: string, input: { label?: string; target: string; note?: string }): boolean => {
    const current = ref.current[docId] ?? []
    const next = addSource(current, createDocSource(input))
    if (next === current) return false
    commit({ ...ref.current, [docId]: next })
    return true
  }, [commit])

  const update = useCallback((docId: string, sourceId: string, patch: { label?: string; target?: string; note?: string }) => {
    const list = ref.current[docId] ?? []
    commit({
      ...ref.current,
      [docId]: list.map((item) => {
        if (item.id !== sourceId) return item
        const note = (patch.note ?? item.note ?? '').trim()
        const { note: _old, ...rest } = item
        return { ...rest, label: (patch.label ?? item.label).trim(), target: (patch.target ?? item.target).trim(), ...(note === '' ? {} : { note }) }
      }),
    })
  }, [commit])

  const remove = useCallback((docId: string, sourceId: string) => {
    commit({ ...ref.current, [docId]: (ref.current[docId] ?? []).filter((item) => item.id !== sourceId) })
  }, [commit])

  /** 문서가 Vault 에서 지워졌을 때 */
  const forget = useCallback((docId: string) => {
    if (ref.current[docId] === undefined) return
    const { [docId]: _gone, ...rest } = ref.current
    commit(rest)
  }, [commit])

  return { sources, add, update, remove, forget }
}
