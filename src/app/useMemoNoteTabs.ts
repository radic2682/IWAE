import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react'
import { memoNoteTitleOf, type MemoNoteEntry } from '../core/memoNote'
import { moveMemoNoteTabs, syncMemoNoteTabs, type PanesState } from './tabs'

/**
 * 노트 경로가 바뀌면(이름 바꾸기·옮기기·폴더 바꾸기) 그 노트를 탭으로 연 창의 탭도 새 경로·새 이름으로 따라가게 하는 콜백.
 * useMemoNotes 의 onMoved 에 넘긴다.
 */
export function useFollowMovedMemoNotes(setPanes: Dispatch<SetStateAction<PanesState>>): (moved: ReadonlyMap<string, string>) => void {
  return useCallback(
    (moved) => setPanes((current) => moveMemoNoteTabs(current, moved, memoNoteTitleOf)),
    [setPanes],
  )
}

/**
 * 노트 목록에 탭을 맞춘다: 지워진(휴지통·밖에서 지움) 노트의 탭은 닫고, 이름이 달라진 탭은 새 이름으로.
 * 목록을 다 읽기 전(loaded 가 false)에는 건드리지 않는다 — 세션에서 복원한 탭이 아직 못 읽은 노트라고 닫히지 않게.
 */
export function useSyncMemoNoteTabs(
  setPanes: Dispatch<SetStateAction<PanesState>>,
  loaded: boolean,
  entries: readonly MemoNoteEntry[],
): void {
  useEffect(() => {
    if (!loaded) return
    const titles = new Map(entries.map((entry) => [entry.path, entry.title] as const))
    setPanes((current) => syncMemoNoteTabs(current, titles))
  }, [entries, loaded, setPanes])
}

