import { expect, it } from 'vitest'
import {
  beginCanvasInteraction,
  cancelCanvasInteraction,
  commitCanvasInteraction,
  updateCanvasInteraction,
  type CanvasInteractionState,
} from './canvasInteraction'

it('tracks drag frames without producing a commit until requested', () => {
  const started = beginCanvasInteraction(
    { kind: 'idle' },
    { kind: 'dragging', nodeId: 'node-1', origin: { x: 20, y: 30 }, current: { x: 20, y: 30 } },
  )
  const updated = updateCanvasInteraction(started, { x: 90, y: 120 })

  expect(updated).toMatchObject({ kind: 'dragging', current: { x: 90, y: 120 } })
  expect(commitCanvasInteraction(updated)).toEqual({ nodeId: 'node-1' })
})

it('tracks resize dimensions and can cancel to idle', () => {
  const started: CanvasInteractionState = beginCanvasInteraction(
    { kind: 'idle' },
    { kind: 'resizing', nodeId: 'node-2', origin: { width: 200, height: 80 }, current: { width: 200, height: 80 } },
  )

  expect(updateCanvasInteraction(started, { width: 420, height: 220 })).toMatchObject({
    kind: 'resizing',
    current: { width: 420, height: 220 },
  })
  expect(cancelCanvasInteraction()).toEqual({ kind: 'idle' })
})

it('ignores frame updates while idle', () => {
  expect(updateCanvasInteraction({ kind: 'idle' }, { x: 100, y: 100 })).toEqual({ kind: 'idle' })
  expect(commitCanvasInteraction({ kind: 'idle' })).toBeNull()
})
