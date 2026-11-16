/**
 * 읽기 화면의 그림 참조 검사. 문서 안 `<img src>` 는 믿을 수 없는 입력이다.
 * `\\서버\공유\x.png` 같은 경로를 읽으면 Windows 가 네트워크로 나가(NTLM 인증이 새 나간다) 파일 범위 검사보다 먼저 닿는다.
 * 그래서 참조 글자 단계(여기)와 파일을 읽는 단계(MarkdownPane 의 그림 읽기) 두 곳에서 막는다.
 */

/** 앱 자신의 주소(웹뷰 안에서 앱 내부로 가는 길). 문서가 이 주소로 그림·링크를 걸 수 없다 */
const APP_URL = /^(?:(?:https?:)?\/\/(?:[^/?#@]*@)?(?:iwae|tauri|asset|ipc)\.localhost(?=[:/?#]|$)|(?:iwae|tauri|asset|ipc):)/iu

export function isAppUrl(url: string): boolean {
  // 제어문자·공백을 끼워 숨기는 수법을 걷고 본다
  return APP_URL.test(compact(url))
}

/** 공백·제어문자·보이지 않는 글자(주소 검사를 피하려고 끼워 넣는 것) */
const BACKSLASH = String.fromCharCode(92)
const HIDDEN = new RegExp(`[${String.fromCharCode(92)}s${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200f)}${String.fromCharCode(0x2028, 0x2029, 0xfeff)}]`, 'gu')
/** 제어문자 */
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, 'u')

function compact(value: string): string {
  return value.replace(HIDDEN, '')
}

/** %XX 를 두 번까지 푼다(이중 인코딩으로 구분자를 숨기는 수법). 깨진 %XX 는 그대로 둔다 */
function decodeTwice(value: string): string[] {
  const forms = [value]
  let current = value
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(current)
      if (next === current) break
      forms.push(next)
      current = next
    } catch {
      break
    }
  }
  return forms
}

/** 경로 글자 하나가 안전한 상대 참조인가: 역슬래시·드라이브 글자·`//`·`/\` 로 시작하는 경로·제어문자가 없다 */
export function isSafeRelativeReference(reference: string): boolean {
  if (reference === '') return false
  for (const form of decodeTwice(reference)) {
    if (form.includes(BACKSLASH) || CONTROL.test(form)) return false
    if (/^\/{2,}/u.test(form)) return false
    if (/^\/*[a-z]:/iu.test(form)) return false
    // 첫 칸이 `이름:` 꼴이면 scheme 이거나 드라이브·장치 이름이다(상대 경로에는 쓰지 않는다)
    if (/^[^/?#]*:/u.test(form)) return false
  }
  return true
}

/** 문서 안 그림 참조(상대 경로)를 앱이 파일로 읽어도 되는 글자인가 */
export function isSafeLocalImageRef(reference: string): boolean {
  return isSafeRelativeReference(reference.split(/[?#]/u)[0] ?? '') && !isAppUrl(reference)
}

/**
 * 그림 파일의 실제 경로를 정한다. 결과는 `root`(Vault 뿌리, 또는 참조 문서가 든 폴더) 안이어야 한다.
 * `relative` 는 문서 안 참조, `documentPath` 는 문서의 절대 경로, `resolve` 는 resolveRelativePath.
 * UNC·장치 경로(`\\?\`, `\\.\`)·root 밖으로 나가는 경로는 null.
 */
export function resolveImageFile(
  relative: string,
  documentPath: string,
  root: string,
  resolve: (relative: string, currentPath: string) => string | null,
): string | null {
  const reference = relative.split(/[?#]/u)[0] ?? ''
  if (!isSafeLocalImageRef(relative)) return null
  let decoded = reference
  try { decoded = decodeURIComponent(reference) } catch { /* 깨진 %XX 는 그대로 */ }
  if (!isSafeRelativeReference(decoded)) return null
  const resolved = resolve(decoded, documentPath.replaceAll('\\', '/'))
  if (resolved === null || /[\\]/u.test(resolved) || resolved.startsWith('//')) return null
  const base = root.replaceAll('\\', '/').replace(/\/+$/u, '')
  if (/^\/\/|^\/\/[?.]/u.test(base)) return null
  // `/그림.png` 는 뿌리 기준이라 뿌리를 붙인다. 그 밖의 참조는 문서의 절대 경로에서 풀려 절대 경로여야 한다(아니면 맨 위를 넘어 나간 것이다)
  const rooted = decoded.startsWith('/')
  const isAbsolute = /^(?:[a-z]:\/|\/)/iu.test(resolved)
  if (!rooted && !isAbsolute) return null
  const absolute = rooted ? `${base}/${resolved}` : resolved
  const parts = absolute.split('/')
  if (parts.some((part) => part === '..')) return null
  const lowerBase = base.toLowerCase().normalize('NFC')
  const lowerPath = absolute.toLowerCase().normalize('NFC')
  return lowerPath.startsWith(`${lowerBase}/`) ? absolute : null
}
