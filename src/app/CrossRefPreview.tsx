import { useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowRight } from '@phosphor-icons/react'
import { pageImageUrl, pageTextIndex, pdfOutline } from '../bridge/pdf'
import { resolveGoto, type GotoHit, type GotoTarget } from '../core/pdfGoto'
import type { PageTextIndex } from '../core/textIndex'
import '../ui/crossref-preview.css'
import { t } from '../i18n'

/** 마우스를 멈추고 이만큼 지나야 미리보기를 연다 — 지나가는 커서마다 뜨면 시끄럽다 */
const HOVER_DELAY_MS = 280
/** 미리보기 그림 폭(CSS px) */
const PREVIEW_WIDTH = 460
const PREVIEW_HEIGHT = 260

interface FoundReference {
  readonly label: string
  readonly target: GotoTarget
}

/**
 * 커서 밑 글자 둘레에서 상호참조를 찾는다: "Table 52", "Figure 6-3", "Section 5.1.9.3",
 * "clause 13.7", "§13.7". 커서가 그 낱말 위에 있을 때만 돌려준다.
 */
export function referenceAt(text: string, index: number): FoundReference | null {
  const from = Math.max(0, index - 40)
  const window = text.slice(from, index + 40)
  const local = index - from
  const patterns: readonly [RegExp, (match: RegExpMatchArray) => FoundReference][] = [
    [/\b(Table|Figure)\s+([A-Z]?\d+(?:[-.]\d+)*)/gu, (match) => ({
      label: `${match[1]} ${match[2]}`,
      target: { kind: 'caption', label: match[1] === 'Figure' ? 'Figure' : 'Table', number: match[2]! },
    })],
    [/\b(?:[Ss]ection|[Cc]lause|§)\s*((?:\d+|[A-Z])(?:\.\d+)+)/gu, (match) => ({
      label: `§${match[1]}`,
      target: { kind: 'section', number: match[1]! },
    })],
  ]
  for (const [pattern, build] of patterns) {
    for (const match of window.matchAll(pattern)) {
      const start = match.index
      const end = start + match[0].length
      if (local >= start && local < end) return build(match)
    }
  }
  return null
}

interface Preview {
  readonly label: string
  readonly hit: GotoHit
  readonly y: number
  readonly x: number
  /** 그 쪽에서 목표 자리의 위쪽(PDF 포인트) */
  readonly targetTop: number
}

interface CrossRefPreviewProps {
  hostRef: RefObject<HTMLElement | null>
  docId: string
  pageCount: number
  pageSizes: readonly (readonly [number, number])[]
  /** 미리보기를 눌렀을 때. 그 자리로 가고 범위를 칠한다 */
  onJump: (hit: GotoHit) => void
  enabled: boolean
}

/**
 * PDF 본문의 상호참조에 마우스를 올리면 그 표·그림·절을 작은 창으로 보여 준다.
 * 눌러서 그리로 가고, 마우스 뒤로 단추로 돌아온다.
 */
