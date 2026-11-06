import { isMarkdownThemeId, type MarkdownThemeId } from './markdownTheme'
import { isFolderColor, type FolderColor } from './folderColors'

export interface VaultMetadata extends Record<string, unknown> {
  version: 1
  markdownTheme: MarkdownThemeId
  fileActivity: Record<string, VaultFileActivity>
  /** 항목 이모지. 파일은 항목 id, 폴더는 folderIconKey(path) 가 키다 */
  itemIcons: Record<string, string>
  /** 폴더 색. 키는 folderIconKey(path) */
  itemColors?: Record<string, FolderColor>
  /** 왼쪽 바 「노트」를 사람이 끌어 정한 차례(노트 경로). 여기 없는 노트는 뒤에 이름순으로 붙는다 */
  noteOrder?: string[]
}

export interface VaultFileActivity {
  favorite: boolean
  lastOpenedAt: string | null
  /** 마지막으로 보던 쪽(1-기반). 다시 열면 여기서 시작한다 */
  lastPage?: number
}

/** 이모지 하나는 결합 문자를 써도 이 길이를 넘지 않는다. 넘으면 이모지가 아니다 */
const MAX_ICON_LENGTH = 16

export function folderIconKey(path: string): string {
  return `folder:${path}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseItemIcons(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const icons: Record<string, string> = {}
  for (const [key, icon] of Object.entries(value)) {
    if (typeof icon !== 'string' || icon === '' || icon.length > MAX_ICON_LENGTH) continue
    icons[key] = icon
  }
  return icons
}

export function parseVaultMetadata(value: unknown): VaultMetadata {
  const source = isRecord(value) ? value : {}
  const fileActivity: Record<string, VaultFileActivity> = {}
  if (isRecord(source.fileActivity)) {
    for (const [id, activity] of Object.entries(source.fileActivity)) {
      if (!isRecord(activity)
        || typeof activity.favorite !== 'boolean'
        || (activity.lastOpenedAt !== null && typeof activity.lastOpenedAt !== 'string')) continue
      fileActivity[id] = {
        favorite: activity.favorite,
        lastOpenedAt: activity.lastOpenedAt,
        ...(Number.isInteger(activity.lastPage) && (activity.lastPage as number) > 0
          ? { lastPage: activity.lastPage as number }
          : {}),
      }
    }
  }
  return {
    ...source,
    version: 1,
    markdownTheme: isMarkdownThemeId(source.markdownTheme) ? source.markdownTheme : 'light',
    fileActivity,
    itemIcons: parseItemIcons(source.itemIcons),
    ...(source.itemColors === undefined ? {} : { itemColors: parseItemColors(source.itemColors) }),
    ...(Array.isArray(source.noteOrder)
      ? { noteOrder: [...new Set(source.noteOrder.filter((path): path is string => typeof path === 'string' && path !== ''))] }
      : {}),
  }
}

function parseItemColors(value: unknown): Record<string, FolderColor> {
  if (!isRecord(value)) return {}
  const colors: Record<string, FolderColor> = {}
  for (const [key, color] of Object.entries(value)) {
    if (isFolderColor(color)) colors[key] = color
  }
  return colors
}

export function setItemColor(metadata: VaultMetadata, key: string, color: FolderColor | null): VaultMetadata {
  const itemColors = { ...(metadata.itemColors ?? {}) }
  if (color === null) delete itemColors[key]
  else itemColors[key] = color
  return { ...metadata, itemColors }
}

export function setMarkdownTheme(metadata: VaultMetadata, markdownTheme: MarkdownThemeId): VaultMetadata {
  return { ...metadata, version: 1, markdownTheme }
}

function fileActivity(
  metadata: VaultMetadata,
  id: string,
  update: Partial<VaultFileActivity>,
): VaultMetadata {
  const current = metadata.fileActivity[id] ?? { favorite: false, lastOpenedAt: null }
  return {
    ...metadata,
    fileActivity: {
      ...metadata.fileActivity,
      [id]: { ...current, ...update },
    },
  }
}

export function setFileFavorite(
  metadata: VaultMetadata,
  id: string,
  favorite: boolean,
): VaultMetadata {
  return fileActivity(metadata, id, { favorite })
}

export function recordFileOpened(
  metadata: VaultMetadata,
  id: string,
  lastOpenedAt: string,
): VaultMetadata {
  return fileActivity(metadata, id, { lastOpenedAt })
}

export function setItemIcon(metadata: VaultMetadata, key: string, emoji: string | null): VaultMetadata {
  const itemIcons = { ...metadata.itemIcons }
  if (emoji === null) delete itemIcons[key]
  else itemIcons[key] = emoji
  return { ...metadata, itemIcons }
}

export function setNoteOrder(metadata: VaultMetadata, order: readonly string[]): VaultMetadata {
  return { ...metadata, noteOrder: [...order] }
}

export function setFileReadingPosition(metadata: VaultMetadata, id: string, page: number): VaultMetadata {
  return fileActivity(metadata, id, { lastPage: page })
}
