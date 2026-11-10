import { mergeJsonText } from './jsonMerge'
import { createSerialByKey } from './serialByKey'

/**
 * 창이 여럿일 때 Vault 파일 저장을 안전하게 하는 계층.
 *
 * 저장소는 모두 「메모리 상태 전체를 파일에 다시 쓰는」 방식이다. 창이 하나일 때는 그래도 되지만 두 창이
 * 같은 Vault 를 들고 있으면 나중에 쓴 쪽이 앞선 쪽의 변경을 지운다. 그래서:
 *
 * 1. 저장(write): 디스크의 현재 내용(D)이 이 창이 저장을 시작할 때 알던 내용(base)과 다르면, D 에 이 창의
 *    변경(local − base)을 얹어 합친 내용을 쓴다(core/jsonMerge). 쓰는 순간은 해시 비교(CAS)로 지키고, 그 사이
 *    다른 창이 또 썼으면 다시 읽어 합친다. 어느 창도 다른 창의 변경을 지우지 않는다.
 * 2. 알림(broadcast): 저장이 끝나면 {경로, 해시, 보낸 창} 을 모든 창에 알린다. 알림에는 내용을 싣지 않는다.
 * 3. 받기(receive): 다른 창의 알림을 받으면 디스크를 읽어, 이 창의 메모리 상태에 같은 방식으로 합친다
 *    (remote + (지금 상태 − 마지막으로 맞춘 내용)). 합치기만 하고 저장하지 않으므로 알림이 되돌아 울리지 않는다.
 *
 * 창마다 파일별로 세 가지를 기억한다:
 * - synced: 디스크와 마지막으로 맞춘 내용(읽었을 때·쓰고 난 뒤·남의 변경을 받았을 때)
 * - mirror: 이 창의 상태가 가장 최근에 가리킨 내용(저장을 요청한 내용·받아 합친 내용). 다음 저장의 base 가 된다
 * 저장 요청(beginWrite)은 호출 순간 동기로 mirror 를 읽고 바꾼다 — 요청이 줄에서 기다리는 사이에 남의 변경이
 * 합쳐져도 요청마다 자기 base 로 병합하므로 서로의 변경을 지우지 않는다.
 */

export interface VaultWriteMessage {
  /** Vault 폴더 */
  readonly root: string
  /** 쓴 파일의 절대 경로 */
  readonly path: string
  readonly hash: string
  /** 보낸 창의 label */
  readonly source: string
}

export interface VaultSyncIo {
  readText(path: string): Promise<string | null>
  /** 저널 원자 쓰기. expectedHash 가 null 이면 비교하지 않는다. 쓴 내용의 해시를 돌려준다 */
  atomicWrite(path: string, contents: string, expectedHash: string | null, fileId: string, root: string, preserveConflict: boolean): Promise<string>
  sha256(text: string): Promise<string>
  broadcast(message: VaultWriteMessage): void
  /** atomicWrite 가 던진 오류가 「디스크가 기대와 달라졌다」(충돌)인가 */
  isConflict(error: unknown): boolean
}

export interface SyncCodec<T> {
  serialize(value: T): string
  parse(text: string): T
}

/** 다른 창의 변경(또는 병합 저장으로 달라진 내용)을 이 창 상태에 합치는 도구 */
export interface RemoteChange {
  /** 지금 상태(local)에 남의 변경을 얹은 새 상태. 합칠 수 없으면 local 그대로 */
  rebase<T>(local: T, codec: SyncCodec<T>): T
  readonly path: string
}

export type RemoteListener = (change: RemoteChange) => void

export interface WriteTicket {
  /** 이 저장이 시작될 때 이 창이 알던 내용. undefined 면 병합하지 않는다(읽은 적 없는 파일) */
  readonly base: string | null | undefined
}

interface FileState {
  synced?: string | null
  mirror?: string | null
  hash?: string
  listeners: Set<RemoteListener>
}

const MAX_ATTEMPTS = 6

export function normalizeSyncKey(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/{2,}/gu, '/').toLocaleLowerCase()
}

