/**
 * 앱 안 릴리스 노트. `docs/releases/v0.1.X.md` 를 빌드할 때 글자 그대로 묶어 두고(Vite glob),
 * 여기서 파일 이름에서 버전을, 본문에서 날짜를 읽어 새 버전 순으로 늘어놓는다.
 * 노트는 영어 그대로 보인다(릴리스 노트는 번역하지 않는다).
 */

export interface ReleaseNote {
  /** 'v' 없는 버전: 0.1.19 */
  readonly version: string
  /** YYYY-MM-DD. 노트에 날짜가 없으면 null */
  readonly date: string | null
  /** 제목 줄·머리말을 뺀 Markdown 본문 */
  readonly body: string
}

const FILE_VERSION = /(?:^|\/)v?(\d+\.\d+\.\d+)\.md$/iu
const VERSION_PARTS = /^v?(\d+)\.(\d+)\.(\d+)/u
const HEADING = /^#[ \t]+IWAE[ \t]+v?\d+\.\d+\.\d+.*$/imu
const ENGLISH_HEADING = /^#[ \t]+IWAE[ \t]+v?\d+\.\d+\.\d+[ \t]*\(English\)[ \t]*$/imu
const DATE = /\b(20\d{2}-\d{2}-\d{2})\b/u

/** 파일 경로에서 버전을 읽는다. 버전 모양이 아닌 파일이면 null */
export function versionFromFileName(path: string): string | null {
  return FILE_VERSION.exec(path.replaceAll('\\', '/'))?.[1] ?? null
}

/** 점 세 마디 비교. 앞이 더 오래되면 음수, 같으면 0. 읽을 수 없는 버전은 0.0.0 으로 본다 */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string): readonly number[] => {
    const match = VERSION_PARTS.exec(value.trim())
    return match === null ? [0, 0, 0] : [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const left = parts(a)
  const right = parts(b)
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * 노트 원문에서 날짜와 표시할 본문을 뽑는다.
 * - 영어 구역(`# IWAE vX (English)`)이 따로 있으면 그 뒤만 쓴다.
 * - 아니면 `# IWAE vX` 제목 줄까지(앞의 주석·그림 포함)를 떼어 낸다. 대화상자가 자기 제목을 보이기 때문이다.
 * - 날짜는 제목 줄이나 본문 첫 몇 줄의 YYYY-MM-DD.
 */
export function parseReleaseBody(raw: string): { readonly date: string | null; readonly body: string } {
  const text = raw.replace(/^﻿/u, '').replaceAll('\r\n', '\n')
  const headed = ENGLISH_HEADING.exec(text) ?? HEADING.exec(text)
  const headingLine = headed?.[0] ?? ''
  const after = headed === null ? text : text.slice(headed.index + headed[0].length)
  const body = after.replace(/^\s+/u, '').replace(/\s+$/u, '')
  const lead = [headingLine, ...body.split('\n').filter((line) => line.trim() !== '').slice(0, 3)].join('\n')
  return { date: DATE.exec(lead)?.[1] ?? null, body }
}

/** 새 버전이 앞에 오게 정렬한다 */
export function sortReleases(releases: readonly ReleaseNote[]): readonly ReleaseNote[] {
  return [...releases].sort((a, b) => compareVersions(b.version, a.version))
}

/** { 경로: 원문 } 에서 노트 목록을 만든다(새 버전 먼저). 버전 모양이 아닌 파일은 건너뛴다 */
export function buildReleaseNotes(files: Readonly<Record<string, string>>): readonly ReleaseNote[] {
  const notes: ReleaseNote[] = []
  for (const [path, raw] of Object.entries(files)) {
    const version = versionFromFileName(path)
    if (version === null || typeof raw !== 'string') continue
    notes.push({ version, ...parseReleaseBody(raw) })
  }
  return sortReleases(notes)
}

/** 빌드에 묶인 노트(Vite 가 /docs/releases/*.md 를 글자 그대로 넣는다). 새 버전 먼저 */
export const BUNDLED_RELEASE_NOTES: readonly ReleaseNote[] = buildReleaseNotes(
  import.meta.glob('/docs/releases/*.md', { query: '?raw', eager: true, import: 'default' }) as Record<string, string>,
)

export type WhatsNewPlan =
  /** 대화상자 없이 지금 버전만 기록한다(처음 설치·내림·지금 버전의 노트 없음) */
  | { readonly kind: 'store' }
  /** 같은 버전: 보여 줄 것도 기록할 것도 없다 */
  | { readonly kind: 'none' }
  /** 마지막으로 본 버전 뒤부터 지금 버전까지의 노트(새 버전 먼저) */
  | { readonly kind: 'show'; readonly notes: readonly ReleaseNote[] }

/**
 * 시작할 때 무엇을 할지.
 * - 저장된 버전이 없으면(처음 설치) 보이지 않고 기록만 한다.
 * - 저장된 버전이 지금보다 오래됐고 지금 버전의 노트가 있으면, 건너뛴 버전까지 모두 보인다.
 * - 지금 버전의 노트가 없으면 보이지 않고 기록만 한다.
 */
export function planWhatsNew(
  lastSeen: string | null,
  current: string,
  notes: readonly ReleaseNote[],
): WhatsNewPlan {
  if (lastSeen === null || !VERSION_PARTS.test(lastSeen.trim())) return { kind: 'store' }
  if (compareVersions(lastSeen, current) >= 0) return lastSeen === current ? { kind: 'none' } : { kind: 'store' }
  if (!notes.some((note) => compareVersions(note.version, current) === 0)) return { kind: 'store' }
  const fresh = sortReleases(notes.filter((note) => compareVersions(note.version, lastSeen) > 0 && compareVersions(note.version, current) <= 0))
  return { kind: 'show', notes: fresh }
}
