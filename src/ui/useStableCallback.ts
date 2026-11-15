import { useCallback, useRef } from 'react'

/**
 * 부를 때마다 가장 최근 함수를 부르되 자기 자신은 바뀌지 않는 함수.
 * 문서 · 창 키 입력 구독에 쓴다: 구독 effect 의 의존 목록이 렌더마다 바뀌면 다른 핸들러가 상태를 바꿔 렌더가 일어나는 같은 키 입력 도중에
 * 구독이 풀렸다 다시 걸려 이 핸들러가 그 입력을 놓친다(캔버스가 열려 있을 때 Esc 로 설정이 닫히지 않던 문제).
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn)
  ref.current = fn
  return useCallback((...args: A) => ref.current(...args), [])
}
