import { describe, expect, it } from 'vitest'
import { selectSnapshotsToKeep, shouldCreateSnapshot } from './vaultRetention'

const NOW = new Date('2026-09-27T12:00:00.000Z')

describe('vault retention', () => {
  it('creates snapshots no more often than every five minutes', () => {
    expect(shouldCreateSnapshot(null, NOW)).toBe(true)
    expect(shouldCreateSnapshot('2026-09-27T11:56:00.000Z', NOW)).toBe(false)
    expect(shouldCreateSnapshot('2026-09-27T11:55:00.000Z', NOW)).toBe(true)
  })

  it('keeps at most 50 snapshots that are no older than 30 days', () => {
    const snapshots = Array.from({ length: 60 }, (_, index) => ({
      id: `snapshot-${index}`,
      createdAt: new Date(NOW.getTime() - index * 24 * 60 * 60 * 1000).toISOString(),
    }))

    const kept = selectSnapshotsToKeep(snapshots, NOW)

    expect(kept).toHaveLength(31)
    expect(kept[0]?.id).toBe('snapshot-0')
    expect(kept.at(-1)?.id).toBe('snapshot-30')
  })

  it('uses the 50 item cap when all snapshots are recent', () => {
    const snapshots = Array.from({ length: 55 }, (_, index) => ({
      id: `snapshot-${index}`,
      createdAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
    }))

    expect(selectSnapshotsToKeep(snapshots, NOW)).toHaveLength(50)
  })
})
