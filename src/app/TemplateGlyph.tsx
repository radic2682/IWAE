/**
 * 화면 템플릿의 배치 그림(메뉴 아이콘 자리, 16px). 바깥 둥근 사각형이 화면이고 안의 선이 칸 나눔이다.
 * 옅게 채운 칸이 문서 칸이다(읽기 = 왼쪽 문서 · 노트 왼쪽 = 오른쪽 문서 · 비교 = 왼쪽 열 문서 둘). 정리(노트 | 캔버스)는 문서 칸이 없고,
 * 빈 화면은 빈 칸처럼 점선 사각형 하나. 색은 글 색(currentColor)이라 어두운 · 밝은 화면에서 다른 메뉴 아이콘과 같다.
 */
export function TemplateGlyph({ id }: { readonly id: string }) {
  const blank = id !== 'read' && id !== 'noteLeft' && id !== 'compare' && id !== 'organize'
  const fill = { fill: 'currentColor', fillOpacity: 0.3, stroke: 'none' } as const
  return (
    <svg className="template-glyph" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" focusable="false">
      {id === 'read' ? <rect x="2" y="3" width="6" height="10" {...fill} /> : null}
      {id === 'noteLeft' ? <rect x="8" y="3" width="6" height="10" {...fill} /> : null}
      {id === 'compare' ? <rect x="2" y="3" width="6" height="10" {...fill} /> : null}
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" strokeDasharray={blank ? '2.2 2' : undefined} />
      {id === 'compare' ? <path d="M8 2.5v11M1.5 8h13" /> : null}
      {id === 'read' || id === 'noteLeft' || id === 'organize' ? <path d="M8 2.5v11" /> : null}
    </svg>
  )
}
