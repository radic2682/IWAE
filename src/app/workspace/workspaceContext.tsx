import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import type { MemoTicket } from '../../core/memoNote'
import type { MemoContent } from '../../pdf/MemoEditor'
import type { PersistentPdfHighlight, PersistentPdfHighlightPatch } from '../../pdf/persistentHighlight'
import type { PaneId } from './tabs'
import { DEFAULT_CHANNELS, channelOf, type Channel, type PaneChannel, type PaneChannels } from './workspaceChannels'
import { flashReaction, setHoverReaction } from './paneReaction'
import { emitPointSignal, paneReceives, pendingPointSignal, subscribePointSignal, type DeliveredSignal, type PointSignal, type PointTarget } from './workspaceSignal'

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
  /** memoNoteTargetFor 의 노트가 보이는 칸(칩을 눌러 어느 칸인지 깜빡여 알린다) */
  readonly memoNoteTargetPaneFor?: (pane: PaneId | null) => PaneId | null
  /** 노트 경로 → 보이는 이름(도구줄의 「→ 노트 이름」 칩) */
  readonly memoNoteTitleOf?: (path: string) => string
  /** pane 과 같은 채널 창에서 지금 보이는 메모 노트 경로들(「열린 노트 표시만 보기」) */
  readonly visibleNotePathsFor: (pane: PaneId | null) => readonly string[]
  /** 미리보기 탭을 보통 탭으로 고정한다(탭 안에서 고치기 시작했을 때) */
  readonly pinTab: (tabId: string) => void
  /**
   * 문서 창 pane 옆에 메모 노트를 연다(「옆에 노트 열기」와 같다): notePath 가 없으면 마지막으로 만진 노트 → 이 문서의 노트 → 새 노트.
   * 이미 같은 색 창에 보이면 그대로다. 연 노트의 경로(못 열면 null) — 새 메모의 초안이 갈 곳
   */
  readonly openNoteBeside: (pane: PaneId | null, notePath?: string) => Promise<string | null>
  /** 노트를 열지 않고 어느 노트에 넣을지만 정한다(openNoteBeside 와 같은 순서, 탭은 놓지 않는다). 영역 캡처를 조용히 넣을 때 쓴다. 못 구하면 null */
  readonly resolveNoteFor: (pane: PaneId | null) => Promise<string | null>
  /** 색이 없는 문서 창에서 누른 형광펜: 그 메모의 노트(없으면 마지막으로 만진 노트)를 옆에 열고 그 카드를 보인다 */
  readonly revealMemo: (pane: PaneId | null, memoId: string) => void
  /** pane 과 같은 색 창에 보이는 캔버스에 그 메모에 이어진 블록이 있는가(있으면 노트를 따로 열지 않고 캔버스가 그 블록을 보인다) */
  readonly canvasShowsMemo?: (pane: PaneId | null, memoId: string) => boolean
  /** pane 에서 target 을 가리키면(누르면) 움직일 같은 색 창들과 그 채널 색(마우스를 올린 동안의 윤곽용). 없으면 윤곽이 없다 */
  readonly reactionPanesFor?: (pane: PaneId, target: PointTarget) => ReadonlyMap<PaneId, Channel>
}

const NO_PATHS: readonly string[] = []

export const NO_WORKSPACE_LINK: WorkspaceLink = {
  channels: DEFAULT_CHANNELS,
  memoNoteTargetFor: () => null,
  visibleNotePathsFor: () => NO_PATHS,
  pinTab: () => undefined,
  openNoteBeside: () => Promise.resolve(null),
  resolveNoteFor: () => Promise.resolve(null),
  revealMemo: () => undefined,
}

export const WorkspaceContext = createContext<WorkspaceLink>(NO_WORKSPACE_LINK)

export function useWorkspaceLink(): WorkspaceLink {
  return useContext(WorkspaceContext)
}

