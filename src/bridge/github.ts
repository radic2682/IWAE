/**
 * GitHub 문서 폴더. Rust github.rs 가 PC 의 git 으로 받는다 — 공개 저장소만.
 * git 작업 폴더는 .iwae/github 에 숨기고, 받은 폴더의 파일만 사용자가 고른 Vault 폴더(target)에 넣는다
 */

export interface GithubSource {
  /** 연결 이름(숨긴 작업 폴더 이름) */
  readonly name: string
  /** 이어진 Vault 폴더(Vault 기준 경로) */
  readonly target: string
  readonly url: string
  /** 받은 폴더(저장소 안 경로). null 이면 저장소 전체 */
  readonly path: string | null
  /** 따라가는 브랜치. 태그·커밋을 보는 중이면 null */
  readonly branch: string | null
  /** 태그·커밋을 보는 중이면 그 이름 */
  readonly detached: string | null
  readonly head: string
  readonly headDate: string
  readonly headSubject: string
  /** 마지막 「새 소식 확인」 뒤 원격에 쌓인 커밋 수(받은 폴더에 닿는 것만) */
  readonly behind: number
}

export interface GithubFetchResult {
  readonly source: GithubSource
  /** 바뀌는(바뀐) 파일의 Vault 경로 */
  readonly changed: readonly string[]
}

export interface GithubRef {
  readonly kind: 'branch' | 'tag' | 'commit'
  readonly name: string
  readonly date: string
  readonly subject: string
}

/** 예전 방식에서 쓰던 Vault 안 GitHub 폴더 이름 */
export const GITHUB_FOLDER = 'GitHub'

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export const githubList = (vaultRoot: string) => call<GithubSource[]>('github_list', { vaultRoot })
/** target: 받은 파일을 넣을 Vault 폴더(Vault 기준 경로, 없으면 만든다) */
export const githubClone = (vaultRoot: string, url: string, target: string) => call<GithubSource>('github_clone', { vaultRoot, url, target })
/** 이어진 Vault 폴더를 옮겼을 때 연결을 따라 옮긴다 */
export const githubMoveTarget = (vaultRoot: string, from: string, to: string) => call<void>('github_move_target', { vaultRoot, from, to })
export const githubFetch = (vaultRoot: string, name: string) => call<GithubFetchResult>('github_fetch', { vaultRoot, name })
export const githubPull = (vaultRoot: string, name: string) => call<GithubFetchResult>('github_pull', { vaultRoot, name })
export const githubRefs = (vaultRoot: string, name: string) => call<GithubRef[]>('github_refs', { vaultRoot, name })
export const githubCheckout = (vaultRoot: string, name: string, kind: GithubRef['kind'], reference: string) =>
  call<GithubSource>('github_checkout', { vaultRoot, name, kind, reference })

/** 붙여 넣은 주소를 미리 읽어 보인다(실제 검사는 Rust 가 다시 한다) */
export function previewGithubUrl(url: string): { owner: string; repo: string; reference: string | null; path: string | null } | null {
  const match = /^(?:https?:\/\/)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+?))?)?\/?$/iu.exec(url.trim())
  if (match === null) return null
  return { owner: match[1]!, repo: match[2]!, reference: match[3] ?? null, path: match[4] ?? null }
}
