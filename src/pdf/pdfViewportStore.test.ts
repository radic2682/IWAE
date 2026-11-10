import { describe, expect, it, vi } from 'vitest'
import { getPdfViewport, publishPdfViewport } from './pdfViewportStore'
import { visibleRegions, type SpreadBox } from './pageLayout'

const box = (top: number, height = 100): SpreadBox => ({ top, height, left: 0, width: 80 })

describe('visibleRegions', () => {
  const boxes = [box(0), box(110), box(220)]
  it('returns the fraction of one page that is visible', () => {
    const [region] = visibleRegions(boxes, { left: 0, top: 25, width: 80, height: 50 })
    expect(region).toEqual({ page: 0, x: 0, y: 0.25, w: 1, h: 0.5 })
  })
  it('spans two pages when the view straddles the gap', () => {
    const regions = visibleRegions(boxes, { left: 0, top: 60, width: 80, height: 100 })
    expect(regions.map((r) => r.page)).toEqual([0, 1])
    expect(regions[0]).toMatchObject({ y: 0.6, h: 0.4 })
    expect(regions[1]).toMatchObject({ y: 0, h: 0.5 })
  })
  it('clips horizontally when zoomed in', () => {
    const [region] = visibleRegions(boxes, { left: 20, top: 0, width: 40, height: 100 })
    expect(region).toMatchObject({ x: 0.25, w: 0.5 })
  })
  it('is empty for an unmeasured view', () => {
    expect(visibleRegions(boxes, { left: 0, top: 0, width: 0, height: 0 })).toEqual([])
  })
  it('handles side-by-side spreads', () => {
    const spread: SpreadBox[] = [{ top: 0, height: 100, left: 0, width: 40 }, { top: 0, height: 100, left: 50, width: 40 }, { top: 110, height: 100, left: 0, width: 40 }]
    const regions = visibleRegions(spread, { left: 0, top: 0, width: 100, height: 50 })
    expect(regions.map((r) => r.page)).toEqual([0, 1])
  })
})

describe('pdfViewportStore', () => {
  it('notifies only on real changes', () => {
    const view = { docId: 'd', regions: [{ page: 0, x: 0, y: 0, w: 1, h: 0.5 }] }
    publishPdfViewport('t-pane', view)
    expect(getPdfViewport('t-pane')).toEqual(view)
    const listener = vi.fn()
    publishPdfViewport('t-pane', { docId: 'd', regions: [{ page: 0, x: 0, y: 0, w: 1, h: 0.5 }] })
    expect(listener).not.toHaveBeenCalled()
    publishPdfViewport('t-pane', null)
    expect(getPdfViewport('t-pane')).toBeNull()
  })
})