/** 이 화면이 놓인 창과 그 창의 색 채널 */
export function usePaneChannel(): { readonly pane: PaneId | null; readonly channel: PaneChannel } {
  const pane = useContext(PaneIdContext)
  const { channels } = useContext(WorkspaceContext)
  return { pane, channel: pane === null ? null : channelOf(channels, pane) }
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
      if (handlerRef.current(signal)) {
        handledRef.current = signal.seq
        // 신호가 이 창을 실제로 움직였다: 채널 색 윤곽을 잠깐(0.6초) 켰다가 끈다
        flashReaction(pane, channel)
      }
    }
    const unsubscribe = subscribePointSignal(accept)
    const pending = pendingPointSignal(handledRef.current)
    if (pending !== null) accept(pending)
    return unsubscribe
  }, [pane, channel, key])
}

/**
 * 메모(형광펜) 위에 마우스를 올렸다 / 떠났다(null)를 알린다: 누르면 신호를 받아 움직일 같은 색의 다른 창에 채널 색 안쪽 윤곽이 생긴다(paneReaction).
 * 창 틀 밖이거나 채널이 없으면 아무것도 하지 않는다. 쓰던 화면이 사라질 때 윤곽도 거둔다.
 */
export function useMemoHoverReporter(): (memoId: string | null) => void {
  const { pane } = usePaneChannel()
  const workspace = useWorkspaceLink()
  const workspaceRef = useRef(workspace)
  workspaceRef.current = workspace
  useEffect(() => () => setHoverReaction(null), [])
  return useCallback((memoId) => {
    if (pane === null || memoId === null) { setHoverReaction(null); return }
    setHoverReaction(workspaceRef.current.reactionPanesFor?.(pane, { kind: 'memo', memoId }) ?? null)
  }, [pane])
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
 * 문서 창에서 누른 형광펜을 노트에서 보인다: 같은 색 창에 메모 노트가 보이면 가리키기 신호로(그 창이 카드를 연다),
 * 아니면(색이 없는 창 포함) 그 메모의 노트를 문서 창 옆에 열고 보인다.
 */
export function useRevealMemo(): (memoId: string) => void {
  const { pane, channel } = usePaneChannel()
  const workspace = useWorkspaceLink()
  const send = useMemoPointSender()
  return useCallback((memoId) => {
    if (pane === null) return
    if (channel !== null && (workspace.visibleNotePathsFor(pane).length > 0 || workspace.canvasShowsMemo?.(pane, memoId) === true)) send(memoId, 'document')
    else workspace.revealMemo(pane, memoId)
  }, [channel, pane, send, workspace])
}

/**
 * 원문 더하기 요청: 노트 탭의 메모 카드가 「원문 더하기」를 눌렀다. 다음에 문서 창에서 고른 글(영역)이 그 카드의 원문이 된다.
 * 어느 노트의 어느 카드인지(path·key)만 기억하고, 고른 것을 받는 쪽은 PdfPane·MarkdownPane 이다.
 */
export interface AttachRequest {
  /** 카드가 있는 노트(Vault 상대 경로) */
  readonly path: string
  /** 노트 안의 카드(블록) id */
  readonly key: string
}

let attachRequest: AttachRequest | null = null
const attachListeners = new Set<() => void>()

/** 원문 더하기 요청을 내거나(null 이면 거둔다) */
export function setAttachRequest(next: AttachRequest | null): void {
  attachRequest = next
  for (const listener of [...attachListeners]) listener()
}

export function getAttachRequest(): AttachRequest | null {
  return attachRequest
}

function subscribeAttach(listener: () => void): () => void {
  attachListeners.add(listener)
  return () => { attachListeners.delete(listener) }
}

/** 지금 원문을 더하는 중인 카드(없으면 null) */
export function useAttachRequest(): AttachRequest | null {
  return useSyncExternalStore(subscribeAttach, getAttachRequest, getAttachRequest)
}

/**
 * 문서 창에서 만들고 있는 새 메모를 같은 채널의 메모 노트 탭이 카드로 보여 주고 거기서 쓰게 하는 연결(설계 3.4).
 * 새 메모(초안)는 문서 창이 갖고 있다 — 글을 써야 저장되고, 비워 두면 사라지는 규칙도 그대로다.
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
