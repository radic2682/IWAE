/**
 * 문제 보고서 만들기. 어떤 것도 자동으로 보내지 않는다 — 사용자가 미리 보고 GitHub 이슈로 열거나 파일로 저장한다.
 * 가리는 것: 경로(Vault 포함)·파일 이름·키/토큰·메일 주소·주소의 질의 문자열. 문서 글은 애초에 담지 않는다.
 */
import type { RecordedError } from './errorBuffer'

export const ISSUE_REPOSITORY = 'radic2682/IWAE'
/** 주소(질의 문자열 포함) 길이 제한: 이보다 길면 본문을 줄이고 전체는 복사해 붙여 넣게 한다 */
export const ISSUE_URL_LIMIT = 6000

const FILE_EXTENSIONS = 'pdf|md|markdown|txt|png|jpe?g|gif|webp|svg|zip|json|docx?|pptx?|xlsx?|csv|html?|epub|bib|ris'

export interface RedactionOptions {
  readonly vaultRoot?: string | null
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function redactText(input: string, options: RedactionOptions = {}): string {
  let text = input
  // 1) Vault 경로(슬래시 두 가지, 대소문자 무시)를 먼저 자리표시자로
  const root = options.vaultRoot?.trim()
  if (root !== undefined && root !== '') {
    const flat = root.replace(/[\\/]+$/u, '')
    for (const variant of new Set([flat, flat.replaceAll('\\', '/'), flat.replaceAll('/', '\\')])) {
      text = text.replace(new RegExp(escapeRegExp(variant), 'giu'), '<vault>')
    }
  }
  // 2) 주소는 질의·조각을 뗀다(토큰이 들어 있기 쉽다)
  text = text.replace(/(https?:\/\/[^\s?#"'<>)]+)[?#][^\s"'<>)]*/gu, '$1')
  // 3) 키·토큰
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gu, 'Bearer <redacted>')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/gu, '<redacted-key>')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/gu, '<redacted-key>')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/gu, '<redacted-key>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::fx)?/giu, '<redacted-key>')
    .replace(/\b(api[_-]?key|token|secret|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/giu, '$1$2<redacted>')
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/gu, '<redacted>')
  // 4) 메일
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, '<email>')
  // 5) 남은 절대 경로: 드라이브·UNC·홈·흔한 루트
  text = text
    .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>|*?]*/gu, '<path>')
    .replace(/\\\\[^\s"'<>|]+/gu, '<path>')
    .replace(/(?<![\w.:-])\/(?:Users|home|Volumes|mnt|tmp|var|private)\/[^\s"'<>|]*/gu, '<path>')
  // 6) 파일 이름(확장자 있는 낱말). 주소 안의 경로 조각은 남긴다
  text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_/.:-])[^\\s"'<>|/\\\\:*?]+\\.(?:${FILE_EXTENSIONS})\\b`, 'giu'), (match) => {
    const extension = match.slice(match.lastIndexOf('.'))
    return `<file>${extension.toLowerCase()}`
  })
  return text
}

export interface ReportInput {
  readonly description: string
  readonly appVersion: string
  readonly os: string
  readonly includeLogs: boolean
  readonly logLines: readonly string[]
  readonly errors: readonly RecordedError[]
  readonly vaultRoot?: string | null
}

export interface BuiltReport {
  /** 이슈 본문(설명 + 환경 + 첨부 기록) */
  readonly body: string
  /** 기록 없이 설명과 환경만 */
  readonly summary: string
  readonly logText: string
}

const MAX_LOG_LINES = 120
const MAX_LINE = 300

export function redactedLogText(input: ReportInput): string {
  const options = { vaultRoot: input.vaultRoot ?? null }
  const lines = input.logLines.slice(-MAX_LOG_LINES).map((line) => redactText(line, options).slice(0, MAX_LINE))
  const errors = input.errors.slice(-30).map((error) => {
    const head = `${error.at} [${error.kind}] ${redactText(error.message, options)}`.slice(0, MAX_LINE * 2)
    const stack = error.stack === undefined
      ? ''
      : `\n${redactText(error.stack, options).split('\n').slice(0, 8).map((line) => line.slice(0, MAX_LINE)).join('\n')}`
    return head + stack
  })
  return [
    '--- app log (recent) ---',
    lines.length === 0 ? '(empty)' : lines.join('\n'),
    '--- frontend errors ---',
    errors.length === 0 ? '(none)' : errors.join('\n'),
  ].join('\n')
}

export function buildReport(input: ReportInput): BuiltReport {
  const options = { vaultRoot: input.vaultRoot ?? null }
  const description = redactText(input.description.trim(), options)
  const summary = [
    '### Description',
    description === '' ? '(none)' : description,
    '',
    '### Environment',
    `- IWAE: ${input.appVersion}`,
    `- OS: ${input.os}`,
  ].join('\n')
  const logText = input.includeLogs ? redactedLogText(input) : ''
  const body = input.includeLogs ? `${summary}\n\n### Logs\n\`\`\`\n${logText}\n\`\`\`\n` : `${summary}\n`
  return { body, summary, logText }
}

export interface IssueLink {
  readonly url: string
  /** 기록이 주소에 다 들어가지 않아 클립보드로 복사해 붙여 넣어야 하는가 */
  readonly needsPaste: boolean
}

export function buildIssueUrl(report: BuiltReport, input: Pick<ReportInput, 'description' | 'includeLogs'>): IssueLink {
  const firstLine = input.description.trim().split('\n')[0] ?? ''
  const title = firstLine === '' ? 'Problem report' : firstLine.slice(0, 80)
  const make = (body: string) => `https://github.com/${ISSUE_REPOSITORY}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
  const full = make(report.body)
  if (full.length <= ISSUE_URL_LIMIT) return { url: full, needsPaste: false }
  const note = input.includeLogs ? '\n\n(The log was too long for the link: it is on the clipboard. Paste it here.)\n' : ''
  const short = make(`${report.summary}${note}`)
  return { url: short.length <= ISSUE_URL_LIMIT ? short : make(report.summary.slice(0, 1500)), needsPaste: true }
}

export function osLabel(userAgent: string, platform: string): string {
  if (/Windows NT 10/iu.test(userAgent)) return 'Windows 10/11'
  if (/Windows/iu.test(userAgent)) return 'Windows'
  if (/Mac OS X|Macintosh/iu.test(userAgent)) return 'macOS'
  if (/Linux/iu.test(userAgent)) return 'Linux'
  return platform || 'unknown'
}
