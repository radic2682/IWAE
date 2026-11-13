import { isDesktop } from '../../bridge/window'
import { THEME_FILE_EXTENSION } from '../../core/themeFile'

/**
 * 테마 파일(JSON)을 저장한다. 데스크톱에서는 저장 위치를 묻고 그 경로를 돌려준다(취소하면 null).
 * 브라우저 미리보기에서는 내려받기로 처리한다.
 */
export async function saveThemeFile(suggestedName: string, text: string): Promise<string | null> {
  if (!isDesktop()) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
    const link = window.document.createElement('a')
    link.href = url
    link.download = suggestedName
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return suggestedName
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: suggestedName, filters: [{ name: 'IWAE 테마', extensions: ['iwtheme', 'json'] }] })
  if (path === null) return null
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(path, text)
  return path
}

/** 파일 이름에 못 쓰는 글자를 빼서 "테마-이름.json" 으로 */
export function themeFileName(name: string): string {
  const clean = name.replace(/[\/:*?"<>|]+/g, '').trim() || '테마'
  return `IWAE-테마-${clean}${THEME_FILE_EXTENSION}`
}

export function templateFileName(): string {
  return `IWAE-테마-템플릿${THEME_FILE_EXTENSION}`
}
