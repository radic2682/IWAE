import { expect, it } from 'vitest'
import { nearestVacantCanvasPoint, resizeCanvasBlock, settleCanvasPlacement } from './canvasGeometry'

it('pushes a normal block to the nearest non-overlapping snapped position', () => {
  const settled = settleCanvasPlacement(
    { id: 'moving', x: 18, y: 11, width: 200, height: 80, allowOverlap: false },
    { x: 18, y: 11 },
    [{ id: 'fixed', x: 0, y: 0, width: 200, height: 80, allowOverlap: false }],
    { gridX: 20, gridY: 10, contactGap: 0 },
  )

  expect(settled).toEqual({ x: 20, y: 80, attachedTo: 'fixed', side: 'bottom' })
})

it('allows a drawing overlay to overlap content', () => {
  expect(settleCanvasPlacement(
    { id: 'shape', x: 0, y: 0, width: 300, height: 100, allowOverlap: true },
    { x: 0, y: 0 },
    [{ id: 'text', x: 0, y: 0, width: 300, height: 100, allowOverlap: false }],
    { gridX: 20, gridY: 10, contactGap: 0 },
  )).toMatchObject({ x: 0, y: 0 })
})

it('keeps an oversized capture ratio while clamping to positive dimensions', () => {
  const size = resizeCanvasBlock(
    { kind: 'pdfExcerpt', aspectRatio: 2 },
    { width: 1200, height: 20 },
  )

  expect(size).toEqual({ width: 1200, height: 600 })
})

it('preserves an exact fixed edge when a grid-rounded edge would still overlap', () => {
  const settled = nearestVacantCanvasPoint(
    { id: 'moving', x: 0, y: 0, width: 200, height: 120, allowOverlap: false },
    [{ id: 'fixed', x: 150, y: 0, width: 100, height: 80, allowOverlap: false }],
    { gridX: 20, gridY: 10, contactGap: 0 },
  )

  expect(settled).toEqual({ x: -50, y: 0, attachedTo: 'fixed', side: 'left' })
})

it('preserves a magnetic fractional alignment when it is already vacant', () => {
  const settled = nearestVacantCanvasPoint(
    { id: 'moving', x: 80, y: 535.0649, width: 440, height: 130, allowOverlap: false },
    [{ id: 'fixed', x: 80, y: 460, width: 304.066, height: 75.0649, allowOverlap: false }],
    { gridX: 20, gridY: 10, contactGap: 0 },
  )

  expect(settled).toMatchObject({ x: 80, y: 535.0649 })
})
