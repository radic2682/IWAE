/**
 * 왼쪽 바 트리(문서·노트·라이브러리 폴더)의 키보드 이동. 행 마크업(`li[role=treeitem]`)은 그대로 두고
 * 문서 하나에 위임 이벤트를 걸어서, 트리가 어디에 그려지든 같은 방식으로 움직인다.
 *
 *  ↑ ↓        이전·다음 보이는 행으로
 *  →          접힌 폴더는 펼치고, 펼친 폴더는 첫 자식으로
 *  ←          펼친 폴더는 접고, 아니면 부모 행으로
 *  Home / End 처음·마지막 행
 *  Enter·Space 는 행의 단추가 원래대로 받는다(열기·토글)
 *
 * roving tabindex: 트리마다 행의 대표 단추 하나만 Tab 으로 닿는다(나머지는 -1). 마지막으로 초점을 받은 행이 그 하나다.
 */
const TREE_ROOT = '[role="tree"], ul.side-tree'
const ROW = 'li[role="treeitem"]'

function primaryOf(row: HTMLElement): HTMLElement | null {
  const line = row.querySelector<HTMLElement>(':scope > .side-tree-row') ?? row
  return line.querySelector<HTMLElement>('button, a[href], [tabindex]')
}

function isShown(element: HTMLElement): boolean {
  return element.getClientRects().length > 0
}

function rowsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ROW)].filter((row) => {
    const primary = primaryOf(row)
    return primary !== null && isShown(primary)
  })
}

function depthOf(row: HTMLElement): number {
  const styled = (row.querySelector<HTMLElement>(':scope > .side-tree-row') ?? row).style.getPropertyValue('--side-tree-depth')
  if (styled !== '') return Number(styled) || 0
  let depth = 0
  for (let parent = row.parentElement?.closest(ROW) ?? null; parent !== null; parent = parent.parentElement?.closest(ROW) ?? null) depth += 1
  return depth
}

function rootOf(target: Element): HTMLElement | null {
  return target.closest<HTMLElement>(TREE_ROOT)
}

/** 키 하나를 처리했으면 true */
export function handleTreeKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false
  const target = event.target
  if (!(target instanceof HTMLElement) || target.closest('input, textarea, select, [contenteditable="true"]') !== null) return false
  const root = rootOf(target)
  const row = target.closest<HTMLElement>(ROW)
  if (root === null || row === null) return false
  // 행 안의 다른 단추(추가·이모지 등)에서는 움직이지 않는다: 대표 단추에서만
  if (primaryOf(row) !== target) return false
  const rows = rowsOf(root)
  const index = rows.indexOf(row)
  if (index < 0) return false
  const go = (next: HTMLElement | undefined) => {
    const primary = next === undefined ? null : primaryOf(next)
    if (primary === null) return
    event.preventDefault()
    primary.focus()
  }
  const expanded = row.getAttribute('aria-expanded')
  if (event.key === 'ArrowDown') go(rows[index + 1])
  else if (event.key === 'ArrowUp') go(rows[index - 1])
  else if (event.key === 'Home') go(rows[0])
  else if (event.key === 'End') go(rows[rows.length - 1])
  else if (event.key === 'ArrowRight') {
    if (expanded === 'false') { event.preventDefault(); target.click() } else if (expanded === 'true') go(rows[index + 1])
  } else if (event.key === 'ArrowLeft') {
    if (expanded === 'true') { event.preventDefault(); target.click() } else {
      const depth = depthOf(row)
      go([...rows.slice(0, index)].reverse().find((candidate) => depthOf(candidate) < depth))
    }
  }
  return true
}

/** 트리마다 대표 단추 하나만 Tab 으로 닿게 한다(`active` 가 있으면 그 행) */
export function applyRoving(root: HTMLElement, active?: HTMLElement | null): void {
  const rows = rowsOf(root)
  if (rows.length === 0) return
  const keep = (active !== undefined && active !== null && rows.includes(active) ? active : null)
    ?? rows.find((row) => primaryOf(row)?.tabIndex === 0 && primaryOf(row)?.dataset.roving === '1')
    ?? rows.find((row) => row.classList.contains('side-tree-node-active') || row.getAttribute('aria-selected') === 'true' || row.querySelector('[aria-current="true"], .active') !== null)
    ?? rows[0]!
  for (const row of rows) {
    const primary = primaryOf(row)
    if (primary === null) continue
    const isKeep = row === keep
    if (isKeep) primary.dataset.roving = '1'
    else delete primary.dataset.roving
    const wanted = isKeep ? '0' : '-1'
    if (primary.getAttribute('tabindex') !== wanted) primary.setAttribute('tabindex', wanted)
  }
}

