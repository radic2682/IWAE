/** 열 수 있는 문서 파일의 크기 한도(바이트). 이보다 크면 읽지 않는다 */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

/**
 * BOM 이 없는 UTF-16 인가: 앞 4KB 에서 NUL(0) 바이트가 30% 이상이고 거의 한쪽(홀수/짝수) 자리에 몰려 있으면 그렇다.
 * 영어·숫자 글은 한 글자가 `글자 00`(LE) 또는 `00 글자`(BE) 로 저장된다. 한글만 든 글은 NUL 이 거의 없어 이 길로 알아볼 수 없다(BOM 이 없으면 UTF-8 로 본다)
 */
function guessUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const length = Math.min(bytes.length, 4096) & ~1
  if (length < 4) return null
  let evenNul = 0
  let oddNul = 0
  for (let i = 0; i < length; i += 2) {
    if (bytes[i] === 0) evenNul += 1
    if (bytes[i + 1] === 0) oddNul += 1
  }
  const pairs = length / 2
  const nul = evenNul + oddNul
  if (nul / length < 0.3) return null
  // 한쪽 자리에 NUL 의 90% 이상이 몰려야 한다
  if (oddNul >= nul * 0.9 && oddNul / pairs >= 0.3) return 'utf-16le'
  if (evenNul >= nul * 0.9 && evenNul / pairs >= 0.3) return 'utf-16be'
  return null
}

/** 글자가 든 바이트열을 문자열로 푼다. 어느 부호화든 맨 앞 BOM 은 뗀다 */
export function decodeDocumentBytes(bytes: Uint8Array): string {
  // BOM 이 있으면 그 부호화를 따른다
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return stripBom(new TextDecoder('utf-8').decode(bytes.subarray(3)))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return stripBom(new TextDecoder('utf-16le').decode(bytes.subarray(2)))
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return stripBom(new TextDecoder('utf-16be').decode(bytes.subarray(2)))
  const guessed = guessUtf16(bytes)
  if (guessed !== null) return stripBom(new TextDecoder(guessed).decode(bytes))

  // 엄격한 UTF-8 로 먼저 푼다. 잘못된 바이트가 있을 때만 한글 Windows 파일(CP949)로 다시 읽는다.
  // (글에 정말로 U+FFFD 가 들어 있는 UTF-8 파일을 CP949 로 잘못 읽지 않으려고 fatal 로 가른다)
  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    // 아래로
  }
  try {
    // WHATWG 의 euc-kr 은 CP949(확장 완성형)와 같다.
    // 알려진 한계: 서유럽 Latin-1(Windows-1252) 글이 우연히 CP949 로도 깨지지 않고 풀리면 한글로 잘못 읽는다. 구분할 방법이 없어 그대로 둔다
    const korean = new TextDecoder('euc-kr').decode(bytes)
    if (!korean.includes(String.fromCharCode(0xfffd))) return stripBom(korean)
  } catch {
    // 이 환경에 euc-kr 이 없으면 UTF-8 결과를 쓴다
  }
  // 어느 쪽으로도 안 풀리면 UTF-8 로 풀고 깨진 자리는 U+FFFD 로 둔다(여기까지 왔을 때만 만든다)
  return stripBom(new TextDecoder('utf-8').decode(bytes))
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
