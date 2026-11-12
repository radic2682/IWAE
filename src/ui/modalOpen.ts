/**
 * 모달 대화상자(`aria-modal="true"`: 키 목록 · 설정 · 확인 · 명령 팔레트 …)가 떠 있는가.
 * 모달이 떠 있는 동안 뒤의 칸을 건드리는 키(한 글자 도구 단축키 · 접두키)는 받지 않는다 —
 * 포커스가 닫기 단추 · 본문에 있어도(글 쓰는 칸이 아니어도) 뒤 칸의 도구가 바뀌거나 칸이 나뉘면 안 된다.
 * 포커스가 어디 있든 보는 것은 포커스 트랩이 포커스를 되돌려 주는 틈에도 새지 않게 하려는 것이다.
 * (번역기 창은 `aria-modal="false"` 라 해당 없다.)
 */
export function modalDialogOpen(root: Document = document): boolean {
  return root.querySelector('[aria-modal="true"]') !== null
}
