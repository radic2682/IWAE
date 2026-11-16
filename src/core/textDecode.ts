/** 열 수 있는 문서 파일의 크기 한도(바이트). 이보다 크면 읽지 않는다 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

/** 글자가 든 바이트열을 문자열로 푼다. 어느 부호화든 맨 앞 BOM 은 뗀다 */
export function decodeDocumentBytes(bytes: Uint8Array): string {
  // BOM 이 있으면 그 부호화를 따른다
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return stripBom(new TextDecoder('utf-8').decode(bytes.subarray(3)))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return stripBom(new TextDecoder('utf-16le').decode(bytes.subarray(2)))
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return stripBom(new TextDecoder('utf-16be').decode(bytes.subarray(2)))

  // 엄격한 UTF-8 로 먼저 푼다. 잘못된 바이트가 있을 때만 한글 Windows 파일(CP949)로 다시 읽는다.
  // (글에 정말로 U+FFFD 가 들어 있는 UTF-8 파일을 CP949 로 잘못 읽지 않으려고 fatal 로 가른다)
  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    // 아래로
  }
  const lossy = new TextDecoder('utf-8').decode(bytes)
  try {
    // WHATWG 의 euc-kr 은 CP949(확장 완성형)와 같다
    const korean = new TextDecoder('euc-kr').decode(bytes)
    if (!korean.includes('�')) return stripBom(korean)
  } catch {
    // 이 환경에 euc-kr 이 없으면 UTF-8 결과를 쓴다
  }
  return stripBom(lossy)
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
