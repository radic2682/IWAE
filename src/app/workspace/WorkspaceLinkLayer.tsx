import { useEffect, useId, useRef, useSyncExternalStore } from 'react'
import { getLinkLayerState, requestPaneLinks, setLinkLayerElement, subscribeLinkLayer, type LinkLine, type LinkRect } from './workspaceLinks'
import '../../ui/workspace-links.css'

/** 곡선이 가로로 가는 최소 길이(px). 칸막이 틈은 좁아서(6px 안팎) 그대로 꺾으면 선이 칸 테두리를 따라 세로로 서 버린다 */
export const LINK_MIN_RUN = 56

/**
 * 선 한 줄의 길: 형광펜 끝에서 곧게 가다가 S 곡선으로 카드 가까운 쪽 가장자리까지 간다. 한 path 라 이음매가 없다.
 * 곡선은 문서 창 가장자리에서 카드 가장자리까지가 기본이고, 그 사이가 좁으면(이웃한 칸) 문서 쪽으로 더 일찍 꺾기 시작해
 * 최소 길이를 채운다(끝점은 그대로 형광펜과 카드 가장자리). 사이에 다른 칸이 있으면 길이가 충분해 그 칸 위를 지나간다.
 */
export function linkLinePath(line: LinkLine): string {
  const dir = line.cardX >= line.edgeX ? 1 : -1
  const span = Math.abs(line.cardX - line.edgeX)
  // 곡선 시작점: 가장자리에서 문서 안쪽으로 모자란 만큼 물러나되, 형광펜 끝을 넘지 않는다
  const back = Math.min(Math.max(0, LINK_MIN_RUN - span), Math.max(0, dir * (line.edgeX - line.startX)))
  const from = line.edgeX - dir * back
  const bend = from + (line.cardX - from) / 2
  return `M ${line.startX} ${line.y} H ${from} C ${bend} ${line.y}, ${bend} ${line.cardY}, ${line.cardX} ${line.cardY}`
}

/** 마스크·클립이 덮을 큰 사각형(층 좌표는 화면 좌표라 넉넉히 잡는다) */
const HUGE = 100000

const rectProps = (rect: LinkRect) => ({ x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top })

/**
 * 작업 공간 층: 같은 색 문서 창과 메모 노트 창 사이의 연결선을 모든 창 위에 한 겹으로 그린다(이웃하지 않아도 이어진다).
 * 포인터를 가로채지 않는다. 그릴 선은 store(workspaceLinks)가 프레임에 한 번 셈해 내놓는다 — 이 컴포넌트는 그것만 그린다.
 * 선 좌표는 화면 기준이라 이 층의 왼쪽 위(origin)를 빼서 그린다. 칸 영역(.panes) 밖(사이드바·상단바)은 자른다.
 * 선이 가운데 칸을 가로지르는 구간은 흐리게(45%) 그려 그 칸의 글이 읽히게 한다.
 */
export function WorkspaceLinkLayer() {
  const ref = useRef<SVGSVGElement | null>(null)
  const uid = useId().replace(/:/g, '')
  const { originX, originY, lines, clip } = useSyncExternalStore(subscribeLinkLayer, getLinkLayerState, getLinkLayerState)
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
  const areaId = `wl-area-${uid}`
  return (
    <svg ref={ref} className="workspace-link-layer" aria-hidden="true">
      <defs>
        {clip === null ? null : <clipPath id={areaId}><rect {...rectProps(clip)} /></clipPath>}
        {lines.map((line, index) => line.crossing.length === 0 ? null : (
          <g key={line.key}>
            {/* 가운데 칸 밖만 또렷하게 */}
            <mask id={`wl-out-${uid}-${index}`} maskUnits="userSpaceOnUse" x={-HUGE} y={-HUGE} width={HUGE * 2} height={HUGE * 2}>
              <rect x={-HUGE} y={-HUGE} width={HUGE * 2} height={HUGE * 2} fill="white" />
              {line.crossing.map((frame, at) => <rect key={at} {...rectProps(frame)} fill="black" />)}
            </mask>
            {/* 가운데 칸 안만 흐리게 */}
            <clipPath id={`wl-in-${uid}-${index}`}>
              {line.crossing.map((frame, at) => <rect key={at} {...rectProps(frame)} />)}
            </clipPath>
          </g>
        ))}
      </defs>
      <g transform={`translate(${-originX} ${-originY})`} clipPath={clip === null ? undefined : `url(#${areaId})`}>
        {lines.map((line, index) => {
          const d = linkLinePath(line)
          const crossed = line.crossing.length > 0
          return (
            <g key={line.key} className={`workspace-link${line.active ? ' workspace-link-active' : ''}`} data-hl={line.color} data-side={line.side}>
              <path className="workspace-link-line" d={d} mask={crossed ? `url(#wl-out-${uid}-${index})` : undefined} />
              {crossed ? <path className="workspace-link-line workspace-link-pass" d={d} clipPath={`url(#wl-in-${uid}-${index})`} /> : null}
              <circle className="workspace-link-dot" cx={line.startX} cy={line.y} r={line.active ? 3 : 2.2} />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
