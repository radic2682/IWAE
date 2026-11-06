import type { WheelEvent } from 'react'

export function scrollHorizontalStrip(event: WheelEvent<HTMLElement>) {
  const strip = event.currentTarget
  if (strip.scrollWidth <= strip.clientWidth) return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (delta === 0) return
  const next = Math.min(Math.max(strip.scrollLeft + delta, 0), strip.scrollWidth - strip.clientWidth)
  if (next === strip.scrollLeft) return
  event.preventDefault()
  strip.scrollLeft = next
}
