const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000
const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const SNAPSHOT_LIMIT = 50

export interface DatedSnapshot {
  createdAt: string | number
}

function timestamp(value: string | number): number {
  return typeof value === 'number' ? value : Date.parse(value)
}

export function shouldCreateSnapshot(
  lastSnapshotAt: string | number | null,
  now: Date,
): boolean {
  if (lastSnapshotAt === null) return true
  const previous = timestamp(lastSnapshotAt)
  return !Number.isFinite(previous) || now.getTime() - previous >= SNAPSHOT_INTERVAL_MS
}

export function selectSnapshotsToKeep<T extends DatedSnapshot>(
  snapshots: readonly T[],
  now: Date,
): T[] {
  const oldest = now.getTime() - SNAPSHOT_MAX_AGE_MS
  return [...snapshots]
    .filter((snapshot) => {
      const createdAt = timestamp(snapshot.createdAt)
      return Number.isFinite(createdAt) && createdAt >= oldest && createdAt <= now.getTime()
    })
    .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt))
    .slice(0, SNAPSHOT_LIMIT)
}

