import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import type { MemoTicket } from '../core/memoNote'
import type { MemoContent } from '../pdf/MemoColumn'
import type { PersistentPdfHighlight, PersistentPdfHighlightPatch } from '../pdf/persistentHighlight'
import type { PaneId } from './tabs'
import { DEFAULT_CHANNELS, type PaneChannel, type PaneChannels } from './workspaceChannels'
import { emitPointSignal, paneReceives, pendingPointSignal, subscribePointSignal, type DeliveredSignal, type PointSignal } from './workspaceSignal'

/**
 * 작업 공간을 창 안쪽 화면(PDF·Markdown·메모 노트)에 알리는 손잡이.
 * App 이 채우고, 창 안의 화면은 자기 창(PaneIdContext)·채널·같은 채널에 보이는 노트를 여기서 읽는다.
 * 창 틀 밖(시험·단독)에서는 창 이름이 없어 아무 신호도 받지 않는다.
 */
export const PaneIdContext = createContext<PaneId | null>(null)

export interface WorkspaceLink {
  readonly channels: PaneChannels
  /** pane 과 같은 채널 창에서 지금 보이는 메모 노트 탭(새 메모가 갈 곳). 없으면 null */
  readonly memoNoteTargetFor: (pane: PaneId | null) => string | null
  /** pane 과 같은 채널 창에서 지금 보이는 메모 노트 경로들(「열린 노트 표시만 보기」) */
  readonly visibleNotePathsFor: (pane: PaneId | null) => readonly string[]
  /** 미리보기 탭을 보통 탭으로 고정한다(탭 안에서 고치기 시작했을 때) */
  readonly pinTab: (tabId: string) => void
}

const NO_PATHS: readonly string[] = []

export const NO_WORKSPACE_LINK: WorkspaceLink = {
  channels: DEFAULT_CHANNELS,
  memoNoteTargetFor: () => null,
  visibleNotePathsFor: () => NO_PATHS,
  pinTab: () => undefined,
}

export const WorkspaceContext = createContext<WorkspaceLink>(NO_WORKSPACE_LINK)

export function useWorkspaceLink(): WorkspaceLink {
  return useContext(WorkspaceContext)
}

/** 이 화면이 놓인 창과 그 창의 색 채널 */
export function usePaneChannel(): { readonly pane: PaneId | null; readonly channel: PaneChannel } {
  const pane = useContext(PaneIdContext)
  const { channels } = useContext(WorkspaceContext)
  return { pane, channel: pane === null ? null : channels[pane] }
}

/**
 * 가리키기 신호를 받는다. 이 창과 채널이 같은 창이 보낸 신호만 오고(보낸 창 자신은 건너뜀),
 * handler 가 true 를 돌려주면 처리한 것이다 — false(내 문서·노트가 아님)면 같은 신호를 나중에 다시 받을 수 있다:
 * 탭이 막 바뀌어 늦게 열린 화면이 (TTL 안에) 놓친 신호를 받도록 key 가 바뀔 때마다 마지막 신호를 다시 본다.
 */
export function usePointSignalReceiver(handler: (signal: DeliveredSignal) => boolean, key: unknown): void {
  const { pane, channel } = usePaneChannel()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const handledRef = useRef(0)
  useEffect(() => {
    if (pane === null) return undefined
    const accept = (signal: DeliveredSignal) => {
      if (signal.seq <= handledRef.current || !paneReceives(signal, pane, channel)) return
      if (handlerRef.current(signal)) handledRef.current = signal.seq
    }
    const unsubscribe = subscribePointSignal(accept)
    const pending = pendingPointSignal(handledRef.current)
    if (pending !== null) accept(pending)
    return unsubscribe
  }, [pane, channel, key])
}

/** 이 창이 보내는 신호: 메모(형광펜 id)를 가리킨다. 창 틀 밖이면 아무것도 하지 않는다 */
export function useMemoPointSender(): (memoId: string, origin: 'document' | 'note') => void {
  const { pane, channel } = usePaneChannel()
  return useCallback((memoId, origin) => {
    if (pane === null) return
    const signal: PointSignal = { from: pane, channel, target: { kind: 'memo', memoId }, reason: 'click', origin }
    emitPointSignal(signal)
  }, [pane, channel])
}

