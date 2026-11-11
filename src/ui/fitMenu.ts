/**
 * position: fixed 로 띄운 메뉴를 창 안으로 들인다.
 * 열릴 때 작게 시작하는 애니메이션(transform) 중에 getBoundingClientRect 로 재면 실제보다 작아
 * 아래·오른쪽 끝에서 메뉴가 잘린다. 그래서 transform 과 상관없는 레이아웃 크기(offsetWidth/Height)와
 * 지정한 left/top 으로 계산한다. 창보다 길면 높이를 줄이고 안에서 스크롤한다.
 */
export function fitMenuInViewport(element: HTMLElement, margin = 8): void {
  const viewWidth = window.innerWidth
  const viewHeight = window.innerHeight
  const maxHeight = Math.max(0, viewHeight - margin * 2)
  if (element.offsetHeight > maxHeight) {
    element.style.maxHeight = `${maxHeight}px`
    element.style.overflowY = 'auto'
  }
  const width = element.offsetWidth
  const height = Math.min(element.offsetHeight, maxHeight)
  const left = Number.parseFloat(element.style.left) || element.offsetLeft
  const top = Number.parseFloat(element.style.top) || element.offsetTop
  if (top + height > viewHeight - margin) element.style.top = `${Math.max(margin, viewHeight - height - margin)}px`
  if (left + width > viewWidth - margin) element.style.left = `${Math.max(margin, viewWidth - width - margin)}px`
}
