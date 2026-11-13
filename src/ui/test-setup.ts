import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { setLocale } from '../i18n'

// 테스트는 한국어 화면을 기준으로 쓴다(시험 환경의 시스템 언어는 영어라 따로 정한다).
// 영어 화면을 보려는 시험은 그 안에서 setLocale('en') 을 부른다
setLocale('ko')
beforeEach(() => setLocale('ko'))

/**
 * jsdom 에는 포인터 캡처가 없다. Element.prototype.setPointerCapture 가
 * 아예 없어서, 구분선의 onPointerDown 이 첫 줄에서 그대로 터진다 —
 * 드래그 수명주기(크로스토크, pointerup 유실, 취소)를 테스트로 못박으려면
 * 이 대역이 먼저 있어야 한다.
 *
 * 관측 없이 호출만 삼킨다. 캡처의 실제 효용은 "커서가 요소 밖으로 나가도
 * 이벤트를 계속 받는다"인데, 테스트는 window 에 이벤트를 직접 쏘므로
 * 캡처가 있든 없든 같은 리스너가 같은 순서로 불린다. 흉내낼 동작이 없다.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.setPointerCapture !== 'function') {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

if (typeof window !== 'undefined' && typeof window.DOMMatrixReadOnly !== 'function') {
  class DOMMatrixReadOnlyStub {
    readonly m22 = 1
  }
  Object.defineProperty(window, 'DOMMatrixReadOnly', {
    configurable: true,
    value: DOMMatrixReadOnlyStub,
  })
}

/**
 * vitest.config.ts 는 test.globals 를 켜지 않는다 — 각 테스트가 무엇을
 * 쓰는지 import 문만 보고 알 수 있게 하려는 선택이다. 그런데
 * @testing-library/react 의 자동 cleanup 은 전역 `afterEach` 가
 * 있는지 `typeof afterEach === 'function'` 로 검사해서 등록하므로,
 * 전역이 꺼져 있으면 절대 등록되지 않는다. 그 결과 한 .tsx 테스트에서
 * render 한 DOM 이 지워지지 않고 다음 테스트까지 남아 getByRole 이
 * 이전 렌더와 현재 렌더를 모두 찾아 "multiple elements" 로 터진다.
 * 여기서 명시적으로 불러와 등록한다. render() 를 부르지 않는(node
 * 환경) 테스트 파일에서는 마운트된 것이 없어 그냥 아무 일도 안 한다.
 */
afterEach(() => {
  cleanup()
  if (typeof localStorage !== 'undefined') localStorage.clear()
})

// 사이드바 폴더는 앱에서 접힌 것이 기본이지만, 테스트는 안쪽 문서를 바로 찾을 수 있게 펼쳐 둔다
import { sidebarDefaults } from '../app/sidebar/sidebarDefaults'
sidebarDefaults.expandAll = true
