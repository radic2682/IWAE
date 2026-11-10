import { t } from '../i18n'

/** 폴더 색(웨일 북마크 폴더처럼). 키는 폴더 이모지와 같은 folderIconKey(path) */
export type FolderColor = 'yellow' | 'orange' | 'green' | 'blue' | 'purple' | 'violet' | 'pink'

export const FOLDER_COLORS: readonly { readonly id: FolderColor; readonly label: string; readonly hex: string }[] = [
  { id: 'yellow', label: '노랑', hex: '#febd00' },
  { id: 'orange', label: '주황', hex: '#ff5735' },
  { id: 'green', label: '초록', hex: '#00c421' },
  { id: 'blue', label: '하늘', hex: '#5fb2ff' },
  { id: 'purple', label: '보라', hex: '#8a70ff' },
  { id: 'violet', label: '자주', hex: '#b911ff' },
  { id: 'pink', label: '분홍', hex: '#ff4fd5' },
]

/** 폴더 색 이름(지금 언어로) */
export function folderColorLabel(color: { readonly label: string }): string {
  return t(color.label)
}

export function isFolderColor(value: unknown): value is FolderColor {
  return FOLDER_COLORS.some((color) => color.id === value)
}

export function folderColorHex(color: FolderColor | undefined): string | undefined {
  return FOLDER_COLORS.find((candidate) => candidate.id === color)?.hex
}
