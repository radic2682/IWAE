import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MOTION_BASE_MS } from './motion'

/**
 * 접고 펼치는 상자. 높이는 grid-template-rows 0fr↔1fr 전환으로 움직인다(레이아웃 값을 JS 로 재지 않는다).
 * - 처음부터 열려 있으면 움직이지 않는다.
 * - 닫으면 전환이 끝날 때까지 마지막 내용을 그려 두었다가 지운다(내용이 먼저 사라져 상자만 줄어드는 일이 없다).
 * - 열고 닫기를 빠르게 되풀이해도 전환이 현재 값에서 이어진다(키프레임이 아니라 transition).
 */
export function Collapse({ open, children }: { readonly open: boolean; readonly children: ReactNode }) {
  const [mounted, setMounted] = useState(open)
  const [expanded, setExpanded] = useState(open)
  const lastRef = useRef<ReactNode>(children)
  if (open) lastRef.current = children
  useEffect(() => {
    if (open) {
      setMounted(true)
      let second = 0
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setExpanded(true)) })
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
    }
    setExpanded(false)
    const timer = window.setTimeout(() => setMounted(false), MOTION_BASE_MS + 40)
    return () => window.clearTimeout(timer)
  }, [open])
  if (!open && !mounted) return null
  return (
    <div className="motion-collapse" data-expanded={expanded ? '' : undefined} data-closing={open ? undefined : ''}>
      <div className="motion-collapse-inner">{open ? children : lastRef.current}</div>
    </div>
  )
}
