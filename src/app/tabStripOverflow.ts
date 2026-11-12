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
