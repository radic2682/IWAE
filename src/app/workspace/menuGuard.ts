/**
 * 메뉴 항목을 고른 직후의 호버 켜짐 막기. 항목을 고르면 메뉴가 사라지는데 포인터는 그 자리에 그대로 있으므로,
 * 메뉴 밑에 있던 내용(메모 카드 · 문서 형광펜 등)이 막 생긴 포인터 진입을 받아 마우스를 올린 것처럼 켜진다(칸 ⋯ 메뉴의 「띄우기」 를 노트 칸 위에서 고르면 밑의 메모 카드가 켜졌다).
 *
 * 고정 시간이 아니라 포인터가 진짜 움직일 때까지다: 메뉴 항목(role=menuitem) · 목록 고르기 항목(role=option) · 탭 목록 뒷판을 누르면 막기를 켜고(앱 안 모든 메뉴가 같다),
 * 움직임(movementX/Y)이 0 이 아닌 첫 pointermove 나 새 누름(pointerdown)에서 끈다 — 레이아웃이 바뀐 뒤 브라우저가 만드는 합성 pointermove 는 움직임이 0 이라 끄지 못한다.
 * 호버로 켜지는 것들은 `menuGuardActive()` 로 비켜 가고, 비켜 간 채 포인터가 진짜 움직이면 그때 켠다(그 자리에서 pointermove 를 받아 `!menuGuardActive()` 를 다시 본다).
 * (click 은 누름 하나에 하나뿐이라 메뉴 항목의 click 뒤에 밑 내용으로 가는 click 은 없다 — 막을 것은 호버다.)
 */
let armed = false

/** 메뉴 항목을 고른 뒤 포인터가 아직 움직이지 않았는가 */
export function menuGuardActive(): boolean {
  return armed
}

/** 시험용 */
export function resetMenuGuard(): void {
  armed = false
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[role="menuitem"], [role="option"], .pane-tabs-backdrop') !== null) armed = true
  }, true)
  window.addEventListener('pointermove', (event) => {
    if (armed && (event.movementX !== 0 || event.movementY !== 0)) armed = false
  }, true)
  window.addEventListener('pointerdown', () => { armed = false }, true)
}
