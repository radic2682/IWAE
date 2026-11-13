import { t } from '../i18n'
import { startChannelDrag } from './channelDrag'
import type { PaneId } from './tabs'
import type { PaneChannel } from './workspaceChannels'
import '../ui/tab-menu.css'

/** 점의 설명(말풍선·접근성 이름) */
function channelTitle(channel: PaneChannel): string {
  if (channel === 'blue') return t('파랑 채널: 같은 색 칸끼리 연동합니다. 눌러서 색 바꾸기, 다른 칸으로 끌어서 연결')
  if (channel === 'green') return t('초록 채널: 같은 색 칸끼리 연동합니다. 눌러서 색 바꾸기, 다른 칸으로 끌어서 연결')
  if (channel === 'orange') return t('주황 채널: 같은 색 칸끼리 연동합니다. 눌러서 색 바꾸기, 다른 칸으로 끌어서 연결')
  return t('채널 없음: 다른 칸과 연동하지 않습니다. 눌러서 색 바꾸기, 다른 칸으로 끌어서 연결')
}

/**
 * 창 머리의 색 점. 같은 색의 창끼리만 서로 가리킨다(형광펜 ↔ 노트 카드 …). 누를 때마다 파랑 → 초록 → 주황 → 없음.
 * 점을 다른 칸으로 끌어 놓으면 그 칸과 같은 색으로 이어진다(pane 을 주면; channelDrag.ts).
 * 탭 줄 맨 앞에 작게 둔다 — 창이 하나뿐이면 App 이 그리지 않는다.
 */
export function ChannelDot({ channel, onCycle, pane }: { readonly channel: PaneChannel; readonly onCycle: () => void; readonly pane?: PaneId }) {
  const title = channelTitle(channel)
  return (
    <button
      type="button"
      className="pane-channel-dot"
      data-tour="channel-dot"
      data-channel={channel ?? 'none'}
      aria-label={title}
      title={title}
      data-tauri-drag-region="false"
      onClick={onCycle}
      onPointerDown={pane === undefined ? undefined : (event) => {
        if (event.button !== 0) return
        // 칸 머리 전체를 끄는 쪽(빈 곳 끌기)이 점에서는 시작하지 않게 막는다
        event.stopPropagation()
        startChannelDrag({ source: pane, dot: event.currentTarget, startX: event.clientX, startY: event.clientY })
      }}
    >
      <span className="pane-channel-dot-mark" aria-hidden="true" />
    </button>
  )
}