/**
 * 문서 창에서 만들고 있는 새 메모를 같은 채널의 메모 노트 탭이 카드로 보여 주고 거기서 쓰게 하는 연결(설계 3.4).
 * 새 메모(초안)는 문서 창이 갖고 있다 — 글을 써야 저장되고, 비워 두면 사라지는 규칙(노트 바와 같다)도 그대로다.
 * 노트 탭은 초안을 NoteFlow 의 새 메모 카드로 그리고, 쓰기·취소·색 바꾸기를 이 손잡이로 문서 창에 돌려준다.
 */
export interface RoutedMemoDraft {
  /** 만드는 중인 형광펜(저장 전) */
  readonly highlight: PersistentPdfHighlight
  /** 새 메모가 들어갈 노트(Vault 상대 경로) */
  readonly path: string
  /** 글을 저장한다: index 는 노트 안에서 끼울 자리(노트 탭이 정한다). 글이 비면 문서 창이 초안을 버린다 */
  readonly save: (content: MemoContent, ticket: MemoTicket | undefined, index: number) => void
  /** 쓰기를 그만둔다(빈 채로 포커스를 잃었을 때) */
  readonly cancel: () => void
  /** 쓰는 중에 색·별점을 바꾼다 */
  readonly patch: (patch: PersistentPdfHighlightPatch) => void
}

let routedDraft: RoutedMemoDraft | null = null
const draftListeners = new Set<() => void>()

/** 문서 창이 만드는 중인 새 메모를 알린다(null 이면 거둔다) */
export function setRoutedMemoDraft(draft: RoutedMemoDraft | null): void {
  routedDraft = draft
  for (const listener of [...draftListeners]) listener()
}

/** id 의 초안일 때만 거둔다(다른 창이 이어서 만든 초안을 지우지 않게) */
export function clearRoutedMemoDraft(id: string): void {
  if (routedDraft?.highlight.id === id) setRoutedMemoDraft(null)
}

export function getRoutedMemoDraft(): RoutedMemoDraft | null {
  return routedDraft
}

function subscribeDraft(listener: () => void): () => void {
  draftListeners.add(listener)
  return () => { draftListeners.delete(listener) }
}

/** path 노트로 가는 새 메모 초안(없으면 null) */
export function useRoutedMemoDraft(path: string): RoutedMemoDraft | null {
  const draft = useSyncExternalStore(subscribeDraft, getRoutedMemoDraft, getRoutedMemoDraft)
  return draft !== null && draft.path === path ? draft : null
}

/** 문서 창이 쓰는 훅: 새 메모를 같은 채널 노트 탭으로 보낸다. draft·path 가 있는 동안 알린다 */
export function usePublishRoutedMemoDraft(
  draft: PersistentPdfHighlight | null,
  path: string | null,
  handlers: Pick<RoutedMemoDraft, 'save' | 'cancel' | 'patch'>,
): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const active = draft !== null && path !== null
  const publishedIdRef = useRef<string | null>(null)
  // 색을 바꿔 초안 객체가 새로 만들어져도 노트 탭의 쓰던 카드가 사라졌다 다시 생기지 않게, 거두지 않고 덮어쓴다
  useEffect(() => {
    if (draft === null || path === null) return
    publishedIdRef.current = draft.id
    setRoutedMemoDraft({
      highlight: draft,
      path,
      save: (content, ticket, index) => handlersRef.current.save(content, ticket, index),
      cancel: () => handlersRef.current.cancel(),
      patch: (patch) => handlersRef.current.patch(patch),
    })
  }, [draft, path])
  useEffect(() => {
    if (active || publishedIdRef.current === null) return
    clearRoutedMemoDraft(publishedIdRef.current)
    publishedIdRef.current = null
  }, [active])
  useEffect(() => () => {
    if (publishedIdRef.current !== null) clearRoutedMemoDraft(publishedIdRef.current)
  }, [])
}
