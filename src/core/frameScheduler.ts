export interface FrameScheduler {
  schedule(): void
  cancel(): void
}

export function createFrameScheduler(callback: () => void): FrameScheduler {
  let frameId: number | null = null

  return {
    schedule() {
      if (frameId !== null) return
      if (typeof requestAnimationFrame !== 'function') {
        callback()
        return
      }
      frameId = requestAnimationFrame(() => {
        frameId = null
        callback()
      })
    },
    cancel() {
      if (frameId === null) return
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId)
      frameId = null
    },
  }
}
