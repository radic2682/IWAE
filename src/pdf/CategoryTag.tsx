import { FOLDER_COLORS } from '../core/folderColors'

/** 카테고리 이름마다 늘 같은 색(폴더 색과 같은 7가지 중 하나) */
export function categoryColor(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return FOLDER_COLORS[hash % FOLDER_COLORS.length]!.hex
}

/** 메모 카테고리 표시: 「#」 대신 색 점 + 이름 */
export function CategoryTag({ name }: { readonly name: string }) {
  return (
    <span className="memo-tag">
      <span className="memo-tag-dot" style={{ background: categoryColor(name) }} aria-hidden="true" />
      <span className="memo-tag-name">{name}</span>
    </span>
  )
}
