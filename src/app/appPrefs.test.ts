// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_PREFS, getAppPrefs, parseAppPrefs, setAppPref } from './appPrefs'

describe('appPrefs — 바 확대', () => {
  it('예전 저장값(확대 없음)은 100% 로 읽고, 잘못된 값은 바로잡는다', () => {
    expect(parseAppPrefs('{"ocr":false}')).toEqual({ ...DEFAULT_APP_PREFS, ocr: false })
    expect(parseAppPrefs('{"leftBarZoom":1.3,"rightBarZoom":0.5}')).toMatchObject({ leftBarZoom: 1.3, rightBarZoom: 0.8 })
    expect(parseAppPrefs('{"leftBarZoom":"big","rightBarZoom":99}')).toMatchObject({ leftBarZoom: 1, rightBarZoom: 1.5 })
    expect(parseAppPrefs('깨진 글')).toEqual(DEFAULT_APP_PREFS)
    expect(parseAppPrefs(null)).toEqual(DEFAULT_APP_PREFS)
  })

  it('왼쪽·오른쪽 배율은 따로 저장되고 80~150% 로 제한된다', () => {
    setAppPref('leftBarZoom', 1.2)
    setAppPref('rightBarZoom', 5)
    expect(getAppPrefs().leftBarZoom).toBe(1.2)
    expect(getAppPrefs().rightBarZoom).toBe(1.5)
    const saved = parseAppPrefs(window.localStorage.getItem('iwae:app-prefs:v1'))
    expect(saved.leftBarZoom).toBe(1.2)
    expect(saved.rightBarZoom).toBe(1.5)
    // 다른 설정은 그대로
    expect(saved.ocr).toBe(true)
    setAppPref('leftBarZoom', 1)
    setAppPref('rightBarZoom', 1)
  })

  it('펼친 라이브러리 배율은 왼쪽 바와 따로 저장된다', () => {
    setAppPref('libraryZoom', 1.4)
    expect(getAppPrefs().libraryZoom).toBe(1.4)
    expect(getAppPrefs().leftBarZoom).toBe(1)
    expect(parseAppPrefs('{"libraryZoom":9}').libraryZoom).toBe(1.5)
    expect(parseAppPrefs('{}').libraryZoom).toBe(1)
    setAppPref('libraryZoom', 1)
  })
})
