import { describe, expect, it } from 'vitest'
import { VaultExternalChangeError, VaultFileSync, isMergeableVaultPath, type SyncCodec, type VaultSyncIo, type VaultWriteMessage } from './vaultSync'

const ROOT = 'C:/vault'
const PATH = 'C:/vault/.iwae/highlights.json'
const EMPTY = '{"version":1,"items":[]}'

interface Item { id: string; memo?: string }
const codec: SyncCodec<Item[]> = {
  serialize: (items) => `${JSON.stringify({ version: 1, items }, null, 2)}\n`,
  parse: (text) => (JSON.parse(text) as { items: Item[] }).items,
}

/** 한 디스크를 두 창이 나눠 쓰는 환경 */
function world() {
  const disk = new Map<string, string>()
  const syncs: VaultFileSync[] = []
  const messages: VaultWriteMessage[] = []
  const conflictsOnce = { count: 0 }
  const preserveFlags: boolean[] = []
  const hashOf = (text: string) => `h:${text.length}:${[...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)}`
  const io = (label: string): VaultSyncIo => ({
    readText: async (path) => disk.get(path) ?? null,
    atomicWrite: async (path, contents, expected, _fileId, _root, preserveConflict) => {
      preserveFlags.push(preserveConflict)
      const current = disk.get(path)
      if (conflictsOnce.count > 0 && expected !== null) {
        conflictsOnce.count -= 1
        // 읽은 직후 다른 창이 끼어 쓴 것처럼 디스크를 바꾼다
        const other = JSON.parse(current ?? EMPTY) as { version: number; items: Item[] }
        other.items.push({ id: `racer-${label}` })
        disk.set(path, `${JSON.stringify(other, null, 2)}\n`)
        throw new Error('conflict')
      }
      if (expected !== null && current !== undefined && hashOf(current) !== expected) throw new Error('conflict')
      disk.set(path, contents)
      return hashOf(contents)
    },
    sha256: async (text) => hashOf(text),
    broadcast: (message) => { messages.push(message) },
    isConflict: (error) => error instanceof Error && error.message === 'conflict',
  })
  const open = (label: string) => {
    const sync = new VaultFileSync(io(label), label)
    syncs.push(sync)
    return sync
  }
  /** 알림을 모든 다른 창에 전달한다 */
  const flush = async () => {
    const pending = messages.splice(0)
    for (const message of pending) await Promise.all(syncs.map((sync) => sync.receive(message)))
  }
  return { disk, open, flush, messages, conflictsOnce, preserveFlags }
}

/** 창 하나가 가진 하이라이트 목록(React 상태 대신) */
function replica(sync: VaultFileSync, initial: Item[]) {
  const state = { items: initial }
  sync.observeRead(PATH, codec.serialize(initial))
  sync.subscribe(PATH, (change) => { state.items = change.rebase(state.items, codec) })
  const save = (items: Item[]) => {
    state.items = items
    return sync.write(PATH, codec.serialize(items), 'metadata:highlights.json', { mergeable: true, root: ROOT })
  }
  return { state, save }
}

const ids = (items: readonly Item[]) => items.map((item) => item.id).sort()
const onDisk = (disk: Map<string, string>) => ids((JSON.parse(disk.get(PATH) ?? EMPTY) as { items: Item[] }).items)

