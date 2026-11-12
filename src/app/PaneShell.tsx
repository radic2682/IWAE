import { FileDashed } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { activeTab, type Tab, type TabsState } from './tabs'

interface PaneShellProps {
  /** 활성 탭 계산에만 쓴다 — 탭 자체는 더 이상 여기서 안 그린다(상단바로 옮겼다). */
  state: TabsState
  /** 탭이 하나도 없을 때 본문 가운데에 보여줄 문구 */
  emptyHint: string
  /** 내용 영역에 보여줄 문구. 아래 renderBody 가 아무것도 못 그릴 때만 보인다 */
  placeholder: string
  /**
   * 활성 탭의 진짜 내용. null 을 돌려주면 자리표시자로 물러난다.
   *
   * PaneShell 이 직접 `kind === 'pdf'` 를 보고 PdfPane 을 그리게 하지
   * 않은 이유: 그러면 이 파일이 pdf/ 를 알게 되고, 노트 패널까지 PDF
   * 모듈을 끌고 들어온다. 무엇을 그릴지는 상태를 가진 App 이 안다.
   *
   * renderBody 가 없거나 null 을 돌려주면 PaneShell 이 활성 콘텐츠를
   * 복구하거나 다시 연결할 수 있도록 현재 상태를 설명하는 fallback을 그린다.
   */
  renderBody?: (tab: Tab) => ReactNode
  /** 탭이 상단바로 옮겨간 자리에 대신 놓는 도구줄. */
  toolbar?: ReactNode
  /** PDF 위 아래에 떠 있는 페이지·배율 조작줄. */
  bottomBar?: ReactNode
  /** 내용 영역(.pane-body) 위에 떠 있는 창(번역기). 도구줄·아래 막대는 가리지 않는다 */
  overlay?: ReactNode
}

/**
 * 도구줄 + 활성 내용 영역 한 벌. 탭바는 TopBar에 있고(창 제목줄이 두 패널의
 * 탭을 함께 얹는다). 여기 남는 것은 그 패널만의 도구줄과 내용 하나뿐이다.
 */
export function PaneShell({ state, emptyHint, placeholder, renderBody, toolbar, bottomBar, overlay }: PaneShellProps) {
  const active = activeTab(state)
  const body = active !== null && renderBody !== undefined ? renderBody(active) : null
  // 탭이 없는 빈 창도 문서 창과 같은 높이의 빈 머리 줄을 둔다 — 왼쪽 바·문서 도구줄·노트 바 머리로 이어지는 가로선이 끊기지 않게
  const emptyHead = toolbar === undefined && active === null
  return (
    <div className={`pane-frame${toolbar === undefined ? '' : ' pane-frame-with-toolbar'}`}>
      {toolbar === undefined ? (emptyHead ? <div className="pane-empty-head" aria-hidden="true" /> : null) : <div className="pane-toolbar">{toolbar}</div>}
      {/* role="tab" 인 실제 탭은 TopBar 에 있다. 여기는 그 탭들의 내용을
          보여줄 뿐이라 tabpanel 만 남긴다. */}
      <div className="pane-body" role="tabpanel">
        {body ?? (
          <div className="pane-placeholder-card">
            <span className="pane-placeholder">
              {active ? `${active.title} — ${placeholder}` : (
                <span className="pane-placeholder-empty">
                  <FileDashed size={26} weight="regular" aria-hidden="true" />
                  <span>{emptyHint}</span>
                </span>
              )}
            </span>
          </div>
        )}
        {overlay}
      </div>
      {bottomBar === undefined ? null : <div className="pane-bottom-bar">{bottomBar}</div>}
    </div>
  )
}
