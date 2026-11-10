import { isDesktop } from './window'
import { parseZoteroLibrary, type ZoteroLibrary } from '../core/zoteroImport'
import { t } from '../i18n'

/** Zotero 데이터 폴더를 고르게 한다(기본 위치 「내 폴더/Zotero」에서 연다). 취소하면 null */
export async function pickZoteroFolder(): Promise<string | null> {
  if (!isDesktop()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  let defaultPath: string | undefined
  try {
    const { homeDir, join } = await import('@tauri-apps/api/path')
    defaultPath = await join(await homeDir(), 'Zotero')
  } catch {
    defaultPath = undefined
  }
  const selected = await open({
    directory: true,
    multiple: false,
    recursive: true,
    title: t('Zotero 데이터 폴더 고르기'),
    ...(defaultPath === undefined ? {} : { defaultPath }),
  })
  return typeof selected === 'string' ? selected : null
}

/** Zotero 보관함을 읽는다. DB 는 Rust 가 임시 사본으로만 연다(원본은 건드리지 않는다) */
export async function readZoteroLibrary(path: string): Promise<ZoteroLibrary> {
  if (!isDesktop()) throw new Error(t('Zotero 가져오기는 데스크톱(Tauri) 안에서만 됩니다.'))
  const { invoke } = await import('@tauri-apps/api/core')
  return parseZoteroLibrary(await invoke<unknown>('zotero_read', { path }))
}
