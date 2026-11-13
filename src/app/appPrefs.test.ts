// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_PREFS, getAppPrefs, parseAppPrefs, setAppPref } from './appPrefs'

describe('appPrefs — 바 확대', () => {
  it('예전 저장값(확대 없음)은 100% 로 읽고, 잘못된 값은 바로잡는다', () => {
    expect(parseAppPrefs('{"ocr":false}')).toEqual({ ...DEFAULT_APP_PREFS, ocr: false })
    expect(parseAppPrefs('{"leftBarZoom":1.3,"leftBarZoomScale":2,"rightBarZoom":0.5}')).toMatchObject({ leftBarZoom: 1.3, rightBarZoom: 0.8 })
    // 예전 기준(1 = 100%) 의 왼쪽 바 값은 새 기준(0.9 = 100%) 으로 옮긴다: 예전 90% 는 이제 100% 로 보인다
    expect(parseAppPrefs('{"leftBarZoom":0.9}').leftBarZoom).toBe(1)
    expect(parseAppPrefs('{}').leftBarZoom).toBe(1)
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

  it('라이브러리 보기(목록·카드)를 저장하고 모르는 값은 목록으로 둔다', () => {
    setAppPref('libraryView', 'grid')
    expect(getAppPrefs().libraryView).toBe('grid')
    expect(parseAppPrefs('{"libraryView":"grid"}').libraryView).toBe('grid')
    expect(parseAppPrefs('{"libraryView":"x"}').libraryView).toBe('list')
    setAppPref('libraryView', 'list')
  })

  it('형광펜 색 목록: 없으면 기본 4색, 있으면 읽고, 바꾸면 저장된다', () => {
    expect(parseAppPrefs('{}').highlightColors).toEqual(DEFAULT_APP_PREFS.highlightColors)
    expect(parseAppPrefs('{"highlightColors":[{"id":"c_a","name":"반론","fill":"#c7a8ff"}]}').highlightColors).toEqual([{ id: 'c_a', name: '반론', fill: '#c7a8ff' }])
    expect(parseAppPrefs('{"highlightColors":"깨짐"}').highlightColors).toEqual(DEFAULT_APP_PREFS.highlightColors)
    setAppPref('highlightColors', [{ id: 'c_b', name: '근거', fill: '#4cd47a' }])
    expect(parseAppPrefs(window.localStorage.getItem('iwae:app-prefs:v1')).highlightColors[0]?.id).toBe('c_b')
    setAppPref('highlightColors', DEFAULT_APP_PREFS.highlightColors)
  })
})