describe('VaultFileSync', () => {
  it('applies a remote write to the other window without writing back (no echo)', async () => {
    const { disk, open, flush, messages } = world()
    disk.set(PATH, codec.serialize([{ id: 'a' }]))
    const main = replica(open('main'), [{ id: 'a' }])
    const detached = replica(open('detached-1'), [{ id: 'a' }])

    await detached.save([{ id: 'a' }, { id: 'from-detached' }])
    expect(messages).toHaveLength(1)
    await flush()
    expect(ids(main.state.items)).toEqual(['a', 'from-detached'])
    // 받은 쪽은 쓰지 않는다 -> 새 알림이 없다
    expect(messages).toHaveLength(0)
    expect(onDisk(disk)).toEqual(['a', 'from-detached'])
  })

  it('ignores its own message', async () => {
    const { disk, open, messages } = world()
    disk.set(PATH, codec.serialize([]))
    const sync = open('main')
    const main = replica(sync, [])
    await main.save([{ id: 'x' }])
    await sync.receive(messages[0]!)
    expect(ids(main.state.items)).toEqual(['x'])
  })

  it('keeps both additions when two windows save before hearing each other', async () => {
    const { disk, open, flush } = world()
    disk.set(PATH, codec.serialize([]))
    const main = replica(open('main'), [])
    const detached = replica(open('detached-1'), [])

    await Promise.all([
      main.save([{ id: 'in-main' }]),
      detached.save([{ id: 'in-detached' }]),
    ])
    await flush()
    expect(onDisk(disk)).toEqual(['in-detached', 'in-main'])
    expect(ids(main.state.items)).toEqual(['in-detached', 'in-main'])
    expect(ids(detached.state.items)).toEqual(['in-detached', 'in-main'])
  })

  it('does not lose a queued local write when a remote write arrives before it runs', async () => {
    const { disk, open, flush } = world()
    disk.set(PATH, codec.serialize([]))
    const main = replica(open('main'), [])
    const detached = replica(open('detached-1'), [])

    await main.save([{ id: 'm1' }])
    // detached 가 저장을 요청했지만 아직 줄에서 기다리는 사이 main 의 알림이 먼저 도착한다
    const pending = detached.save([{ id: 'd1' }])
    await flush()
    await pending
    await flush()
    expect(onDisk(disk)).toEqual(['d1', 'm1'])
    expect(ids(detached.state.items)).toEqual(['d1', 'm1'])
    expect(ids(main.state.items)).toEqual(['d1', 'm1'])
  })

  it('keeps a local edit made while a remote change is being applied', async () => {
    const { disk, open, flush } = world()
    disk.set(PATH, codec.serialize([]))
    const main = replica(open('main'), [])
    const detached = replica(open('detached-1'), [])

    await main.save([{ id: 'm1' }])
    const first = detached.save([{ id: 'd1' }])
    const applying = flush()
    // 합치는 중에 detached 가 한 번 더 고친다
    const second = detached.save([...detached.state.items, { id: 'd2' }])
    await Promise.all([first, second, applying])
    await flush()
    expect(onDisk(disk)).toEqual(['d1', 'd2', 'm1'])
    expect(ids(detached.state.items)).toEqual(['d1', 'd2', 'm1'])
  })

  it('applies a remote delete and then keeps the window own add and undo consistent', async () => {
    const { disk, open, flush } = world()
    disk.set(PATH, codec.serialize([{ id: 'a' }, { id: 'b' }]))
    const main = replica(open('main'), [{ id: 'a' }, { id: 'b' }])
    const detached = replica(open('detached-1'), [{ id: 'a' }, { id: 'b' }])

    await main.save([{ id: 'b' }])
    await flush()
    expect(ids(detached.state.items)).toEqual(['b'])
    await detached.save([{ id: 'b' }, { id: 'c' }])
    await detached.save([{ id: 'b' }])
    await flush()
    expect(onDisk(disk)).toEqual(['b'])
    expect(ids(main.state.items)).toEqual(['b'])
  })

  it('retries when another window writes between the read and the write', async () => {
    const { disk, open, conflictsOnce, flush } = world()
    disk.set(PATH, codec.serialize([{ id: 'a' }]))
    const main = replica(open('main'), [{ id: 'a' }])
    conflictsOnce.count = 1
    await main.save([{ id: 'a' }, { id: 'm' }])
    expect(onDisk(disk)).toEqual(['a', 'm', 'racer-main'])
    await flush()
    expect(ids(main.state.items)).toEqual(['a', 'm', 'racer-main'])
  })

  it('does not leave conflict records for retried attempts, only for the last one', async () => {
    const { disk, open, conflictsOnce, preserveFlags } = world()
    disk.set(PATH, codec.serialize([{ id: 'a' }]))
    const main = replica(open('main'), [{ id: 'a' }])
    conflictsOnce.count = 2
    await main.save([{ id: 'a' }, { id: 'm' }])
    expect(preserveFlags).toEqual([false, false, false])

    preserveFlags.length = 0
    conflictsOnce.count = 99
    await expect(main.save([{ id: 'a' }, { id: 'm' }, { id: 'n' }])).rejects.toThrow('conflict')
    expect(preserveFlags.slice(0, -1).every((flag) => !flag)).toBe(true)
    expect(preserveFlags.at(-1)).toBe(true)
  })

  it('does not write when the merged result equals the disk', async () => {
    const { disk, open, messages } = world()
    disk.set(PATH, codec.serialize([{ id: 'a' }]))
    const main = replica(open('main'), [{ id: 'a' }])
    await main.save([{ id: 'a' }])
    expect(messages).toHaveLength(0)
    expect(onDisk(disk)).toEqual(['a'])
  })
})

describe('VaultFileSync with deferred saves (memo notes)', () => {
  it('keeps a local change that was made but not yet passed to write when a remote write arrives', async () => {
    const { disk, open, flush } = world()
    disk.set(PATH, codec.serialize([]))
    const main = replica(open('main'), [])
    const detachedSync = open('detached-1')
    const detached = replica(detachedSync, [])

    // main 이 상태만 고쳤다(저장은 아직 요청하지 않았다: 400ms 뒤에 쓸 메모 노트처럼)
    main.state.items = [{ id: 'm-pending' }]
    await detached.save([{ id: 'd1' }])
    await flush()
    // 남의 변경이 합쳐져도 아직 쓰지 않은 내 변경은 상태에 남아 있다
    expect(ids(main.state.items)).toEqual(['d1', 'm-pending'])
    // 뒤늦게 저장을 요청한다(합쳐진 최신 상태 그대로)
    await main.save(main.state.items)
    await flush()
    expect(onDisk(disk)).toEqual(['d1', 'm-pending'])
    expect(ids(detached.state.items)).toEqual(['d1', 'm-pending'])
  })

  it('also keeps it when the remote write lands between the two deferred saves', async () => {
    const { disk, open, flush } = world()
    disk.set(PATH, codec.serialize([]))
    const main = replica(open('main'), [])
    const detached = replica(open('detached-1'), [])

    main.state.items = [{ id: 'm1' }]
    await detached.save([{ id: 'd1' }])
    await flush()
    main.state.items = [...main.state.items, { id: 'm2' }]
    await main.save(main.state.items)
    await flush()
    expect(onDisk(disk)).toEqual(['d1', 'm1', 'm2'])
  })
})

