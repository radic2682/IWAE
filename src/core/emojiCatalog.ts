import { t } from '../i18n'

/** [이모지, 한국어 이름, 태그, 분류] — scripts/build-emoji-data.mjs 가 만드는 행 */
export type EmojiRow = readonly [emoji: string, label: string, tags: readonly string[], group: number]

/** emojibase 분류 번호. 2번(결합용 조각)은 데이터에서 빠져 있다 */
export const EMOJI_GROUPS: readonly { id: number; label: string; sample: string }[] = [
  { id: 0, get label() { return t('웃는 얼굴과 감정') }, sample: '😀' },
  { id: 1, get label() { return t('사람과 몸') }, sample: '👋' },
  { id: 3, get label() { return t('동물과 자연') }, sample: '🌿' },
  { id: 4, get label() { return t('음식 및 음료') }, sample: '🍎' },
  { id: 5, get label() { return t('여행 및 장소') }, sample: '🚀' },
  { id: 6, get label() { return t('액티비티') }, sample: '⚽' },
  { id: 7, get label() { return t('사물') }, sample: '📚' },
  { id: 8, get label() { return t('기호') }, sample: '⭐' },
  { id: 9, get label() { return t('깃발') }, sample: '🏁' },
]

const RECENT_KEY = 'iwae:recent-emoji'
const RECENT_LIMIT = 24

/** "웃는얼굴"로도 "웃는 얼굴"을 찾도록 공백을 지우고 비교한다 */
const normalize = (value: string) => value.toLocaleLowerCase('ko-KR').replace(/\s+/gu, '')

export function searchEmoji(rows: readonly EmojiRow[], query: string): EmojiRow[] {
  const needle = normalize(query)
  if (needle === '') return []
  return rows.filter(([, label, tags]) =>
    normalize(label).includes(needle) || tags.some((tag) => normalize(tag).includes(needle)))
}

export function rowsInGroup(rows: readonly EmojiRow[], group: number): EmojiRow[] {
  return rows.filter((row) => row[3] === group)
}

export function readRecentEmoji(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT)
      : []
  } catch {
    return []
  }
}

export function rememberRecentEmoji(emoji: string): string[] {
  const next = [emoji, ...readRecentEmoji().filter((item) => item !== emoji)].slice(0, RECENT_LIMIT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // 저장이 막힌 환경에서도 이번 선택은 돌려준다.
  }
  return next
}

/** 약 170KB 라 시작 번들에 넣지 않고 선택창을 열 때 불러온다 */
export async function loadEmojiRows(): Promise<readonly EmojiRow[]> {
  const module = await import('./emojiData.json')
  return module.default as unknown as readonly EmojiRow[]
}
