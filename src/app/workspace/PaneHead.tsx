import { useRef, useState, type ReactNode } from 'react'
import { ArrowsLeftRight, ArrowsInSimple, ArrowsOutSimple, ArrowSquareOut, Circle, DotsThree, PictureInPicture, Rows, SquareSplitHorizontal, X } from '@phosphor-icons/react'
import type { SplitDir } from '../../core/layoutTree'
import { t } from '../../i18n'
import { PopupMenu } from '../PopupMenu'
import '../../ui/screens.css'
import type { PaneChannel } from './workspaceChannels'

/**
 * 칸 머리(설계 3): 모든 칸의 맨 위에 탭 줄(색 점 · 칸 번호 · 탭들)과 ⋯ 메뉴가 놓인다. 칸이 하나여도 같다.
 * 「크게」로 키운 칸에는 작은 「Z」가 붙는다(누르면 되돌린다). 메뉴의 키 힌트는 지금 접두키(prefixText)를 앞에 붙인 키캡이고, 키가 없는 항목(띄우기)은 힌트가 없다. 색 바꾸기는 지금 값(색 점 + 이름)을 값 모양으로 보인다.
 */
export interface PaneHeadProps {
  /** 탭 줄(PaneTabsMenu: 색 점 · 칸 번호 · 탭들) */
  readonly tabs: ReactNode
  /** 이 화면의 칸 수 */
  readonly paneCount: number
  /** 칸을 나누고 떼는 것을 허용하는가(떼어 낸 창은 아니다). 기본 true */
  readonly splitEnabled?: boolean
  /** 이 칸이 「크게」로 화면 전체를 차지하고 있는가 */
  readonly zoomed: boolean
  readonly onSplit: (dir: SplitDir) => void
  readonly onToggleZoom: () => void
  /** 새 화면으로 떼기(break-pane) */
  readonly onBreak: () => void
  /** 칸 자리 바꾸기(swap-pane): 다음 칸과(맨 끝 칸이면 앞 칸과) */
  readonly onSwap: () => void
  /** 띄우기(float-pane): 이 칸을 떼어 화면 위에 띄운다. 하나뿐인 칸은 못 한다 */
  readonly onFloat?: () => void
  readonly onCycleChannel: () => void
  readonly onClose: () => void
  readonly channel: PaneChannel
  /** 지금 접두키 표기(`Ctrl+B` · `⌃B`). 메뉴 키 힌트 앞에 붙는다 */
  readonly prefixText?: string
}

const CHANNEL_NAME: Record<'blue' | 'green' | 'orange' | 'none', string> = {
  blue: '파랑',
  green: '초록',
  orange: '주황',
  none: '없음',
}

