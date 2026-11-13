import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import { BUNDLED_RELEASE_NOTES, planWhatsNew, type ReleaseNote } from '../../core/releaseNotes'
import { holeRect, placeCard, rectVisible, type TourRect } from '../../core/tourPlacement'
import { shownStepIndexes, tourById, type Tour, type TourFocus, type TourStep } from '../../core/tours'
import { t } from '../../i18n'
import { useFocusTrap } from '../../ui/useFocusTrap'
import { useStartupDialog } from './startupDialogs'
import { installSnapshot, markToursSeen, onTourRequest, planStartupTours, subscribeTourIntent, tourIntent } from './tourState'
import '../../ui/tour.css'
import '../../ui/shortcuts.css'

/** 시작 대화상자 줄의 이름과 차례: 「새 버전」(10), 접두키 고르기(50) 다음. 접두키를 고른 뒤라야 안내 글의 접두키가 맞다 */
export const TOUR_DIALOG_ID = 'tour'
const TOUR_PRIORITY = 60
/** 크기를 재기 전 카드 크기 짐작(CSS 의 폭과 같다) */
const GUESS_CARD = { width: 320, height: 180 } as const
/** 목표가 사라지거나 옮겨 간 것을 놓치지 않으려는 다시 재기 간격 */
const REMEASURE_MS = 400

function toRect(box: DOMRect): TourRect {
  return { left: box.left, top: box.top, width: box.width, height: box.height }
}

function sameRect(a: TourRect | null, b: TourRect | null): boolean {
  if (a === null || b === null) return a === b
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

/**
 * `data-tour` 값으로 목표를 찾는다. 같은 값이 여럿(칸마다 머리가 있다)이면 만지는 칸(`.pane-card-active`)의 것을 먼저,
 * 그다음 첫 번째로 보이는 것(크기가 있고 창 안)을 쓴다. 보이는 것이 없으면 null.
 */
export function resolveTourTarget(name: string, root: ParentNode = document): HTMLElement | null {
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const all = [...root.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)]
  const active = all.filter((element) => element.closest('.pane-card-active') !== null)
  const ordered = [...active, ...all.filter((element) => !active.includes(element))]
  return ordered.find((element) => element.closest('[inert]') === null && rectVisible(toRect(element.getBoundingClientRect()), viewport)) ?? null
}

/** 본문의 `{prefix}`(지금 접두키)와 `{k:키}` 자리를 키캡으로 바꿔 그린다. 조사는 키캡 바로 뒤에 붙는다 */
function renderBody(body: string, prefixText: string): ReactNode {
  const parts = t(body).split(/(\{prefix\}|\{k:[^}]+\})/u)
  return parts.map((part, index) => {
    if (part === '{prefix}') return <kbd key={index} className="keycap tour-keycap">{prefixText}</kbd>
    if (part.startsWith('{k:')) return <kbd key={index} className="keycap tour-keycap">{part.slice(3, -1)}</kbd>
    return <Fragment key={index}>{part}</Fragment>
  })
}

/** 둘러보기가 앱의 칸을 다루는 손잡이: 그 종류의 칸이 있는가 · 그 칸의 첫 번째를 만진다 */
export interface TourPanes {
  readonly has: (kind: TourFocus) => boolean
  readonly focus: (kind: TourFocus) => void
}

/** 이 단계를 보일 수 있는가: optional 이 아니면 늘, optional 이면 목표가 화면에 있거나(focus 단계는 그 종류의 칸이 있어 만지면 생길 것이면) */
function stepPresent(step: TourStep, panes: TourPanes | undefined): boolean {
  if (step.optional !== true) return true
  if (step.focus !== undefined && panes?.has(step.focus) === true) return true
  return step.target !== undefined && resolveTourTarget(step.target) !== null
}

interface TourOverlayProps {
  readonly tour: Tour
  readonly prefixText: string
  readonly panes?: TourPanes
  /** 번역이 켜져 있는가(번역기 단계의 글이 달라진다) */
  readonly translationOn?: boolean
  /** 끝까지 봤거나(마치기) 건너뛰었다(Esc · ×) */
  readonly onFinish: () => void
}