/** 병합해서 저장하는 파일인가: .iwae 의 JSON 설정·기록(세션·저널·캐시 제외)과 메모 노트(.iwnote) */
export function isMergeableVaultPath(root: string, path: string): boolean {
  const base = normalizeSyncKey(root).replace(/\/$/u, '')
  const target = normalizeSyncKey(path)
  if (!target.startsWith(`${base}/`)) return false
  const relative = target.slice(base.length + 1)
  if (relative.endsWith('.iwnote')) return true
  if (!relative.startsWith('.iwae/') || !relative.endsWith('.json')) return false
  const inner = relative.slice('.iwae/'.length)
  if (inner.includes('/')) return false
  // 세션은 메인 창만 쓴다(병합 대상이 아니다)
  return inner !== 'session.json'
}

export class VaultFileSync {
  private readonly files = new Map<string, FileState>()
  private readonly prefixListeners = new Map<string, Set<(change: RemoteChange) => void>>()
  private readonly serialWrite = createSerialByKey()
  private readonly serialReceive = createSerialByKey()
  /** 이 창이 받은 알림을 되돌려 보내지 않도록 보낸 창을 기억한다 */
  constructor(private readonly io: VaultSyncIo, readonly label: string) {}

  private state(path: string): FileState {
    const key = normalizeSyncKey(path)
    let state = this.files.get(key)
    if (state === undefined) {
      state = { listeners: new Set() }
      this.files.set(key, state)
    }
    return state
  }

  /** 파일을 읽었다: 그 내용이 이 창이 아는 디스크 내용이다 */
  observeRead(path: string, text: string | null): void {
    const state = this.state(path)
    state.synced = text
    state.mirror = text
  }

  /** 해시만 아는 파일(병합하지 않는 캔버스 등)을 읽었다 */
  observeHash(path: string, hash: string | undefined): void {
    const state = this.state(path)
    if (hash === undefined) delete state.hash
    else state.hash = hash
  }

  observedHash(path: string): string | undefined {
    return this.files.get(normalizeSyncKey(path))?.hash
  }

  forget(path: string): void {
    this.files.delete(normalizeSyncKey(path))
  }

  /** 저장을 요청하는 순간 동기로 부른다: base 를 잡고 mirror 를 새 내용으로 바꾼다 */
  beginWrite(path: string, contents: string): WriteTicket {
    const state = this.state(path)
    const ticket: WriteTicket = { base: state.mirror }
    state.mirror = contents
    return ticket
  }

  subscribe(path: string, listener: RemoteListener): () => void {
    const state = this.state(path)
    state.listeners.add(listener)
    return () => { state.listeners.delete(listener) }
  }

  /** 폴더(접두 경로) 아래 모든 파일의 변경을 듣는다 */
  subscribePrefix(prefix: string, listener: (change: RemoteChange) => void): () => void {
    const key = normalizeSyncKey(prefix).replace(/\/?$/u, '/')
    let set = this.prefixListeners.get(key)
    if (set === undefined) {
      set = new Set()
      this.prefixListeners.set(key, set)
    }
    set.add(listener)
    return () => { set.delete(listener) }
  }

