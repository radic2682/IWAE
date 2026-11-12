import { SOURCE_LINK_PREFIX, type LinkItem, type LinkRect } from './workspaceLinks'

/**
 * 문서 창이 내놓는 「캔버스 블록의 출처 자리」: 문서 위에 그려 둔 출처 표시(attribute 를 단 요소)를 읽어
 * 블록 하나에 사각형 하나(첫 조각)로 돌려준다. 몸통(body) 밖으로 나간 것은 뺀다.
 * 출처 표시는 캔버스가 그 문서의 블록을 가질 때만 그려지므로, 보통은 한두 개를 읽는다.
 */
export function sourceTargetItems(root: Element, attribute: string, body: LinkRect): LinkItem[] {
  const items: LinkItem[] = []
  const seen = new Set<string>()
  for (const element of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
    const blockId = element.getAttribute(attribute)
    if (blockId === null || blockId === '' || seen.has(blockId)) continue
    const rect = element.getBoundingClientRect()
    if (rect.height === 0 && rect.width === 0) continue
    const y = rect.top + Math.min(rect.height / 2, 10)
    if (y < body.top || y > body.bottom) continue
    seen.add(blockId)
    items.push({ id: `${SOURCE_LINK_PREFIX}${blockId}`, y, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } })
  }
  return items
}
