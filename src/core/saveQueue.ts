type SaveOperation = () => Promise<void>

interface QueueState {
  pending: SaveOperation | null
  cycle: Promise<void>
}

export class SaveQueue {
  private readonly states = new Map<string, QueueState>()

  enqueue(key: string, operation: SaveOperation): Promise<void> {
    const existing = this.states.get(key)
    if (existing !== undefined) {
      existing.pending = operation
      return existing.cycle
    }

    const state = { pending: operation } as QueueState
    state.cycle = this.run(key, state)
    this.states.set(key, state)
    return state.cycle
  }

  hasPending(key?: string): boolean {
    return key === undefined ? this.states.size > 0 : this.states.has(key)
  }

  async flush(key?: string): Promise<void> {
    if (key !== undefined) {
      await this.states.get(key)?.cycle
      return
    }
    while (this.states.size > 0) {
      await Promise.all([...this.states.values()].map((state) => state.cycle))
    }
  }

  private async run(key: string, state: QueueState): Promise<void> {
    let finalError: unknown = null
    while (state.pending !== null) {
      const operation = state.pending
      state.pending = null
      try {
        await operation()
        finalError = null
      } catch (error) {
        finalError = error
      }
    }
    this.states.delete(key)
    if (finalError !== null) throw finalError
  }
}

