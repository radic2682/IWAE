// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useEvent } from './useEvent'

describe('useEvent', () => {
  it('렌더가 바뀌어도 같은 함수이고, 부를 때는 가장 새 렌더의 값을 쓴다', () => {
    const seen: (() => number)[] = []
    let bump: () => void = () => undefined
    function Probe() {
      const [count, setCount] = useState(0)
      bump = () => setCount((value) => value + 1)
      seen.push(useEvent(() => count))
      return null
    }
    render(<Probe />)
    act(() => bump())
    act(() => bump())
    expect(seen.length).toBeGreaterThanOrEqual(3)
    expect(new Set(seen).size).toBe(1)
    expect(seen[0]!()).toBe(2)
  })
})
