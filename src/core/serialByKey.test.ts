import { describe, expect, it } from 'vitest'
import { createSerialByKey } from './serialByKey'

describe('createSerialByKey', () => {
  it('같은 열쇠는 차례로, 앞 작업이 실패해도 다음 작업을 한다', async () => {
    const serial = createSerialByKey()
    const log: string[] = []
    const task = (name: string, fail = false) => async () => {
      log.push(`${name}:start`)
      await new Promise((resolve) => setTimeout(resolve, 5))
      log.push(`${name}:end`)
      if (fail) throw new Error(name)
      return name
    }
    const results = await Promise.allSettled([serial('a', task('1', true)), serial('a', task('2')), serial('b', task('3'))])
    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled', 'fulfilled'])
    expect(log.indexOf('2:start')).toBeGreaterThan(log.indexOf('1:end'))
    expect(log.indexOf('3:start')).toBeLessThan(log.indexOf('1:end'))
  })
})
