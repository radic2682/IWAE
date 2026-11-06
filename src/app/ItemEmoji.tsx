import type { ReactNode } from 'react'
import { t } from '../i18n'
import '../ui/item-emoji.css'

/**
 * 이모지가 있으면 번들 Twemoji 글꼴로, 없으면 원래 아이콘을 그린다.
 * onPick 을 주면 아이콘을 눌러 바로 이모지를 고른다(줄을 여는 누르기·끌기·두 번 누르기와 따로 논다).
 * 키보드·화면 읽기 프로그램은 우클릭 메뉴의 「이모지 설정」을 쓴다.
 */
export function ItemEmoji({ emoji, fallback, onPick }: {
  readonly emoji?: string
  readonly fallback: ReactNode
  /** 고르기 창을 띄울 자리(아이콘 왼쪽 아래)를 받는다 */
  readonly onPick?: (x: number, y: number) => void
}) {
  const icon = emoji === undefined ? fallback : <span className="item-emoji" aria-hidden="true">{emoji}</span>
  if (onPick === undefined) return <>{icon}</>
  return (
    <span
      className="item-emoji-pick"
      aria-hidden="true"
      title={t('이모지 고르기')}
      data-emoji-pick=""
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        onPick(rect.left, rect.bottom + 4)
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {icon}
    </span>
  )
}
