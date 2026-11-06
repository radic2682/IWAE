import type { MouseEvent } from 'react'
import type { PdfLink } from '../bridge/pdf'
import { externalLinkHost } from '../bridge/external'
import { t } from '../i18n'

interface LinkLayerProps {
  readonly links: readonly PdfLink[]
  /** 페이지 points → 화면 px 배율. 글자 상자와 같은 값이다 */
  readonly renderScale: number
  readonly onInternal: (target: { page: number; y: number | null }) => void
  readonly onExternal: (uri: string) => void
}

/**
 * 페이지 위의 링크 영역. 선택 레이어보다 위에 얹되 링크 사각형만 눌린다.
 *
 * 링크 위에서 시작한 끌기는 글자 선택이 되지 않는다 — 그 자리를 링크가 먼저 받기
 * 때문이다. 링크는 대개 인용 번호·주소처럼 짧아서, 선택을 링크 바깥에서 시작하면 된다.
 * 수정 키를 누른 클릭은 이동하지 않는다(실수로 Shift+클릭 범위 선택을 하려던 경우).
 */
export function LinkLayer({ links, renderScale, onInternal, onExternal }: LinkLayerProps) {
  if (links.length === 0) return null

  const activate = (event: MouseEvent<HTMLAnchorElement>, link: PdfLink) => {
    event.preventDefault()
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    if (link.target.kind === 'page') onInternal({ page: link.target.page, y: link.target.y })
    else onExternal(link.target.uri)
  }

  return (
    <div className="pdf-link-layer">
      {links.map((link, index) => {
        const label = link.target.kind === 'page'
          ? t('{page}쪽으로 이동', { page: link.target.page + 1 })
          : t('외부 링크 {host}', { host: externalLinkHost(link.target.uri) })
        return (
          <a
            key={index}
            href={link.target.kind === 'uri' ? link.target.uri : `#page-${link.target.page + 1}`}
            className={`pdf-link pdf-link-${link.target.kind}`}
            aria-label={label}
            title={link.target.kind === 'uri' ? link.target.uri : label}
            draggable={false}
            style={{
              left: `${link.rect.x * renderScale}px`,
              top: `${link.rect.y * renderScale}px`,
              width: `${link.rect.w * renderScale}px`,
              height: `${link.rect.h * renderScale}px`,
            }}
            onClick={(event) => activate(event, link)}
          />
        )
      })}
    </div>
  )
}
