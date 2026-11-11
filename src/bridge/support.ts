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

/** 이 창의 화면을 PNG 로 찍는다(Windows 데스크톱). 찍은 그림은 Rust 쪽에도 남아 「클립보드에 복사」가 쓴다 */
export async function captureWindowPng(): Promise<Uint8Array> {
  const { invoke } = await import('@tauri-apps/api/core')
  return new Uint8Array(await invoke<ArrayBuffer>('capture_window_png'))
}

/** 마지막 캡처를 클립보드에 그림으로 올린다 */
export async function copyCaptureToClipboard(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('copy_capture_to_clipboard')
}

/** 캡처를 PNG 파일로 저장한다. 저장한 곳(취소하면 null) */
export async function saveCapturePng(suggestedName: string, png: Uint8Array): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: suggestedName, filters: [{ name: 'PNG', extensions: ['png'] }] })
  if (path === null) return null
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  await writeFile(path, png)
  return path
}
