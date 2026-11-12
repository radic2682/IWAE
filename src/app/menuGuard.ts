/**
 * 메뉴 항목을 고른 직후의 호버 켜짐 막기. 항목을 고르면 메뉴가 사라지는데 포인터는 그 자리에 그대로 있으므로,
 * 메뉴 밑에 있던 내용(메모 카드 등)이 막 생긴 포인터 진입(pointerenter)을 받아 그 카드가 만져진 것처럼 켜진다(칸 ⋯ 메뉴의 「띄우기」 를 노트 칸 위에서 고르면 밑의 메모 카드가 켜졌다).
 * 메뉴(role=menu)의 항목(role=menuitem)을 누른 순간을 적어 두고(앱 안 모든 메뉴가 같다: 칸 ⋯ · 앱(로고) · 세션 · 탭 · 우클릭 · 화면 탭 메뉴),
 * 호버로 켜지는 것들은 그 뒤 짧은 시간(MENU_GUARD_MS) 동안 `menuGuardActive()` 로 비켜 간다. 포인터가 한 번 나갔다 들어오면 보통대로 켜진다.
 * (click 은 누름 하나에 하나뿐이라 메뉴 항목의 click 뒤에 밑 내용으로 가는 click 은 없다 — 막을 것은 호버다.)
 */
export const MENU_GUARD_MS = 350

let activatedAt = Number.NEGATIVE_INFINITY

/** 메뉴 항목을 고른 지 얼마 안 됐는가 */
export function menuGuardActive(now: number = performance.now()): boolean {
  return now - activatedAt < MENU_GUARD_MS
}

/** 시험용 */
export function resetMenuGuard(): void {
  activatedAt = Number.NEGATIVE_INFINITY
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[role="menuitem"]') !== null) activatedAt = performance.now()
  }, true)
}
