import { describe, expect, it } from 'vitest'
import { compareVersions } from './releaseNotes'
import { latestFeatureTour, planTours, TOURS, tourById, type Tour } from './tours'

const step = (id: string) => ({ id, title: id, body: id })
const fixture: readonly Tour[] = [
  { id: 'onboarding', kind: 'onboarding', name: 'o', steps: [step('a')] },
  { id: 'v0.1.20', kind: 'feature', version: '0.1.20', name: 'f', steps: [step('a')] },
  { id: 'v0.1.22', kind: 'feature', version: '0.1.22', name: 'f', steps: [step('a')] },
  { id: 'v0.1.25', kind: 'feature', version: '0.1.25', name: 'f', steps: [step('a')] },
]
const plan = (input: Partial<Parameters<typeof planTours>[0]> & { currentVersion: string }) => planTours({
  lastSeenVersion: null, seen: [], hasExistingInstall: false, tours: fixture, ...input,
})

describe('planTours', () => {
  it('처음 설치면 처음 사용 안내만 보이고, 지금 버전까지의 새 기능 안내는 본 것으로 적는다', () => {
    expect(plan({ currentVersion: '0.1.22' })).toEqual({ run: ['onboarding'], markSeen: ['v0.1.20', 'v0.1.22'] })
  })

  it('처음 설치여도 지금 버전보다 새로운 안내는 건드리지 않는다', () => {
    expect(plan({ currentVersion: '0.1.19' })).toEqual({ run: ['onboarding'], markSeen: [] })
  })

  it('처음 사용 안내를 이미 봤으면 다시 보이지 않는다', () => {
    expect(plan({ currentVersion: '0.1.22', seen: ['onboarding'] }).run).toEqual([])
  })

  it('업데이트하면 마지막 버전 뒤 ~ 지금 버전 사이의 새 기능 안내만, 오래된 것부터 보인다', () => {
    expect(plan({ lastSeenVersion: '0.1.19', currentVersion: '0.1.22' })).toEqual({ run: ['v0.1.20', 'v0.1.22'], markSeen: [] })
    expect(plan({ lastSeenVersion: '0.1.20', currentVersion: '0.1.22' }).run).toEqual(['v0.1.22'])
  })

  it('범위에 새 기능 안내가 없으면 아무것도 보이지 않는다', () => {
    expect(plan({ lastSeenVersion: '0.1.22', currentVersion: '0.1.24' }).run).toEqual([])
    expect(plan({ lastSeenVersion: '0.1.16', currentVersion: '0.1.19' }).run).toEqual([])
  })

  it('버전을 건너뛰어도 사이의 안내를 모두 보인다', () => {
    expect(plan({ lastSeenVersion: '0.1.10', currentVersion: '0.1.25' }).run).toEqual(['v0.1.20', 'v0.1.22', 'v0.1.25'])
  })

  it('이미 본 안내는 빼고, 같은 버전이나 내린 버전에는 보이지 않는다', () => {
    expect(plan({ lastSeenVersion: '0.1.19', currentVersion: '0.1.22', seen: ['v0.1.20'] }).run).toEqual(['v0.1.22'])
    expect(plan({ lastSeenVersion: '0.1.22', currentVersion: '0.1.22' }).run).toEqual([])
    expect(plan({ lastSeenVersion: '0.1.25', currentVersion: '0.1.22' }).run).toEqual([])
  })

  it('쓰던 사람은 처음 사용 안내를 저절로 받지 않는다(마지막 버전 기록이 없어도 쓴 흔적이 있으면)', () => {
    expect(plan({ currentVersion: '0.1.22', hasExistingInstall: true })).toEqual({ run: ['v0.1.20', 'v0.1.22'], markSeen: [] })
    expect(plan({ lastSeenVersion: '0.1.19', currentVersion: '0.1.19', hasExistingInstall: true }).run).toEqual([])
  })

  it('읽을 수 없는 마지막 버전은 기록이 없는 것으로 본다', () => {
    expect(plan({ lastSeenVersion: 'abc', currentVersion: '0.1.22' }).run).toEqual(['onboarding'])
  })
})

describe('둘러보기 등록부', () => {
  it('처음 사용 안내와 v0.1.20 새 기능 안내가 있다', () => {
    expect(tourById('onboarding')?.kind).toBe('onboarding')
    expect(TOURS.filter((tour) => tour.kind === 'feature').map((tour) => tour.version)).toContain('0.1.20')
    expect(latestFeatureTour()?.version).toBe('0.1.20')
  })

  it('id 가 겹치지 않고, 단계마다 글이 있고, 새 기능 안내에는 버전이 있다', () => {
    expect(new Set(TOURS.map((tour) => tour.id)).size).toBe(TOURS.length)
    for (const tour of TOURS) {
      expect(tour.steps.length).toBeGreaterThan(0)
      expect(new Set(tour.steps.map((s) => s.id)).size).toBe(tour.steps.length)
      for (const s of tour.steps) {
        expect(s.title.trim()).not.toBe('')
        expect(s.body.trim()).not.toBe('')
        expect(s.body).not.toContain('—')
      }
      if (tour.kind === 'feature') expect(compareVersions(tour.version ?? '', '0.0.1')).toBeGreaterThan(0)
    }
  })

  it('처음 사용 안내는 9단계, 새 기능 안내는 7단계다', () => {
    expect(tourById('onboarding')?.steps).toHaveLength(9)
    expect(latestFeatureTour()?.steps).toHaveLength(7)
  })
})