/**
 * 말풍선 둘러보기 화면. 목표 둘레만 뚫어 놓고 나머지를 어둡게 하며 옆에 카드를 둔다.
 * 안내만 한다: 어두운 곳도 뚫린 곳도 클릭을 통과시키지 않는다(둘러보다가 사용자 배치가 바뀌면 안 된다).
 * Esc 는 건너뛰기, → · Enter 는 다음, ← 는 이전.
 */
export function TourOverlay({ tour, prefixText, panes, translationOn = false, onFinish }: TourOverlayProps) {
  const [index, setIndex] = useState(0)
  // 목표를 못 찾아 건너뛰기로 한 optional 단계(focus 단계는 칸을 만진 뒤에야 목표가 생기므로 몇 번 재 보고 정한다)
  const [absent, setAbsent] = useState<readonly string[]>([])
  const [shown, setShown] = useState<readonly number[]>(() => shownStepIndexes(tour.steps, (candidate) => stepPresent(candidate, panes)))
  const direction = useRef<1 | -1>(1)
  const [target, setTarget] = useState<TourRect | null>(null)
  const [cardSize, setCardSize] = useState<{ width: number; height: number }>(GUESS_CARD)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const cardRef = useRef<HTMLDivElement | null>(null)
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const lastTarget = useRef<TourRect | null>(null)
  const step = tour.steps[Math.min(index, tour.steps.length - 1)]!
  const last = !shown.some((candidate) => candidate > index)
  useFocusTrap(cardRef)
  const panesRef = useRef(panes)
  panesRef.current = panes
  const absentRef = useRef(absent)
  absentRef.current = absent

  // 보일 단계 목록: optional 단계는 목표가 지금 화면에 있어야 센다. 가끔 다시 재서 진행 표시와 이전 · 다음이 같은 목록을 쓴다
  useLayoutEffect(() => {
    const update = () => {
      const next = shownStepIndexes(tour.steps, (candidate) => !absentRef.current.includes(candidate.id) && stepPresent(candidate, panesRef.current))
      setShown((previous) => (previous.length === next.length && previous.every((value, at) => value === next[at]) ? previous : next))
    }
    update()
    const timer = window.setInterval(update, REMEASURE_MS)
    return () => window.clearInterval(timer)
  }, [tour, absent])

  // 이 단계의 칸을 먼저 만진다(도구줄 · 서식바가 그 칸 것으로 바뀐다)
  useEffect(() => { if (step.focus !== undefined) panesRef.current?.focus(step.focus) }, [step])

  // 지금 단계가 보일 목록에서 빠졌다(목표가 사라짐): 가던 쪽의 다음 보이는 단계로, 없으면 반대쪽 · 끝
  useEffect(() => {
    if (shown.includes(index)) return
    const forward = shown.find((candidate) => candidate > index)
    const backward = [...shown].reverse().find((candidate) => candidate < index)
    const target = direction.current === 1 ? forward ?? backward : backward ?? forward
    if (target === undefined) onFinish()
    else setIndex(target)
  }, [index, onFinish, shown])

  // 목표 재기: 단계가 바뀔 때, 창 크기·스크롤이 바뀔 때, 목표 크기가 바뀔 때, 그리고 가끔(목표가 사라지면 가운데 카드로)
  useLayoutEffect(() => {
    let element: HTMLElement | null = null
    let observer: ResizeObserver | null = null
    let misses = 0
    const measure = (event?: unknown) => {
      const found = step.target === undefined ? null : resolveTourTarget(step.target)
      if (found !== element) {
        observer?.disconnect()
        element = found
        if (found !== null && typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(measure)
          observer.observe(found)
        }
      }
      // optional 단계가 가끔 재도 계속 비어 있으면 건너뛴다(처음 재는 것은 칸을 만지기 전이라 세지 않는다)
      if (step.optional === true && step.target !== undefined && found === null && event === 'tick') {
        misses += 1
        if (misses >= 2) setAbsent((current) => (current.includes(step.id) ? current : [...current, step.id]))
      } else if (found !== null) misses = 0
      const rect = found === null ? null : toRect(found.getBoundingClientRect())
      setTarget((previous) => (sameRect(previous, rect) ? previous : rect))
      setViewport((previous) => (previous.width === window.innerWidth && previous.height === window.innerHeight ? previous : { width: window.innerWidth, height: window.innerHeight }))
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const timer = window.setInterval(() => measure('tick'), REMEASURE_MS)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.clearInterval(timer)
      observer?.disconnect()
    }
  }, [step.id, step.optional, step.target])

  // 카드 크기: 글 길이에 따라 달라지므로 재서 자리 계산에 쓴다
  useLayoutEffect(() => {
    const card = cardRef.current
    if (card === null) return undefined
    const measure = () => {
      const width = card.offsetWidth
      const height = card.offsetHeight
      if (width === 0 || height === 0) return
      setCardSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    return () => observer.disconnect()
  }, [index])

  // 단계가 바뀔 때 주 단추로 초점(Enter 로 계속 넘길 수 있게)
  useEffect(() => { primaryRef.current?.focus({ preventScroll: true }) }, [index])

  const next = useCallback(() => {
    direction.current = 1
    const after = shown.find((candidate) => candidate > index)
    if (after === undefined) onFinish()
    else setIndex(after)
  }, [index, onFinish, shown])
  const previous = useCallback(() => {
    direction.current = -1
    const before = [...shown].reverse().find((candidate) => candidate < index)
    if (before !== undefined) setIndex(before)
  }, [index, shown])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      const eat = () => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation() }
      if (event.key === 'Escape') { eat(); onFinish(); return }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'ArrowRight') { eat(); next() }
      else if (event.key === 'ArrowLeft') { eat(); previous() }
      // 단추에 초점이 있으면 Enter 는 그 단추가 처리한다(이전 단추에서 Enter 는 이전)
      else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) { eat(); next() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [next, onFinish, previous])

  if (target !== null) lastTarget.current = target
  const hole = lastTarget.current === null ? null : holeRect(lastTarget.current)
  const place = placeCard(target, cardSize, viewport, step.placement)
  const total = shown.length
  const position = shown.filter((candidate) => candidate <= index).length
  const first = !shown.some((candidate) => candidate < index)
  const swallow = (event: { stopPropagation: () => void }) => event.stopPropagation()

  return createPortal(
    <div
      className="tour-layer"
      onPointerDown={swallow}
      onClick={swallow}
      onDoubleClick={swallow}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
      onWheel={swallow}
      onMouseDown={(event) => {
        event.stopPropagation()
        // 어두운 곳을 눌러도 초점이 카드에서 빠져나가지 않게
        if (!(event.target as HTMLElement).closest('.tour-card')) event.preventDefault()
      }}
    >
      <div className="tour-dim" data-on={target === null ? '' : undefined} />
      {hole === null ? null : (
        <div
          className="tour-hole"
          data-on={target === null ? undefined : ''}
          style={{ width: hole.width, height: hole.height, transform: `translate(${hole.left}px, ${hole.top}px)` }}
        />
      )}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-card-title"
        aria-describedby="tour-card-body"
        data-side={place.side ?? 'center'}
        data-parity={index % 2}
        style={{ left: place.left, top: place.top, '--tour-arrow': `${place.arrow}px` } as CSSProperties}
      >
        <button type="button" className="tour-close" aria-label={t('안내 닫기')} onClick={onFinish}>
          <X size={14} weight="bold" aria-hidden="true" />
        </button>
        <h2 id="tour-card-title" className="tour-title">{t(step.title)}</h2>
        <p id="tour-card-body" className="tour-body">{renderBody(translationOn && step.bodyWhenTranslationOn !== undefined ? step.bodyWhenTranslationOn : step.body, prefixText)}</p>
        <div className="tour-foot">
          <span className="tour-count">{position} / {total}</span>
          <div className="tour-actions">
            {first ? null : <button type="button" className="tour-button" onClick={previous}>{t('이전')}</button>}
            <button ref={primaryRef} type="button" className="tour-button tour-button-primary" onClick={next}>{last ? t('마치기') : t('다음')}</button>
          </div>
        </div>
        {place.side === null ? null : <span className="tour-arrow" aria-hidden="true" />}
        <div className="tour-sr" role="status" aria-live="polite">{`${position} / ${total}, ${t(step.title)}`}</div>
      </div>
    </div>,
    document.body,
  )
}