export function PaneHead({ tabs, paneCount, splitEnabled = true, zoomed, onSplit, onToggleZoom, onBreak, onSwap, onFloat, onCycleChannel, onClose, channel, prefixText = 'Ctrl+B' }: PaneHeadProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [at, setAt] = useState<{ right: number; top: number } | null>(null)

  const toggle = () => {
    if (open) { setOpen(false); return }
    const box = buttonRef.current?.getBoundingClientRect()
    setAt(box === undefined ? null : { right: Math.max(window.innerWidth - box.right, 8), top: box.bottom + 4 })
    setOpen(true)
  }
  const run = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  const multi = paneCount > 1
  const hint = (key: string) => `${prefixText} ${key}`

  return (
    <>
      {tabs}
      {/* 칸별 상태 표시 자리(비어 있다). 단계 4 이후에 채운다 */}
      <span className="pane-head-status" data-slot="status" aria-hidden="true" />
      {/* 자주 쓰는 칸 동작은 메뉴 밖으로 꺼내 둔다(메뉴에도 그대로 있다). 칸이 하나뿐이면 메뉴가 끄는 경우와 같이 숨긴다. 좁은 머리(300px 미만)에서는 CSS 가 숨긴다 */}
      {multi || zoomed ? (
        <button type="button" className="pane-head-act pane-head-zoom" aria-pressed={zoomed} aria-label={zoomed ? t('원래 크기로') : t('이 칸 확대')} title={`${zoomed ? t('원래 크기로') : t('이 칸 확대')} (${hint('z')})`} onClick={onToggleZoom}>
          {zoomed ? <ArrowsInSimple size={16} aria-hidden="true" /> : <ArrowsOutSimple size={16} aria-hidden="true" />}
        </button>
      ) : null}
      {multi ? (
        <button type="button" className="pane-head-act pane-head-close" aria-label={t('칸 닫기')} title={`${t('칸 닫기')} (${hint('x')})`} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
      <button
        ref={buttonRef}
        type="button"
        className="pane-head-more"
        aria-label={t('칸 메뉴')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('칸 메뉴')}
        onClick={toggle}
      >
        <DotsThree size={16} weight="bold" aria-hidden="true" />
      </button>
      {open && at !== null ? (
        <PopupMenu
          label={t('칸 메뉴')}
          right={at.right}
          top={at.top}
          anchorRef={buttonRef}
          onClose={(restoreFocus) => { setOpen(false); if (restoreFocus) buttonRef.current?.focus() }}
        >
          <button type="button" role="menuitem" disabled={!splitEnabled} onClick={run(() => onSplit('h'))}>
            <SquareSplitHorizontal size={15} aria-hidden="true" /><span>{t('오른쪽으로 나누기')}</span><kbd>{hint('%')}</kbd>
          </button>
          <button type="button" role="menuitem" disabled={!splitEnabled} onClick={run(() => onSplit('v'))}>
            <Rows size={15} aria-hidden="true" /><span>{t('아래로 나누기')}</span><kbd>{hint('"')}</kbd>
          </button>
          <button type="button" role="menuitem" disabled={!multi && !zoomed} onClick={run(onToggleZoom)}>
            <ArrowsOutSimple size={15} aria-hidden="true" /><span>{zoomed ? t('원래 크기로') : t('이 칸 확대')}</span><kbd>{hint('z')}</kbd>
          </button>
          <button type="button" role="menuitem" disabled={!multi || !splitEnabled} onClick={run(onBreak)}>
            <ArrowSquareOut size={15} aria-hidden="true" /><span>{t('새 화면으로 분리')}</span><kbd>{hint('!')}</kbd>
          </button>
          <button type="button" role="menuitem" disabled={!multi || onFloat === undefined} title={multi ? undefined : t('칸이 하나뿐이라 띄울 수 없습니다')} onClick={run(() => onFloat?.())}>
            <PictureInPicture size={15} aria-hidden="true" /><span>{t('띄우기')}</span>
          </button>
          <button type="button" role="menuitem" disabled={!multi} onClick={run(onSwap)}>
            <ArrowsLeftRight size={15} aria-hidden="true" /><span>{t('칸 자리 바꾸기')}</span><kbd>{hint('{ }')}</kbd>
          </button>
          <div className="pane-tab-context-sep" role="separator" />
          <button type="button" role="menuitem" onClick={run(onCycleChannel)}>
            <Circle size={15} aria-hidden="true" /><span>{t('색 바꾸기')}</span>
            {/* 지금 값(작은 색 점 + 이름): 단축키가 아니므로 키캡이 아니라 값 모양 */}
            <span className="menu-value" data-channel={channel ?? 'none'}><span className="menu-value-dot" aria-hidden="true" />{t(CHANNEL_NAME[channel ?? 'none'])}</span>
          </button>
          <button type="button" role="menuitem" disabled={!multi} onClick={run(onClose)}>
            <X size={15} aria-hidden="true" /><span>{t('칸 닫기')}</span><kbd>{hint('x')}</kbd>
          </button>
        </PopupMenu>
      ) : null}
    </>
  )
}
