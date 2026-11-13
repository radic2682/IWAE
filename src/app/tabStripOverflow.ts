/**
 * 탭 줄에서 가려진 탭이 있는가. 탭이 하나뿐이면 목록 단추(⌄ n)로 고를 다른 탭이 없으니 늘 아니다.
 * 탭 줄 양쪽 안쪽 여백(보는 탭의 곡선 자리)은 빼고, 탭이 그 안에서 1px 넘게 삐져나가면 가려진 것으로 본다.
 */
export function hasHiddenTabs(strip: HTMLElement): boolean {
  const tabs = Array.from(strip.querySelectorAll<HTMLElement>('.pane-top-tab'))
  if (tabs.length < 2) return false
  const box = strip.getBoundingClientRect()
  const style = getComputedStyle(strip)
  const left = box.left + (Number.parseFloat(style.paddingLeft) || 0)
  const right = box.right - (Number.parseFloat(style.paddingRight) || 0)
  return tabs.some((tab) => {
    const at = tab.getBoundingClientRect()
    return at.left < left - 1 || at.right > right + 1
  })
}

/**
 * 탭 제목 줄(.pane-top-tab-title) 안에 「제목 · 보조 글」 이 통째로 들어가는가.
 * 보조 글(.pane-top-tab-sub)과 「·」 는 감춰도 자리를 재도록 절대 위치로 남아 있으므로 자연 폭을 잴 수 있다.
 * 레이아웃이 없으면(폭 0) 들어간다고 본다.
 */
export function subFitsInTitle(title: HTMLElement | null): boolean {
  if (title === null || title.clientWidth <= 0) return true
  const label = title.querySelector<HTMLElement>('.pane-top-tab-label')
  const sep = title.querySelector<HTMLElement>('.pane-top-tab-sep')
  const sub = title.querySelector<HTMLElement>('.pane-top-tab-sub')
  if (label === null || sep === null || sub === null) return true
  const style = getComputedStyle(title)
  const gap = Number.parseFloat(style.columnGap) || 0
  const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  let others = 0
  let count = 0
  for (const child of Array.from(title.children)) {
    if (child === label || child === sep || child === sub) continue
    others += child.getBoundingClientRect().width
    count += 1
  }
  // 제목 · 「·」 · 보조 글 세 칸이 더해져 칸 수는 count + 3, 사이 간격은 count + 2 개
  // 「·」 의 바깥 여백(음수: screens.css 의 margin 0 -2px)도 센다 — 실제로 차지하는 폭과 같게
  const sepStyle = getComputedStyle(sep)
  const sepMargin = (Number.parseFloat(sepStyle.marginLeft) || 0) + (Number.parseFloat(sepStyle.marginRight) || 0)
  const need = label.scrollWidth + sep.getBoundingClientRect().width + sepMargin + sub.scrollWidth + others + gap * (count + 2) + padding
  return need <= title.clientWidth
}

/**
 * 이름이 다 보이지 않는 탭의 id: 제목이 줄임표(…)로 잘렸거나, 아주 좁아져 아이콘만 남아 이름이 감춰진 탭.
 * 이런 탭에만 말풍선(title)으로 이름을 보인다 — 이름이 다 보이는 탭에 같은 이름의 말풍선이 또 뜨지 않게.
 * 레이아웃이 없으면(폭 0, jsdom) 잘린 탭이 없다.
 */
export function tabsWithHiddenTitle(strip: HTMLElement): string[] {
  const hidden: string[] = []
  for (const tab of Array.from(strip.querySelectorAll<HTMLElement>('.pane-top-tab'))) {
    const id = tab.dataset.tabId
    const label = tab.querySelector<HTMLElement>('.pane-top-tab-label')
    if (id === undefined || label === null || tab.clientWidth <= 0) continue
    const iconOnly = getComputedStyle(label).display === 'none'
    if (iconOnly || label.scrollWidth > label.clientWidth) hidden.push(id)
  }
  return hidden
}