interface TourHostProps {
  /** 메인 창이고 시작이 끝났고 Vault 가 열려 칸이 그려졌을 때만 true */
  readonly enabled: boolean
  readonly version: string
  /** 지금 접두키 표기 */
  readonly prefixText: string
  readonly translationOn?: boolean
  /** 칸을 만지는 손잡이(없으면 focus 단계는 목표가 있을 때만 보인다) */
  readonly panes?: TourPanes
  /** 「새 버전」 창이 보일지 가늠하는 노트(시험에서 바꾼다) */
  readonly notes?: readonly ReleaseNote[]
}

/**
 * 둘러보기를 언제 띄울지 정한다.
 * - 저절로: enabled 가 처음 true 가 될 때 한 번 판단한다(처음 설치 → 처음 사용 안내, 업데이트 → 새 기능). 시작 대화상자 줄에 서서 「새 버전」·접두키 창과 겹치지 않는다.
 *   「새 버전」 창이 같이 뜨는 업데이트에서는 거기서 「새 기능 둘러보기」를 눌러야 시작한다. 「나중에」면 안 보이고 본 것으로 친다(재촉하지 않는다).
 * - 직접: 팔레트·메뉴가 requestTour 로 부른다. 본 적이 있어도 열린다.
 * 마치거나 건너뛰면 본 것으로 적는다.
 */
