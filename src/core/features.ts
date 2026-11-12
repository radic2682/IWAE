/**
 * 기능 스위치. 끈 기능은 코드는 그대로 두고 화면·연결만 뺀다(다시 켜면 그대로 돌아온다).
 *
 * CANVAS_ENABLED: 캔버스(YOLO 노트). 2026-11-12 다시 켰다 — 작업 공간의 창·색 채널에 들어와
 * 가리키기 신호를 보내고 받으며 이웃한 문서 창과 연결선으로 이어진다(docs/design/workspace-channels.md).
 * 끄면 사이드바의 캔버스 목록·새 캔버스, 캔버스 탭(세션 복원 포함), 「노트로 보내기」, 캔버스→PDF 추적선,
 * MCP 캔버스 도구(src-tauri/src/mcp/canvas_tools.rs 의 ENABLED 도 같이)가 빠진다. 볼트의 .canvas 파일은 지우지 않는다.
 */
export const CANVAS_ENABLED = true

/**
 * SPLIT_PANES_ENABLED: 좌우 2단 패널(서로 다른 PDF 둘을 나란히). 2026-11-03 다시 켰다 — 시작은 1단이고,
 * 상단 1단↔2단 단추·Ctrl+\ 나 탭 메뉴 「오른쪽 패널로 옮기기」로 나눈다. 끄면 늘 한 패널만 쓴다(1단↔2단 단추·Ctrl+\\·Ctrl+2,
 * 탭을 다른 패널로 옮기기·끌기가 빠지고, 오른쪽에 남은 탭은 왼쪽으로 합친다).
 * 문서 검색 화면은 검색 결과|원본 PDF 로 잠깐 나눠 쓴다. PDF 의 「두 쪽」 보기와는 다른 기능이다.
 */
export const SPLIT_PANES_ENABLED = true

/**
 * MARKDOWN_AS_PDF: Markdown 을 PDF 로 바꿔(Edge 인쇄) PDF 리더로 여는 방식. 2026-11-05 꺼 두었다 —
 * Markdown 은 그대로 Markdown 뷰어로 보여야 한다(사용자 결정). 바꾸는 코드는 남겨 둔다.
 */
export const MARKDOWN_AS_PDF = false
