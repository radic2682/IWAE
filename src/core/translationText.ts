const LATIN = /\p{Script=Latin}/u
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

/**
 * 고른 글을 번역하기 전에 다듬는다. PDF 는 줄이 바뀐 자리마다 줄바꿈이 들어 있어, 그대로 보내면 한 문장이 둘로 번역된다.
 * - 빈 줄(문단 나눔)은 남기고, 문단 안의 줄바꿈은 띄어쓰기 하나로 잇는다
 * - 영문 단어가 줄 끝에서 하이픈으로 끊긴 것(word-\nword)은 붙인다
 * - 줄바꿈 앞뒤가 모두 한자·가나면 띄어쓰기 없이 잇는다
 * - 남는 빈칸은 하나로 모은다
 */
export function normalizeSelectionText(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .split(/\n[ \t]*\n(?:[ \t]*\n)*/u)
    .map(joinWrappedLines)
    .filter((paragraph) => paragraph !== '')
    .join('\n\n')
}

function joinWrappedLines(paragraph: string): string {
  const lines = paragraph.split('\n').map((line) => line.replace(/[ \t ]+/gu, ' ').trim()).filter((line) => line !== '')
  let result = ''
  for (const line of lines) {
    if (result === '') { result = line; continue }
    const last = [...result].at(-1) ?? ''
    const first = [...line][0] ?? ''
    if (last === '-' && LATIN.test([...result].at(-2) ?? '') && LATIN.test(first)) result = result.slice(0, -1) + line
    else if (NO_SPACE_SCRIPT.test(last) && NO_SPACE_SCRIPT.test(first)) result += line
    else result += ` ${line}`
  }
  return result
}

/** 글자로 어림한 언어(없으면 null) */
export function guessLanguage(text: string): string | null {
  let hangul = 0
  let kana = 0
  let han = 0
  let latin = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if ((code >= 0xac00 && code <= 0xd7a3) || (code >= 0x1100 && code <= 0x11ff) || (code >= 0x3130 && code <= 0x318f)) hangul += 1
    else if (code >= 0x3040 && code <= 0x30ff) kana += 1
    else if (code >= 0x4e00 && code <= 0x9fff) han += 1
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0xc0 && code <= 0x24f)) latin += 1
  }
  const total = hangul + kana + han + latin
  if (total === 0) return null
  if (kana > 0 && kana >= total * 0.1) return 'ja'
  if (hangul >= total * 0.3) return 'ko'
  if (han >= total * 0.3) return 'zh'
  if (latin >= total * 0.6) return 'en'
  return null
}

/** 원문이 이미 목표 언어면 쓸 다른 언어(한국어 → English, 그 밖 → 한국어). 저장된 설정은 바꾸지 않는다. 그대로면 null */
export function sameLanguageFallback(text: string, target: string): string | null {
  return guessLanguage(text) === target ? (target === 'ko' ? 'en' : 'ko') : null
}
