import { t } from '../i18n'
import type { PaneChannel } from './workspaceChannels'
import '../ui/tab-menu.css'

/** 점의 설명(말풍선·접근성 이름) */
function channelTitle(channel: PaneChannel): string {
  if (channel === 'blue') return t('색 채널: 파랑 — 같은 색 창끼리 연동합니다 (눌러서 바꾸기)')
  if (channel === 'green') return t('색 채널: 초록 — 같은 색 창끼리 연동합니다 (눌러서 바꾸기)')
  if (channel === 'orange') return t('색 채널: 주황 — 같은 색 창끼리 연동합니다 (눌러서 바꾸기)')
  return t('색 채널: 없음 — 어느 창과도 연동하지 않습니다 (눌러서 바꾸기)')
}

/**
 * 창 머리의 색 점. 같은 색의 창끼리만 서로 가리킨다(형광펜 ↔ 노트 카드 …). 누를 때마다 파랑 → 초록 → 주황 → 없음.
 * 탭 줄 맨 앞에 작게 둔다 — 창이 하나뿐이면 App 이 그리지 않는다.
 */
export function ChannelDot({ channel, onCycle }: { readonly channel: PaneChannel; readonly onCycle: () => void }) {
  const title = channelTitle(channel)
  return (
    <button
      type="button"
      className="pane-channel-dot"
      data-channel={channel ?? 'none'}
      aria-label={title}
      title={title}
      data-tauri-drag-region="false"
      onClick={onCycle}
    >
      <span className="pane-channel-dot-mark" aria-hidden="true" />
    </button>
  )
}
