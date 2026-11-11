/** 다른 노트의 형광펜 곁 말풍선 둘째 줄에 쓸 메모 글 길이(글자 수) */
export const OTHER_NOTE_TIP_BODY_LIMIT = 80

/** 메모 글을 한 줄로: 공백·줄바꿈을 하나로 줄이고 길면 끝을 …으로. 글이 없으면 빈 문자열 */
export function otherNoteTipBody(note: string | undefined): string {
  const flat = (note ?? '').replace(/\s+/gu, ' ').trim()
  const chars = [...flat]
  return chars.length <= OTHER_NOTE_TIP_BODY_LIMIT ? flat : `${chars.slice(0, OTHER_NOTE_TIP_BODY_LIMIT).join('').trimEnd()}…`
}
