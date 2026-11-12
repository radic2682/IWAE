import { describe, expect, it } from 'vitest'
import {
  attachedCounts, clientCountText, closePlan, detachPlan, findClient, newClientPlan, nextClientLetter, ownerOf, removeClient, statusSessionText, upsertClient, visibleClients,
  type ClientInfo, type ClientRegistry,
} from './clients'

const client = (id: string, letter: string, session: string, extra: Partial<ClientInfo> = {}): ClientInfo => ({
  id, letter, role: id === 'main' ? 'main' : 'extra', session, screen: 0, hidden: false, joinedAt: Number(id.replace(/\D/gu, '')) || 0, ...extra,
})

const registry = (...items: ClientInfo[]): ClientRegistry => items.reduce<ClientRegistry>((all, item) => upsertClient(all, item), [])

describe('앱 창 목록', () => {
  it('메인 창이 먼저, 그다음 먼저 열린 창 차례로 놓고, 같은 창의 새 알림은 바꾼다', () => {
    const all = registry(client('window-30', 'C', 'S'), client('main', 'A', 'S'), client('window-20', 'B', 'S'))
    expect(all.map((item) => item.letter)).toEqual(['A', 'B', 'C'])
    const moved = upsertClient(all, { ...client('window-20', 'B', 'T'), screen: 2 })
    expect(moved).toHaveLength(3)
    expect(moved.find((item) => item.id === 'window-20')).toMatchObject({ session: 'T', screen: 2 })
    expect(removeClient(moved, 'window-30').map((item) => item.letter)).toEqual(['A', 'B'])
    expect(removeClient(moved, 'nope')).toBe(moved)
  })

  it('새 앱 창의 이름은 쓰지 않은 가장 앞 글자다(메인 창은 A)', () => {
    expect(nextClientLetter(registry(client('main', 'A', 'S')))).toBe('B')
    expect(nextClientLetter(registry(client('main', 'A', 'S'), client('window-2', 'B', 'S'), client('window-3', 'D', 'S')))).toBe('C')
    // B 가 닫히면 그 글자를 다시 쓴다
    expect(nextClientLetter(registry(client('main', 'A', 'S'), client('window-3', 'C', 'S')))).toBe('B')
  })

  it('세션마다 소유자는 그 세션에 붙은 첫 창이다: 메인 창이 있으면 메인, 없으면 먼저 열린 창', () => {
    const all = registry(client('main', 'A', 'S'), client('window-2', 'B', 'S'), client('window-3', 'C', 'T'), client('window-4', 'D', 'T'))
    expect(ownerOf(all, 'S')?.id).toBe('main')
    expect(ownerOf(all, 'T')?.id).toBe('window-3')
    expect(ownerOf(all, '없는 세션')).toBeNull()
    // 소유자가 빠지면 다음 창이 소유자가 된다(소유권 이전)
    expect(ownerOf(removeClient(all, 'main'), 'S')?.id).toBe('window-2')
    expect(ownerOf(removeClient(all, 'window-3'), 'T')?.id).toBe('window-4')
  })

  it('이름(대소문자 무시)이나 창 id 로 찾는다', () => {
    const all = registry(client('main', 'A', 'S'), client('window-2', 'B', 'S'))
    expect(findClient(all, 'b')?.id).toBe('window-2')
    expect(findClient(all, ' main ')?.letter).toBe('A')
    expect(findClient(all, 'window-2')?.letter).toBe('B')
    expect(findClient(all, 'Z')).toBeNull()
    expect(findClient(all, '')).toBeNull()
  })

  it('세션별 붙은 앱 창 수와 상태 줄 글', () => {
    const all = registry(client('main', 'A', '논문 3장'), client('window-2', 'B', '논문 3장'), client('window-3', 'C', '발표'))
    expect([...attachedCounts(all)]).toEqual([['논문 3장', 2], ['발표', 1]])
    expect(clientCountText(2)).toBe('앱 창 2개')
    expect(statusSessionText('논문 3장', 2)).toBe('[논문 3장 · 앱 창 2개]')
    expect(statusSessionText('논문 3장', 1)).toBe('[논문 3장]')
    expect(visibleClients([client('main', 'A', 'S', { hidden: true }), client('window-2', 'B', 'S')]).map((item) => item.id)).toEqual(['window-2'])
  })
})

describe('detach · 닫기', () => {
  it('detach: 다른 앱 창이 보이면 이 창을 닫고, 마지막 앱 창이면 앱을 닫을지 묻는다', () => {
    const two = registry(client('main', 'A', 'S'), client('window-2', 'B', 'S'))
    expect(detachPlan(two, 'window-2')).toBe('close')
    expect(detachPlan(two, 'main')).toBe('close')
    expect(detachPlan(registry(client('main', 'A', 'S')), 'main')).toBe('confirm-quit')
    // 숨긴 메인 창만 남으면 보이는 창은 이것뿐이다
    expect(detachPlan(registry(client('main', 'A', 'S', { hidden: true }), client('window-2', 'B', 'S')), 'window-2')).toBe('confirm-quit')
  })

  it('닫기(×): 메인 창은 다른 앱 창이 보이면 숨고, 새 창은 그냥 닫히고, 마지막으로 보이는 새 창을 닫으면 메인 창에게 끝내 달라고 한다', () => {
    const two = registry(client('main', 'A', 'S'), client('window-2', 'B', 'S'))
    expect(closePlan(two, 'main', true, false)).toBe('hide')
    expect(closePlan(two, 'window-2', false, false)).toBe('close')
    expect(closePlan(registry(client('main', 'A', 'S')), 'main', true, false)).toBe('quit')
    const hiddenMain = registry(client('main', 'A', 'S', { hidden: true }), client('window-2', 'B', 'S'))
    expect(closePlan(hiddenMain, 'window-2', false, false)).toBe('quit-via-main')
    // 앱을 끝내는 중이면 모두 그냥 닫힌다
    expect(closePlan(two, 'main', true, true)).toBe('quit')
    expect(closePlan(hiddenMain, 'window-2', false, true)).toBe('close')
  })
})

describe('new-client 계획', () => {
  const base = { current: '논문', resolve: (name: string) => (name === '발표' ? '발표' : null), screenCount: 3, registry: registry(client('main', 'A', '논문')) }

  it('같은 세션이면 다음 화면, 마지막 화면이면 같은 화면을 보인다', () => {
    expect(newClientPlan({ ...base, wanted: undefined, activeIndex: 0 })).toEqual({ session: '논문', screen: 1, letter: 'B' })
    expect(newClientPlan({ ...base, wanted: undefined, activeIndex: 2 })).toEqual({ session: '논문', screen: 2, letter: 'B' })
    expect(newClientPlan({ ...base, wanted: undefined, activeIndex: 0, screenCount: 1 })).toEqual({ session: '논문', screen: 0, letter: 'B' })
  })

  it('다른 세션을 고르면 그 세션이 보던 화면에서(화면 번호 없음), 못 찾으면 null', () => {
    expect(newClientPlan({ ...base, wanted: '발표', activeIndex: 0 })).toEqual({ session: '발표', screen: null, letter: 'B' })
    expect(newClientPlan({ ...base, wanted: '없음', activeIndex: 0 })).toBeNull()
    // 이름을 대도 지금 세션이면 같은 세션 규칙
    expect(newClientPlan({ ...base, wanted: undefined, current: '발표', activeIndex: 0 })?.session).toBe('발표')
  })
})
