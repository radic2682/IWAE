import { X } from '@phosphor-icons/react'
import type { TabsState } from './tabs'
import { t } from '../../i18n'

interface TabBarProps {
  state: TabsState
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

/**
 * 탭이 없어도 빈 줄을 그대로 남긴다 — 탭바가 사라지면 아래 내용이
 * 위로 밀려 올라가서, 첫 탭을 여는 순간 화면 전체가 덜컥 내려앉는다.
 * 안내 문구는 PaneShell 의 본문이 갖는다(두 곳이 같은 글을 그리면 안 된다).
 *
 * role="tab" 은 roving tabIndex 를 사용한다. 활성 탭만 순차 포커스에
 * 포함하고 좌우 화살표와 Home/End 로 탭을 활성화하며 이동한다.
 */
export function TabBar({ state, onActivate, onClose }: TabBarProps) {
  return (
    <div className="tabbar" role="tablist">
      {state.tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          tabIndex={tab.id === state.activeId || state.activeId === null && tab === state.tabs[0] ? 0 : -1}
          aria-selected={tab.id === state.activeId}
          className={`tab${tab.id === state.activeId ? ' tab-active' : ''}`}
          onClick={() => onActivate(tab.id)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onActivate(tab.id)
              return
            }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            const tabs = Array.from(
              event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [],
            )
            const currentIndex = tabs.indexOf(event.currentTarget)
            if (currentIndex < 0 || tabs.length === 0) return
            event.preventDefault()
            const nextIndex = event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
            const nextTab = state.tabs[nextIndex]
            tabs[nextIndex]?.focus()
            if (nextTab !== undefined) onActivate(nextTab.id)
          }}
        >
          <span className="tab-title" title={tab.title}>
            {tab.title}
          </span>
          <button
            type="button"
            className="tab-close"
            aria-label={t('{title} 닫기', { title: tab.title })}
            // 닫기가 탭 클릭까지 타고 올라가면 닫기 직전에 한 번 활성화되어
            // 화면이 깜빡인다. 여기서 끊는다.
            onClick={(e) => {
              e.stopPropagation()
              onClose(tab.id)
            }}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