  /**
   * 같은 파일의 작업을 한 줄로 세운다. 줄에 서는 것은 이 함수를 부르는 순간(동기)이다 — beginWrite 와 같은 순서로 서야
   * 앞 요청의 병합 바탕과 디스크가 맞는다. 경로를 비동기로 만드는 준비는 작업 안에서 한다
   */
  enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    return this.serialWrite(normalizeSyncKey(key), task)
  }

  /**
   * 파일에 쓴다(줄을 서지 않는다: enqueue 안에서 부른다).
   * mergeable 이 false 면 예전 방식(마지막으로 쓴 해시와 비교, 다르면 충돌 오류)이다.
   */
  writeNow(path: string, contents: string, fileId: string, options: { mergeable: boolean; ticket?: WriteTicket; root?: string }): Promise<void> {
    const ticket = options.ticket ?? (options.mergeable ? this.beginWrite(path, contents) : undefined)
    return options.mergeable
      ? this.writeMerged(path, contents, fileId, ticket?.base, options.root ?? '')
      : this.writePlain(path, contents, fileId, options.root ?? '')
  }

  /** enqueue + writeNow: 경로를 이미 아는 저장 */
  write(path: string, contents: string, fileId: string, options: { mergeable: boolean; ticket?: WriteTicket; root?: string }): Promise<void> {
    const ticket = options.ticket ?? (options.mergeable ? this.beginWrite(path, contents) : undefined)
    return this.enqueue(path, () => this.writeNow(path, contents, fileId, { ...options, ...(ticket === undefined ? {} : { ticket }) }))
  }

  private async writePlain(path: string, contents: string, fileId: string, root: string): Promise<void> {
    const state = this.state(path)
    const hash = await this.io.atomicWrite(path, contents, state.hash ?? null, fileId, root, true)
    state.hash = hash
    this.io.broadcast({ root, path, hash, source: this.label })
  }

  private async writeMerged(path: string, contents: string, fileId: string, base: string | null | undefined, root: string): Promise<void> {
    const state = this.state(path)
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = await this.io.readText(path)
      let toWrite = contents
      let expected: string | null
      if (base === undefined) {
        // 읽은 적 없는 파일: 병합할 바탕이 없으니 예전처럼 마지막으로 쓴 해시와만 비교한다
        expected = state.hash ?? null
      } else {
        if (current !== null && current !== base) {
          const merged = mergeJsonText(base, contents, current)
          if (merged === null) {
            // JSON 이 아니게 된 파일(밖에서 고침): 병합하지 않고 충돌로 다룬다
            const hash = await this.io.atomicWrite(path, contents, state.hash ?? null, fileId, root, true)
            state.hash = hash
            state.synced = contents
            this.io.broadcast({ root, path, hash, source: this.label })
            return
          }
          toWrite = merged
        }
        expected = current === null ? null : await this.io.sha256(current)
      }
      if (current !== null && toWrite === current) {
        state.synced = current
        return
      }
      try {
        // 어긋나면 다시 읽어 합쳐 쓰므로 마지막 시도 전에는 충돌 기록을 남기지 않는다
        const hash = await this.io.atomicWrite(path, toWrite, expected, fileId, root, attempt === MAX_ATTEMPTS - 1)
        state.hash = hash
        state.synced = toWrite
        this.io.broadcast({ root, path, hash, source: this.label })
        if (toWrite !== contents) this.notify(path, contents, toWrite)
        return
      } catch (error) {
        lastError = error
        if (!this.io.isConflict(error) || base === undefined) throw error
        // 읽은 뒤 다른 창이 또 썼다: 다시 읽고 합친다
      }
    }
    throw lastError
  }

  /** 다른 창의 저장 알림 */
  receive(message: VaultWriteMessage): Promise<void> {
    if (message.source === this.label) return Promise.resolve()
    const key = normalizeSyncKey(message.path)
    return this.serialReceive(key, async () => {
      const targets = this.listenersFor(message.path)
      if (targets.length === 0) return
      const current = await this.io.readText(message.path)
      if (current === null) return
      const state = this.state(message.path)
      if (current === state.synced) return
      const base = state.synced ?? null
      this.deliver(message.path, base, current, targets)
      state.synced = current
    })
  }

  private listenersFor(path: string): RemoteListener[] {
    const key = normalizeSyncKey(path)
    const exact = [...(this.files.get(key)?.listeners ?? [])]
    const prefixed: RemoteListener[] = []
    for (const [prefix, set] of this.prefixListeners) {
      if (key.startsWith(prefix)) prefixed.push(...set)
    }
    return [...exact, ...prefixed]
  }

  /** 병합 저장으로 디스크 내용이 local 과 달라졌다: 이 창 상태도 따라가게 한다 */
  private notify(path: string, base: string, merged: string): void {
    this.deliver(path, base, merged, this.listenersFor(path))
  }

  private deliver(path: string, base: string | null, remoteText: string, targets: readonly RemoteListener[]): void {
    const state = this.state(path)
    const change: RemoteChange = {
      path,
      rebase: <T>(local: T, codec: SyncCodec<T>): T => {
        try {
          const localText = codec.serialize(local)
          const merged = mergeJsonText(base, localText, remoteText)
          if (merged === null) return local
          // mirror(마지막으로 저장을 요청한 내용)에도 남의 변경을 얹는다. 그래야 「아직 저장을 요청하지 않은 내 변경」
          // (지금 상태 − mirror)이 그대로 남아 다음 저장에 실린다. mirror 를 통째로 merged 로 바꾸면 그 변경이 바탕에 묻혀
          // 디스크에 한 번도 쓰이지 못한다(미뤄 둔 저장이 있는 메모 노트에서 블록이 사라지던 까닭)
          if (typeof state.mirror === 'string') state.mirror = mergeJsonText(base, state.mirror, remoteText) ?? merged
          // 달라진 것이 없으면 같은 값을 돌려줘 화면을 다시 그리지 않게 한다
          return merged === localText ? local : codec.parse(merged)
        } catch {
          return local
        }
      },
    }
    for (const listener of targets) listener(change)
  }
}
