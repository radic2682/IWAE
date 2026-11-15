import { rmSync } from 'node:fs'
import { join } from 'node:path'

/** 브라우저 미리보기에서만 쓰는 샘플 이미지 폴더(public 아래). 데스크톱 앱에는 필요 없다 */
export const BROWSER_PREVIEW_ONLY_DIRECTORIES = ['dev-pdf'] as const

/** `tauri build` 가 빌드 명령을 부를 때 넣어 주는 환경 변수가 있으면 데스크톱 빌드다 */
export function isDesktopBuild(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env.TAURI_ENV_PLATFORM ?? '') !== ''
}

/** 데스크톱 빌드면 출력 폴더에서 브라우저 미리보기 전용 폴더를 지운다. 지웠으면 true */
export function pruneBrowserPreviewAssets(outDir: string, env: Readonly<Record<string, string | undefined>>): boolean {
  if (!isDesktopBuild(env)) return false
  for (const name of BROWSER_PREVIEW_ONLY_DIRECTORIES) rmSync(join(outDir, name), { recursive: true, force: true })
  return true
}