export function TourHost({ enabled, version, prefixText, translationOn = false, panes, notes = BUNDLED_RELEASE_NOTES }: TourHostProps) {
  const [queue, setQueue] = useState<readonly string[] | null>(null)
  const [manualId, setManualId] = useState<string | null>(null)
  const intent = useSyncExternalStore(subscribeTourIntent, tourIntent, tourIntent)

  useEffect(() => {
    if (!enabled || queue !== null) return
    const plan = planStartupTours(version)
    markToursSeen(plan.markSeen)
    setQueue(plan.run)
  }, [enabled, queue, version])

  useEffect(() => onTourRequest((id) => { if (tourById(id) !== undefined) setManualId(id) }), [])

  // 「새 버전」 창이 같이 뜨는 업데이트인가(그 창이 둘러보기를 시작할지 미룰지 정한다)
  const dialogPlanned = planWhatsNew(installSnapshot().lastSeenVersion, version, notes).kind === 'show'

  // 「나중에」: 쌓인 안내를 본 것으로 치고 비운다
  useEffect(() => {
    if (intent !== 'declined' || queue === null || queue.length === 0) return
    markToursSeen(queue)
    setQueue([])
  }, [intent, queue])

  const wanted = enabled && queue !== null && queue.length > 0 && (!dialogPlanned || intent === 'accepted')
  const turn = useStartupDialog(TOUR_DIALOG_ID, wanted, TOUR_PRIORITY)
  const activeId = manualId ?? (turn && queue !== null ? queue[0] ?? null : null)
  const tour = activeId === null ? undefined : tourById(activeId)

  const finish = useCallback(() => {
    if (activeId === null) return
    markToursSeen([activeId])
    if (manualId !== null) setManualId(null)
    else setQueue((current) => (current === null ? current : current.filter((id) => id !== activeId)))
  }, [activeId, manualId])

  if (tour === undefined) return null
  return <TourOverlay key={tour.id} tour={tour} prefixText={prefixText} panes={panes} translationOn={translationOn} onFinish={finish} />
}
