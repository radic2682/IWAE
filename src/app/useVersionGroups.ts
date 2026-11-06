import { useCallback, useEffect, useRef, useState } from 'react'
import { readVersionGroups, writeVersionGroups, type VaultHandle } from '../bridge/vault'
import {
  addVersion, createGroup, createSingleGroup, dissolveGroup, remapFolderVersions, groupOfDoc, removeVersion, renameGroup, renameVersion, setDefaultVersion,
  type VersionGroup,
} from '../core/versionGroups'

type Groups = Readonly<Record<string, VersionGroup>>

/** 문서 판 묶음. `.iwae/versions.json` 에 두고 쓰기는 하나씩 줄을 세운다(서지·출처와 같은 방식) */
export function useVersionGroups(vault: VaultHandle | null) {
  const [groups, setGroups] = useState<Groups>({})
  const ref = useRef<Groups>({})
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let active = true
    ref.current = {}
    setGroups({})
    if (vault === null) return () => { active = false }
    void readVersionGroups(vault)
      .then((file) => {
        if (!active) return
        ref.current = file.groups
        setGroups(file.groups)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [vault])

  const commit = useCallback((next: Groups) => {
    if (next === ref.current) return
    ref.current = next
    setGroups(next)
    if (vault === null) return
    const handle = vault
    queueRef.current = queueRef.current.catch(() => undefined).then(() => writeVersionGroups(handle, { version: 1, groups: next }))
  }, [vault])

  /** base 위에 added 를 판으로 겹친다. 이미 묶인 문서면 false */
  const stack = useCallback((base: { docId: string; title: string; label: string }, added: { docId: string; label: string }): boolean => {
    const existing = groupOfDoc(ref.current, base.docId)
    if (existing !== null) {
      const next = addVersion(ref.current, existing.id, added)
      if (next === ref.current) return false
      commit(next)
      return true
    }
    const created = createGroup(ref.current, base, added)
    if (created === null) return false
    commit(created.groups)
    return true
  }, [commit])

  /** 판 관리 시작: 이 문서 하나로 묶음을 만든다 */
  const start = useCallback((base: { docId: string; title: string; label: string }): boolean => {
    const created = createSingleGroup(ref.current, base)
    if (created === null) return false
    commit(created.groups)
    return true
  }, [commit])

  // 폴더를 옮기거나 이름을 바꾸면(useVault 가 알린다) 폴더 판도 따라간다
  useEffect(() => {
    const onMoved = (event: Event) => {
      const detail = (event as CustomEvent<{ from: string; to: string }>).detail
      if (detail !== undefined) commit(remapFolderVersions(ref.current, detail.from, detail.to))
    }
    window.addEventListener('iwae:folder-moved', onMoved)
    return () => window.removeEventListener('iwae:folder-moved', onMoved)
  }, [commit])

  return {
    groups,
    stack,
    start,
    removeVersion: useCallback((docId: string) => commit(removeVersion(ref.current, docId)), [commit]),
    dissolve: useCallback((groupId: string) => commit(dissolveGroup(ref.current, groupId)), [commit]),
    setDefault: useCallback((docId: string) => commit(setDefaultVersion(ref.current, docId)), [commit]),
    renameVersion: useCallback((docId: string, label: string) => commit(renameVersion(ref.current, docId, label)), [commit]),
    renameGroup: useCallback((groupId: string, title: string) => commit(renameGroup(ref.current, groupId, title)), [commit]),
    forgetDocs: useCallback((docIds: ReadonlySet<string>) => {
      let next = ref.current
      for (const docId of docIds) next = removeVersion(next, docId)
      commit(next)
    }, [commit]),
  }
}
