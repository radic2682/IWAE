/**
 * 열쇠마다 비동기 작업을 한 줄로 세운다. 앞 작업이 끝난 뒤(실패해도) 다음 작업을 시작한다.
 * 같은 파일 저장이 겹쳐 기대 해시가 엇갈리는 것을 막는 데 쓴다.
 */
export function createSerialByKey() {
  const pending = new Map<string, Promise<unknown>>()
  return function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = pending.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(task)
    pending.set(key, next)
    void next.catch(() => undefined).then(() => {
      if (pending.get(key) === next) pending.delete(key)
    })
    return next
  }
}