describe('VaultFileSync request order', () => {
  it('keeps requests in order even when preparing the path of an earlier request takes longer', async () => {
    const { disk, open, flush } = world()
    disk.set(PATH, codec.serialize([{ id: 'a' }, { id: 'b' }, { id: 'c' }]))
    const sync = open('main')
    const state = { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as Item[] }
    sync.observeRead(PATH, codec.serialize(state.items))
    sync.subscribe(PATH, (change) => { state.items = change.rebase(state.items, codec) })
    const delays = [30, 0, 10]
    const requests = ['a', 'b', 'c'].map((removed, index) => {
      state.items = state.items.filter((item) => item.id !== removed)
      const contents = codec.serialize(state.items)
      const ticket = sync.beginWrite(PATH, contents)
      // 경로 준비(IPC)가 요청마다 다른 시간이 걸린다. 줄에 서는 것은 요청 순서대로(동기)여야 한다
      return sync.enqueue(PATH, async () => {
        await new Promise((resolve) => setTimeout(resolve, delays[index]))
        await sync.writeNow(PATH, contents, 'metadata:highlights.json', { mergeable: true, root: ROOT, ticket })
      })
    })
    await Promise.all(requests)
    await flush()
    expect(onDisk(disk)).toEqual([])
    // 지운 항목이 되살아나지 않는다
    expect(ids(state.items)).toEqual([])
  })
})

describe('isMergeableVaultPath', () => {
  it('merges vault metadata json and memo notes but not the session or journals', () => {
    expect(isMergeableVaultPath('C:\\vault', 'C:\\vault\\.iwae\\highlights.json')).toBe(true)
    expect(isMergeableVaultPath('C:\\vault', 'C:\\vault\\노트\\회의.iwnote')).toBe(true)
    expect(isMergeableVaultPath('C:\\vault', 'C:\\vault\\.iwae\\session.json')).toBe(false)
    expect(isMergeableVaultPath('C:\\vault', 'C:\\vault\\.iwae\\history\\x.json')).toBe(false)
    expect(isMergeableVaultPath('C:\\vault', 'C:\\vault\\a.canvas')).toBe(false)
    expect(isMergeableVaultPath('D:\\other', 'C:\\vault\\.iwae\\highlights.json')).toBe(false)
  })
})

describe('외부 변경 확인(저장 직전 확인)', () => {
  const NOTE = 'C:/vault/노트/a.iwnote'

  it('디스크가 이 창이 읽은 내용과 같으면 same, 밖에서 바뀌면 changed, 없으면 missing', async () => {
    const w = world()
    const sync = w.open('A')
    w.disk.set(NOTE, 'one')
    sync.observeRead(NOTE, 'one')
    expect(await sync.inspect(NOTE)).toEqual({ state: 'same' })
    w.disk.set(NOTE, 'two')
    expect(await sync.inspect(NOTE)).toEqual({ state: 'changed', text: 'two' })
    w.disk.delete(NOTE)
    expect(await sync.inspect(NOTE)).toEqual({ state: 'missing' })
  })

  it('저장 직전 확인은 밖에서 바뀐 파일을 쓰지 못하게 막고, 자기 저장·없는 파일은 통과시킨다', async () => {
    const w = world()
    const sync = w.open('A')
    w.disk.set(NOTE, '{"v":1}')
    sync.observeRead(NOTE, '{"v":1}')
    // 자기 저장 뒤에는 통과한다
    await sync.write(NOTE, '{"v":2}', 'f', { mergeable: true })
    await sync.guardWrite(NOTE)
    // 에이전트가 파일을 바꿨다
    w.disk.set(NOTE, '{"v":"agent"}')
    await expect(sync.guardWrite(NOTE)).rejects.toBeInstanceOf(VaultExternalChangeError)
    // 파일이 없으면 만들 수 있다
    w.disk.delete(NOTE)
    await expect(sync.guardWrite(NOTE)).resolves.toBeUndefined()
    // 읽은 적 없는 파일이 이미 있으면 덮어쓰지 않는다
    w.disk.set('C:/vault/노트/b.iwnote', 'x')
    await expect(sync.guardWrite('C:/vault/노트/b.iwnote')).rejects.toBeInstanceOf(VaultExternalChangeError)
  })
})
