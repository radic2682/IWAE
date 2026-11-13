/**
 * 끌기가 끝난 뒤 따라오는 click 이 아래 요소(탭 전환 · 접기 · 색 바꾸기)에 닿지 않게 막는 공용 도구.
 * 시간이 아니라 포인터로 푼다: 끌기 시작에 걸어 두고, 손을 뗀 다음 한 틱(click 이 지나간 뒤)에 풀며,
 * 새로 누르면(pointerdown) 바로 푼다 — Esc 로 취소했거나 창 밖에서 손을 떼어 pointerup 이 안 온 끌기도 다음 진짜 클릭을 삼키지 않는다.
 */
export interface ClickSuppressOptions {
  /** 이미 손을 뗀 뒤에 거는 것이면 true: 한 틱 뒤에 푼다(기본은 손을 뗄 때까지 기다린다) */
  readonly released?: boolean
  /** false 면 click 을 직접 삼키지 않고 걸려 있는 동안만 알린다(onRelease 로 알아채는 쪽이 스스로 막을 때) */
  readonly swallow?: boolean
  /** 풀렸다 */
  readonly onRelease?: () => void
}

/** 걸고, 푸는 함수를 돌려준다(여러 번 불러도 한 번만 풀린다) */
export function armClickSuppress(options: ClickSuppressOptions = {}): () => void {
  const { released = false, swallow = true, onRelease } = options
  let done = false
  let timer: number | null = null
  const swallowClick = (event: Event) => {
    event.stopPropagation()
    event.preventDefault()
  }
  const release = () => {
    if (done) return
    done = true
    window.removeEventListener('click', swallowClick, true)
    window.removeEventListener('pointerup', afterUp, true)
    window.removeEventListener('pointercancel', afterUp, true)
    window.removeEventListener('pointerdown', release, true)
    if (timer !== null) window.clearTimeout(timer)
    onRelease?.()
  }
  function afterUp() {
    if (timer === null) timer = window.setTimeout(release, 0)
  }
  if (swallow) window.addEventListener('click', swallowClick, true)
  window.addEventListener('pointerdown', release, true)
  if (released) {
    afterUp()
  } else {
    window.addEventListener('pointerup', afterUp, true)
    window.addEventListener('pointercancel', afterUp, true)
  }
  return release
}