// ───────── 메뉴 ─────────
/** 팝업 메뉴(우클릭·더보기·앱 메뉴 …): ↑↓ Home End 로 항목 사이를 옮기고, 닫히면 열기 전 요소로 초점을 돌려준다 */
const MENU = '[role="menu"], .app-context-menu, .side-context-menu, .note-menu, .block-context-menu, .canvas-create-menu, .pane-tab-context, .pane-tabs-popover'

function menuItems(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>('button:not(:disabled), [role="menuitem"]:not([aria-disabled="true"])')].filter((item) => item.getClientRects().length > 0 && item.closest(MENU) === menu)
}

export function handleMenuKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return false
  const target = event.target
  if (!(target instanceof HTMLElement) || target.closest('input, textarea, select, [contenteditable="true"]') !== null) return false
  const menu = target.closest<HTMLElement>(MENU)
  if (menu === null) return false
  const items = menuItems(menu)
  const here = items.indexOf(target.closest<HTMLElement>('button, [role="menuitem"]') ?? target)
  if (items.length === 0 || here < 0) return false
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (here + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[next]?.focus()
  return true
}

/** 이 DOM 변화가 트리 안(또는 트리를 더하고 빼는 것)인가 */
function touchesTree(record: MutationRecord): boolean {
  const target = record.target
  if (target instanceof Element && target.closest(TREE_ROOT) !== null) return true
  for (const list of [record.addedNodes, record.removedNodes]) {
    for (const node of list) {
      if (node instanceof Element && (node.matches(TREE_ROOT) || node.querySelector(TREE_ROOT) !== null)) return true
    }
  }
  return false
}

let installed = false

/** 앱 시작 때 한 번. 이미 깔려 있으면 아무것도 하지 않는다 */
export function installTreeKeyboard(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('keydown', (event) => { if (!handleTreeKey(event)) handleMenuKey(event) })
  const openers = new Map<HTMLElement, HTMLElement>()
  document.addEventListener('focusin', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const root = rootOf(target)
    const row = target.closest<HTMLElement>(ROW)
    if (root !== null && row !== null && primaryOf(row) === target) applyRoving(root, row)
  })
  let pending = false
  const refresh = () => {
    pending = false
    for (const root of document.querySelectorAll<HTMLElement>(TREE_ROOT)) applyRoving(root)
  }
  new MutationObserver((records) => {
    // 트리(왼쪽 바)가 바뀐 때만 roving 을 다시 맞춘다: 노트 카드처럼 큰 곳이 바뀔 때마다 줄마다 위치를 재면 레이아웃을 강제한다
    let treeChanged = false
    for (const record of records) {
      if (!treeChanged) treeChanged = touchesTree(record)
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        const menu = node.matches(MENU) ? node : node.querySelector<HTMLElement>(MENU)
        const opener = document.activeElement
        if (menu !== null && opener instanceof HTMLElement && !menu.contains(opener) && opener !== document.body) openers.set(menu, opener)
      }
      for (const node of record.removedNodes) {
        if (!(node instanceof HTMLElement)) continue
        for (const [menu, opener] of openers) {
          if (menu !== node && !node.contains(menu)) continue
          openers.delete(menu)
          // 메뉴 안에 있던 초점이 사라진 경우에만 열던 요소로 돌려준다(다른 곳으로 옮겼다면 그대로)
          window.setTimeout(() => { if (opener.isConnected && (document.activeElement === null || document.activeElement === document.body)) opener.focus({ preventScroll: true }) }, 0)
        }
      }
    }
    if (!treeChanged || pending) return
    pending = true
    window.requestAnimationFrame(refresh)
  }).observe(document.body, { childList: true, subtree: true })
  refresh()
}
