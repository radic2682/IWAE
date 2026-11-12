import { dockZoneBox, insertionIndexAt, type DockEdge } from './tabDock'
import type { TabDropTarget } from './tabDock'
import type { PaneId } from './tabs'
import type { LibraryDoc, VaultMarkdownNode } from '../core/vaultTree'
import { createDockVisuals, dockZoneInCard, layoutBox, paneHitAt, tabsIn } from './tabDrag'

/**
 * 왼쪽 바(문서 · 노트 줄)에서 칸으로 끌어 놓기. 탭 끌기와 같은 구역 판정 · 미리보기 · 탭 줄 틈(tabDrag)을 쓴다 —
 * 미리보기가 보이는 자리에는 놓으면 꼭 열린다(나눌 수 없는 가장자리는 미리보기 없이 가운데로 본다).
 *
 * 끄는 동안 body 에 dock-dragging 을 달아 칸 안 내용에 마우스가 걸리지 않게 하고(올려 둔 카드가 들뜨지 않게),
 * 받을 수 있는 자리 위일 때만 dock-drop-ok 를 달아 「복사」 커서를 낸다(tab-drag.css).
 */

/** 왼쪽 바에서 끌어 온 것: 열 문서 · 노트 */
export type SidebarDropItem =
  | { readonly kind: 'pdf'; readonly doc: LibraryDoc }
  | { readonly kind: 'markdown'; readonly node: VaultMarkdownNode }
  | { readonly kind: 'note'; readonly path: string }

/** 칸이 왼쪽 바 끌기를 받는 방법(App 이 준다) */
export interface SidebarPaneDrop {
  /** 그 칸에서 item 으로 나눌 수 있는 가장자리들(비어 있으면 가운데만) */
  readonly edgesFor: (pane: PaneId, item: SidebarDropItem) => readonly DockEdge[]
  /** target 에 item 을 보통 탭으로 연다 */
  readonly open: (item: SidebarDropItem, target: TabDropTarget) => void
}

export interface DockSessionHost {
  /** 그 칸에서 나눌 수 있는 가장자리들(비어 있으면 가운데만) */
  edgesFor(pane: PaneId): readonly DockEdge[]
}

export interface DockSession {
  /** 포인터가 (x, y) 에 있다. 놓으면 열릴 자리(미리보기가 보이는 자리)를 돌려준다. 없으면 null */
  update(x: number, y: number): TabDropTarget | null
  /** 표시를 모두 치운다 */
  end(): void
}

/** 탭 줄에 열 틈의 너비(끌어 온 알약 하나 + 간격) */
export const PILL_GAP_PX = 203

export function startDockSession(host: DockSessionHost): DockSession {
  const visuals = createDockVisuals()
  document.body.classList.add('dock-dragging')
  return {
    update(x, y) {
      const hit = paneHitAt(x, y)
      if (hit.kind === 'strip') {
        visuals.showPreview(null)
        visuals.markZone(hit.zone)
        const index = insertionIndexAt(tabsIn(hit.strip).map(layoutBox), x)
        visuals.setGap(hit.strip, index, PILL_GAP_PX)
        document.body.classList.add('dock-drop-ok')
        return { kind: 'strip', pane: hit.pane, index }
      }
      visuals.clearGap()
      visuals.markZone(null)
      if (hit.kind === 'body') {
        const { zone, box } = dockZoneInCard(hit.card, x, y, host.edgesFor(hit.pane))
        visuals.showPreview(dockZoneBox(box, zone))
        document.body.classList.add('dock-drop-ok')
        return { kind: 'body', pane: hit.pane, zone }
      }
      visuals.showPreview(null)
      document.body.classList.remove('dock-drop-ok')
      return null
    },
    end() {
      visuals.clear(true)
      document.body.classList.remove('dock-dragging', 'dock-drop-ok')
    },
  }
}

export interface PillGhost {
  readonly element: HTMLElement
  /** 화면에 올린다(들린 모양으로). core/internalDrag 는 element 를 스스로 올리므로 lift 만 부른다 */
  attach(): void
  lift(): void
  /** 포인터 (x, y) 를 알약 한가운데에 둔다 */
  move(x: number, y: number): void
  remove(): void
}

/**
 * 끄는 줄의 「아이콘 + 이름」 알약. 탭을 끌 때의 들린 탭과 같은 껍질(tab-drag.css)이라 같은 모양으로 뜬다 —
 * 들리는 것은 이 알약 하나뿐이다. icon 은 줄의 아이콘 요소(복제해서 쓴다)
 */
export function createPillGhost(icon: Element | null, title: string): PillGhost {
  const root = document.createElement('div')
  root.className = 'tab-drag-ghost topbar-panetab-zone pane-head'
  root.setAttribute('aria-hidden', 'true')
  const menu = document.createElement('div')
  menu.className = 'pane-tabs-menu pane-tabs-focused'
  const strip = document.createElement('div')
  strip.className = 'pane-tabs-strip'
  const pill = document.createElement('div')
  pill.className = 'pane-top-tab pane-top-tab-active'
  const body = document.createElement('span')
  body.className = 'pane-top-tab-title'
  if (icon !== null) {
    const clone = icon.cloneNode(true) as HTMLElement
    clone.classList.add('pane-top-tab-kind')
    body.append(clone)
  }
  const label = document.createElement('span')
  label.className = 'pane-top-tab-label'
  label.textContent = title
  body.append(label)
  pill.append(body)
  pill.style.width = `${PILL_GAP_PX - 3}px`
  pill.style.flex = '0 0 auto'
  strip.append(pill)
  menu.append(strip)
  root.append(menu)
  root.style.width = `${PILL_GAP_PX + 37}px`
  root.style.height = '36px'
  return {
    element: root,
    attach() {
      document.body.append(root)
      void root.offsetWidth
      root.classList.add('tab-drag-ghost-lifted')
    },
    lift() {
      void root.offsetWidth
      root.classList.add('tab-drag-ghost-lifted')
    },
    move(x, y) {
      root.style.transform = `translate3d(${x - root.offsetWidth / 2}px, ${y - root.offsetHeight / 2}px, 0)`
    },
    remove() { root.remove() },
  }
}
