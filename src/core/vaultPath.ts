const BACKSLASH = String.fromCharCode(92)

/** 경로 조각들: 역슬래시도 구분자로, 빈 조각(겹친·끝 슬래시)은 버린다 */
function parts(path: string): string[] {
  return path.replaceAll(BACKSLASH, '/').split('/').filter((part) => part !== '')
}

/** 조각 비교용: 유니코드 NFC·소문자(Windows·macOS 파일 이름은 대소문자를 가리지 않는다) */
function same(left: string, right: string): boolean {
  return left.normalize('NFC').toLocaleLowerCase() === right.normalize('NFC').toLocaleLowerCase()
}

/**
 * 절대 경로 `path` 가 Vault 폴더(`root`) 안이면 Vault 기준 상대 경로(슬래시, 받은 글자 그대로)를, 아니면 null.
 * Vault 자신이거나 `.` · `..` 조각이 든 경로는 null 이다(밖으로 새는지 확신할 수 없다)
 */
export function vaultRelativePath(root: string, path: string): string | null {
  const base = parts(root)
  const target = parts(path)
  if (base.length === 0 || target.length <= base.length) return null
  if (!base.every((part, index) => same(part, target[index]!))) return null
  const rest = target.slice(base.length)
  if (rest.some((part) => part === '..' || part === '.')) return null
  return rest.join('/')
}
