import { useEffect, useRef, useSyncExternalStore } from 'react'
import { getLinkLayerState, requestPaneLinks, setLinkLayerElement, subscribeLinkLayer, type LinkLine } from './workspaceLinks'
import '../../ui/workspace-links.css'

/** 점선(lead)이 끝나고 곡선이 시작하는 경계에서 곡선이 꺾이는 자리: 경계와 카드 가장자리 사이의 가운데 */
export function linkLinePath(line: LinkLine): { readonly lead: string; readonly curve: string } {
  const bend = line.edgeX + (line.cardX - line.edgeX) / 2
  return {
    lead: `M ${line.startX} ${line.y} H ${line.edgeX}`,
    curve: `M ${line.edgeX} ${line.y} C ${bend} ${line.y}, ${bend} ${line.cardY}, ${line.cardX} ${line.cardY}`,
  }
}

/**
 * 작업 공간 층: 문서 창과 이웃한 메모 노트 창 사이의 연결선을 모든 창 위에 한 겹으로 그린다.
 * 포인터를 가로채지 않는다. 그릴 선은 store(workspaceLinks)가 프레임에 한 번 셈해 내놓는다 — 이 컴포넌트는 그것만 그린다.
 * 선 좌표는 화면 기준이라 이 층의 왼쪽 위(origin)를 빼서 그린다.
 */
export function WorkspaceLinkLayer() {
  const ref = useRef<SVGSVGElement | null>(null)
  const { originX, originY, lines } = useSyncExternalStore(subscribeLinkLayer, getLinkLayerState, getLinkLayerState)
  useEffect(() => {
    setLinkLayerElement(ref.current)
    // 창 크기·칸막이 끌기가 끝난 뒤에는 칸 자리가 바뀌었으니 다시 잰다
    const again = () => requestPaneLinks()
    window.addEventListener('resize', again)
    window.addEventListener('iwae:pane-resize-end', again)
    const observer = typeof ResizeObserver === 'undefined' || ref.current === null ? null : new ResizeObserver(again)
    if (ref.current !== null) observer?.observe(ref.current)
    return () => {
      window.removeEventListener('resize', again)
      window.removeEventListener('iwae:pane-resize-end', again)
      observer?.disconnect()
      setLinkLayerElement(null)
    }
  }, [])
  return (
    <svg ref={ref} className="workspace-link-layer" aria-hidden="true">
      <g transform={`translate(${-originX} ${-originY})`}>
        {lines.map((line) => {
          const { lead, curve } = linkLinePath(line)
          return (
            <g key={line.key} className={`workspace-link${line.active ? ' workspace-link-active' : ''}`} data-hl={line.color} data-side={line.side}>
              <path className="workspace-link-lead" d={lead} />
              <path className="workspace-link-curve" d={curve} />
              <circle className="workspace-link-dot" cx={line.startX} cy={line.y} r={line.active ? 3 : 2.2} />
              <circle className="workspace-link-edge" cx={line.edgeX} cy={line.y} r={2} />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
