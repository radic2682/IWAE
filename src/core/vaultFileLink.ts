/** 주소의 퍼센트 부호를 푼다. 깨진 부호(`50%`)가 있으면 던지지 않고 받은 그대로 */
export function safeDecodeURI(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/**
 * `file:///C:/Vault/a%20b.pdf#page=3` 를 경로와 조각으로 가른다. 조각은 푸는 것보다 먼저 떼어 낸다
 * (경로의 `#` 는 `%23` 으로 들어 있으므로 푼 뒤에 가르면 폴더 이름의 `#` 에서 잘린다).
 */
export function parseFileLink(url: string): { readonly path: string; readonly fragment: string } {
  const hash = url.indexOf('#')
  const rawPath = hash < 0 ? url : url.slice(0, hash)
  const fragment = hash < 0 ? '' : url.slice(hash + 1)
  const stripped = rawPath.replace(/^file:\/+/iu, '')
  // 드라이브 글자가 없으면 맨 앞 슬래시는 절대 경로의 것이다(file:///Users/me/a.pdf)
  const path = safeDecodeURI(/^[a-z]:/iu.test(stripped) ? stripped : `/${stripped}`)
  return { path, fragment }
}

/** `#page=3` 의 조각에서 쪽(1 부터). 없으면 null */
export function pdfPageFromFragment(fragment: string | null | undefined): number | null {
  const match = /(?:^|&)page=(\d+)(?:&|$)/iu.exec((fragment ?? '').replace(/^#/u, ''))
  if (match === null) return null
  const page = Number(match[1])
  return page >= 1 ? page : null
}
