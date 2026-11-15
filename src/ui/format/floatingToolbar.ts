import { FORMAT_FLOAT_MARGIN_PX } from './formatBarPlace'

/** 떠 있는 상단바 도구줄 카드(= 도구줄 자리 .topbar-toolbar-host 가 data-floating 일 때) */
export const FLOATING_TOOLBAR_SELECTOR = '.topbar-toolbar-host[data-floating]'

/**
 * 떠 있는 도구줄 카드가 지금보다 더 커질 수 있는 폭(px). 카드는 내용 폭만큼만 차지하고(창 − 여유 안에서) 내용이 접히면 카드도 같이 줄어든다 —
 * 그래서 안의 도구가 「⋯」 로 접을지 펼칠지는 자리의 지금 폭이 아니라 이 폭까지 더해서 판단해야, 창이 넓어졌을 때 다시 펼쳐진다.
 * 붙어 있거나 도구줄 밖이면 0.
 */
export function floatingExtraWidth(element: Element, viewWidth = window.innerWidth): number {
  const card = element.closest<HTMLElement>(FLOATING_TOOLBAR_SELECTOR)
  if (card === null) return 0
  return Math.max(0, viewWidth - 2 * FORMAT_FLOAT_MARGIN_PX - card.getBoundingClientRect().width)
}
