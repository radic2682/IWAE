import { isDesktop } from './window'

/**
 * 탐색기에서 PDF 를 IWAE 로 열었을 때 넘어온 경로. 처음 켜질 때 받은 것은 takeOpenFiles 로 한 번 가져가고,
 * 켜져 있는 동안 다시 연 것은 onOpenFiles 로 받는다(Rust open_files.rs).
 */
export async function takeOpenFiles(): Promise<string[]> {
  if (!isDesktop()) return []
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<string[]>('take_open_files')
}

export async function onOpenFiles(handler: (paths: string[]) => void): Promise<() => void> {
  if (!isDesktop()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<string[]>('iwae:open-files', (event) => handler(event.payload))
}

/** Windows 설정의 「기본 앱」 화면을 연다. 앱이 스스로 기본 앱을 바꿀 수는 없어서 사용자가 고른다 */
export async function openDefaultAppsSettings(): Promise<void> {
  if (!isDesktop()) return
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl('ms-settings:defaultapps')
}
