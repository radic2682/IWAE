import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AI_ACTIVITY_LINGER_MS,
  AI_ACTIVITY_SAFETY_MS,
  applyMcpToolActivity,
  getAiActivity,
  resetAiActivity,
} from './aiActivityStore'
import { makeEnv } from './testHarness'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { resetAiActivity(); vi.useRealTimers() })

describe('Rust tools/call 이벤트', () => {
  it('begin 은 알약을 켜고 end 는 0개 변경으로 끝내며 3초 뒤 꺼진다', () => {
    applyMcpToolActivity({ phase: 'begin', tool: 'read_page', target: '논문' })
    expect(getAiActivity()).toEqual({ active: true, target: '논문', changes: 0 })
    applyMcpToolActivity({ phase: 'end', tool: 'read_page' })
    expect(getAiActivity()).toMatchObject({ active: true, target: '논문', changes: 0 })
    vi.advanceTimersByTime(AI_ACTIVITY_LINGER_MS + 1)
    expect(getAiActivity().active).toBe(false)
  })

  it('end 가 오지 않아도 60초 뒤에는 닫힌다', () => {
    applyMcpToolActivity({ phase: 'begin', tool: 'search_vault', target: '' })
    vi.advanceTimersByTime(AI_ACTIVITY_SAFETY_MS - 1)
    expect(getAiActivity().active).toBe(true)
    vi.advanceTimersByTime(1 + AI_ACTIVITY_LINGER_MS + 1)
    expect(getAiActivity().active).toBe(false)
  })

  it('짝 없는 end 는 무시하고, 늦게 온 end 가 안전 타이머를 두 번 닫지 않는다', () => {
    applyMcpToolActivity({ phase: 'end', tool: 'x' })
    expect(getAiActivity().active).toBe(false)
    applyMcpToolActivity({ phase: 'begin', tool: 'a' })
    applyMcpToolActivity({ phase: 'end', tool: 'a' })
    vi.advanceTimersByTime(AI_ACTIVITY_SAFETY_MS + AI_ACTIVITY_LINGER_MS + 1)
    expect(getAiActivity().active).toBe(false)
  })

  it('겹쳐 도는 요청이 있으면 마지막이 끝날 때까지 켜져 있다', () => {
    applyMcpToolActivity({ phase: 'begin', tool: 'a' })
    applyMcpToolActivity({ phase: 'begin', tool: 'b' })
    applyMcpToolActivity({ phase: 'end', tool: 'a' })
    vi.advanceTimersByTime(AI_ACTIVITY_LINGER_MS + 1)
    expect(getAiActivity().active).toBe(true)
    applyMcpToolActivity({ phase: 'end', tool: 'b' })
    vi.advanceTimersByTime(AI_ACTIVITY_LINGER_MS + 1)
    expect(getAiActivity().active).toBe(false)
  })
})

describe('웹뷰 읽기 op', () => {
  it('읽기도 알약을 켜고 변경 수는 0 으로 둔다', async () => {
    const env = makeEnv()
    let during = false
    const pending = env.call('app_state').then(() => undefined)
    during = getAiActivity().active
    await pending
    expect(during).toBe(true)
    expect(getAiActivity()).toMatchObject({ active: true, changes: 0 })
  })
})
