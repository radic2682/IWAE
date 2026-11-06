import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { VisibleSourceReference } from '../core/workspaceSources'

interface Point {
  readonly x: number
  readonly y: number
}

interface TraceGeometry {
  readonly blockId: string
  readonly source: VisibleSourceReference
  readonly from: Point
  readonly to: Point
}

interface SourceTraceProps {
  sources: readonly VisibleSourceReference[]
}

function elementWithAttribute(attribute: string, value: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)]
    .find((element) => element.getAttribute(attribute) === value) ?? null
}

function centerY(rect: DOMRect): number {
  return rect.top + rect.height / 2
}

function intersectsViewport(target: DOMRect, pane: DOMRect): boolean {
  return target.bottom > pane.top
    && target.top < pane.bottom
    && target.right > pane.left
    && target.left < pane.right
}

function sourcePane(active: VisibleSourceReference): HTMLElement | null {
  return active.relation === 'markdown-excerpt'
    ? elementWithAttribute('data-markdown-pane', active.selection.path)
    : elementWithAttribute('data-pdf-pane', active.anchor.docId)
}

function sourceTarget(active: VisibleSourceReference): HTMLElement | null {
  return active.relation === 'markdown-excerpt'
    ? elementWithAttribute('data-markdown-source-target', active.blockId)
    : elementWithAttribute('data-pdf-source-target', active.blockId)
}

function geometry(active: VisibleSourceReference): TraceGeometry | null {
  const source = elementWithAttribute('data-canvas-block-id', active.blockId)
  const pane = sourcePane(active)
  if (source === null || pane === null) return null
  const sourceRect = source.getBoundingClientRect()
  // 캔버스에서 화면 밖으로 밀려난 블록은 잇지 않는다. 그 좌표는 옆 패널(PDF) 뒤라 선이 문서를 가로지른다
  const canvas = source.closest<HTMLElement>('.react-flow') ?? source.closest<HTMLElement>('.note-canvas')
  const canvasRect = canvas?.getBoundingClientRect()
  if (canvasRect !== undefined && !intersectsViewport(sourceRect, canvasRect)) return null
  const paneRect = pane.getBoundingClientRect()
  if (window.getComputedStyle(pane).visibility === 'hidden') return null
  const target = sourceTarget(active)
  const targetRect = target?.getBoundingClientRect()
  if (targetRect === undefined || !intersectsViewport(targetRect, paneRect)) return null
  // 문서가 캔버스 왼쪽이면 블록 왼쪽 끝 → 출처 오른쪽 끝, 오른쪽이면 블록 오른쪽 끝 → 출처 왼쪽 끝.
  // 블록 끝이 캔버스 밖이면 캔버스 가장자리에서 시작한다
  const documentOnLeft = targetRect.right <= sourceRect.left || paneRect.right <= (canvasRect?.left ?? sourceRect.left)
  const from = documentOnLeft
    ? { x: Math.max(sourceRect.left, canvasRect?.left ?? sourceRect.left), y: centerY(sourceRect) }
    : { x: Math.min(sourceRect.right, canvasRect?.right ?? sourceRect.right), y: centerY(sourceRect) }
  const to = documentOnLeft
    ? { x: targetRect.right, y: centerY(targetRect) }
    : { x: targetRect.left, y: centerY(targetRect) }
  // 그래도 선이 거꾸로 가면(블록과 출처가 겹쳐 있음) 잇지 않는다
  if (documentOnLeft ? to.x > from.x : to.x < from.x) return null
  return { blockId: active.blockId, source: active, from, to }
}

function tracePath({ from, to }: TraceGeometry): string {
  const middleX = (from.x + to.x) / 2
  return `M ${from.x} ${from.y} C ${middleX} ${from.y}, ${middleX} ${to.y}, ${to.x} ${to.y}`
}

export function SourceTrace({ sources }: SourceTraceProps) {
  const [measured, setMeasured] = useState<readonly TraceGeometry[]>([])
  const frameRef = useRef<number | null>(null)

  const measure = useCallback(() => {
    setMeasured(sources.map(geometry).filter((item): item is TraceGeometry => item !== null))
  }, [sources])

  useLayoutEffect(() => {
    measure()
    if (sources.length === 0) return

    const schedule = () => {
      if (frameRef.current !== null) return
      if (typeof requestAnimationFrame !== 'function') {
        measure()
        return
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        measure()
      })
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('iwae:canvas-geometry', schedule)
    document.addEventListener('scroll', schedule, true)

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    for (const active of sources) {
      const source = elementWithAttribute('data-canvas-block-id', active.blockId)
      const pane = sourcePane(active)
      const target = sourceTarget(active)
      if (source !== null) observer?.observe(source)
      if (pane !== null) observer?.observe(pane)
      if (target !== null) observer?.observe(target)
    }

    return () => {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('iwae:canvas-geometry', schedule)
      document.removeEventListener('scroll', schedule, true)
      observer?.disconnect()
      if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [measure, sources])

  if (measured.length === 0) return null

  return (
    <div className="source-trace-layer">
      <svg aria-hidden="true">
        {measured.map((trace) => (
          <path
            key={trace.blockId}
            data-testid={`source-trace-${trace.blockId}`}
            data-source-trace={trace.blockId}
            className={trace.source.selected ? 'source-trace-selected' : undefined}
            d={tracePath(trace)}
          />
        ))}
      </svg>
    </div>
  )
}
