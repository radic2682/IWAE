import { insertionIndexAt, type DockEdge } from './tabDock'
import type { TabDropTarget } from './tabDock'
import type { PaneId } from './tabs'
import type { LibraryDoc, VaultMarkdownNode } from '../core/vaultTree'
import { GHOST_EDGE_MARGIN, clampGhostPos } from './ghostPlace'
import { GHOST_PAD_X, GHOST_PAD_Y, buildGhostShell, createDockVisuals, layoutBox, paintDockTarget, paneHitAt, resolveDockTarget, setDockDragging, setDockDropOk, tabsIn } from './tabDrag'

/**
 * 왼쪽 바(문서 · 노트 줄)에서 칸으로 끌어 놓기. 탭 끌기와 같은 구역 판정 · 미리보기 · 탭 줄 틈(tabDrag)을 쓴다 —
 * 미리보기가 보이는 자리에는 놓으면 꼭 열린다(나눌 수 없는 가장자리는 미리보기 없이 가운데로 본다).
 *
 * 끄는 동안 body 에 dock-dragging 을 달아 칸 안 내용에 마우스가 걸리지 않게 하고(올려 둔 카드가 들뜨지 않게),
 * 받을 수 있는 자리 위일 때만 dock-drop-ok 를 달아 「복사」 커서를 낸다(tab-drag.css, tabDrag 의 setDockDragging · setDockDropOk).
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

/** 끌어 온 알약(「아이콘 + 이름」)의 너비 · 높이(px): 들린 알약도, 탭 줄에 여는 틈도 이 크기다(틈은 탭 줄이 탭 사이 간격을 더해 연다) */
export const PILL_WIDTH_PX = 200
export const PILL_HEIGHT_PX = 28

export function startDockSession(host: DockSessionHost): DockSession {
  const visuals = createDockVisuals()
  setDockDragging(true)
  return {
    update(x, y) {
      const target = resolveDockTarget(paneHitAt(x, y), x, y, host.edgesFor)
      if (target.kind === 'strip') {
        const index = insertionIndexAt(tabsIn(target.strip).map(layoutBox), x)
        paintDockTarget(visuals, target, { index, tabWidth: PILL_WIDTH_PX })
        setDockDropOk(true)
        return { kind: 'strip', pane: target.pane, index }
      }
      paintDockTarget(visuals, target, null)
      setDockDropOk(target.kind === 'body')
      return target.kind === 'body' ? { kind: 'body', pane: target.pane, zone: target.zone } : null
    },
    end() {
      visuals.clear(true)
      setDockDragging(false)
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
  const root = buildGhostShell('topbar-panetab-zone pane-head', pill, PILL_WIDTH_PX, PILL_HEIGHT_PX)
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
      // 껍질의 투명 여백(좌우 20 · 위아래 4)을 뺀 보이는 알약이 창 가장자리 8px 안에 들도록 민다
      const at = clampGhostPos(x - root.offsetWidth / 2, y - root.offsetHeight / 2, root.offsetWidth, root.offsetHeight, window.innerWidth, window.innerHeight, GHOST_EDGE_MARGIN - GHOST_PAD_X / 2, GHOST_EDGE_MARGIN - GHOST_PAD_Y / 2)
      root.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`
    },
    remove() { root.remove() },
  }
}
