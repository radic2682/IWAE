/** 문제 보고에 쓰는 이음매: 앱 기록 읽기, 파일로 저장, 클립보드. 어느 것도 네트워크로 보내지 않는다. */

import { isDesktop } from './window'

export async function readAppLogTail(maxLines = 200): Promise<readonly string[]> {
  if (!isDesktop()) return []
  const { invoke } = await import('@tauri-apps/api/core')
  const text = await invoke<string>('support_log_tail', { maxLines })
  return text === '' ? [] : text.split('\n')
}

/** 저장한 곳(취소하면 null) */
export async function saveReportFile(suggestedName: string, text: string): Promise<string | null> {
  if (!isDesktop()) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = suggestedName
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return suggestedName
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: suggestedName, filters: [{ name: 'Text', extensions: ['txt'] }] })
  if (path === null) return null
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  await writeTextFile(path, text)
  return path
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
