import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UPDATE_PREFERENCES,
  parseUpdatePreferences,
  shouldNotifyUpdate,
} from './updatePreferences'

describe('updatePreferences', () => {
  it('손상된 값은 알림 전용 기본값으로 복구한다', () => {
    expect(parseUpdatePreferences(null)).toEqual(DEFAULT_UPDATE_PREFERENCES)
    expect(parseUpdatePreferences({ autoCheck: 'yes' })).toEqual(DEFAULT_UPDATE_PREFERENCES)
  })

  it('숨긴 버전만 다시 표시하지 않는다', () => {
    const preferences = parseUpdatePreferences({
      version: 1,
      autoCheck: true,
      autoDownload: false,
      suppressedVersion: '0.1.3',
      lastCheckedAt: null,
    })

    expect(shouldNotifyUpdate(preferences, '0.1.3')).toBe(false)
    expect(shouldNotifyUpdate(preferences, '0.1.4')).toBe(true)
  })
})