export function CrossRefPreview({ hostRef, docId, pageCount, pageSizes, onJump, enabled }: CrossRefPreviewProps) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const indexes = useRef(new Map<number, Promise<PageTextIndex>>())
  const resolved = useRef(new Map<string, Promise<GotoHit | null>>())
  const overPopover = useRef(false)
  const timer = useRef<number | null>(null)
  const activeLabel = useRef<string | null>(null)

  useEffect(() => {
    indexes.current = new Map()
    resolved.current = new Map()
    setPreview(null)
  }, [docId])

  useEffect(() => {
    const host = hostRef.current
    if (host === null || !enabled) return
    const pageIndex = (page: number) => {
      let pending = indexes.current.get(page)
      if (pending === undefined) {
        pending = pageTextIndex(docId, page)
        indexes.current.set(page, pending)
      }
      return pending
    }
    const resolve = (target: GotoTarget, label: string, nearPage: number) => {
      let pending = resolved.current.get(label)
      if (pending === undefined) {
        pending = resolveGoto(target, {
          pageCount,
          nearPage,
          outline: () => pdfOutline(docId),
          pageText: (page) => pageIndex(page).then((index) => index.text),
        }).catch(() => null)
        resolved.current.set(label, pending)
      }
      return pending
    }
    const inspect = async (clientX: number, clientY: number) => {
      const slot = document.elementsFromPoint(clientX, clientY)
        .find((element): element is HTMLElement => element instanceof HTMLElement && element.dataset.page !== undefined && element.classList.contains('pdf-page-slot'))
      if (slot === undefined || slot.classList.contains('pdf-page-rotated')) return close()
      const page = Number(slot.dataset.page)
      const size = pageSizes[page]
      if (size === undefined) return close()
      const rect = slot.getBoundingClientRect()
      const scale = rect.width / size[0]
      const x = (clientX - rect.left) / scale
      const y = (clientY - rect.top) / scale
      const index = await pageIndex(page).catch(() => null)
      if (index === null) return close()
      const charIndex = index.chars.findIndex((char) => char.w > 0 && x >= char.x - 0.5 && x <= char.x + char.w + 0.5 && y >= char.y - 1 && y <= char.y + char.h + 1)
      if (charIndex < 0) return close()
      const reference = referenceAt(index.text, charIndex)
      if (reference === null) return close()
      if (activeLabel.current === reference.label && preview !== null) return
      activeLabel.current = reference.label
      const hit = await resolve(reference.target, reference.label, page)
      if (activeLabel.current !== reference.label) return
      if (hit === null) return close()
      let targetTop = 0
      if (hit.range !== undefined) {
        const targetIndex = await pageIndex(hit.pageIndex).catch(() => null)
        const char = targetIndex?.chars[hit.range[0]]
        if (char !== undefined) targetTop = char.y
      }
      setPreview({ label: reference.label, hit, x: clientX, y: clientY, targetTop })
    }
    const close = () => {
      if (overPopover.current) return
      activeLabel.current = null
      setPreview(null)
    }
    const onMove = (event: PointerEvent) => {
      if (event.buttons !== 0) return
      if (timer.current !== null) window.clearTimeout(timer.current)
      const { clientX, clientY } = event
      timer.current = window.setTimeout(() => { void inspect(clientX, clientY) }, HOVER_DELAY_MS)
    }
    const onLeave = () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      window.setTimeout(close, 150)
    }
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)
    return () => {
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
    // preview 는 같은 참조 위에서 다시 열지 않으려고 읽기만 한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, enabled, hostRef, pageCount, pageSizes])

  if (preview === null) return null
  const size = pageSizes[preview.hit.pageIndex]
  const scale = size === undefined ? 1 : PREVIEW_WIDTH / size[0]
  const offset = Math.max(0, preview.targetTop * scale - 28)
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  // 화면 아래쪽이면 위로 연다
  const below = preview.y + 24 + PREVIEW_HEIGHT + 40 < window.innerHeight
  const left = Math.min(Math.max(8, preview.x - PREVIEW_WIDTH / 2), window.innerWidth - PREVIEW_WIDTH - 12)
  const top = below ? preview.y + 18 : preview.y - PREVIEW_HEIGHT - 52

  return (
    <div
      className="crossref-preview"
      role="dialog"
      aria-label={t('{label} 미리보기', { label: preview.label })}
      style={{ left, top, width: PREVIEW_WIDTH }}
      onPointerEnter={() => { overPopover.current = true }}
      onPointerLeave={() => {
        overPopover.current = false
        activeLabel.current = null
        setPreview(null)
      }}
    >
      <button
        type="button"
        className="crossref-preview-head"
        onClick={() => {
          onJump(preview.hit)
          overPopover.current = false
          setPreview(null)
        }}
      >
        <span className="crossref-preview-label">{preview.label}</span>
        <span className="crossref-preview-page">p.{preview.hit.pageIndex + 1}</span>
        <span className="crossref-preview-go">{t('이동')} <ArrowRight size={12} aria-hidden="true" /></span>
      </button>
      <div
        className="crossref-preview-body"
        style={{ height: PREVIEW_HEIGHT }}
        onClick={() => {
          onJump(preview.hit)
          overPopover.current = false
          setPreview(null)
        }}
      >
        <img
          src={pageImageUrl(docId, preview.hit.pageIndex, Math.round(PREVIEW_WIDTH * ratio))}
          alt=""
          draggable={false}
          style={{ width: PREVIEW_WIDTH, transform: `translateY(${-offset}px)` }}
        />
      </div>
    </div>
  )
}
