import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** 번들한 Twemoji 글꼴(15.0)이 그릴 수 있는 가장 새 이모지 버전 */
const MAX_VERSION = 15
/** 피부색·머리 모양 같은 결합용 조각. 단독 아이콘으로 쓰지 않는다 */
const COMPONENT_GROUP = 2

/** 번들 폰트가 그릴 수 있는 기본 이모지만 남긴다. 피부색 변형은 버린다 */
export function trimEmojiData(entries) {
  return entries
    .filter((entry) => typeof entry.group === 'number'
      && entry.group !== COMPONENT_GROUP
      && typeof entry.version === 'number'
      && entry.version <= MAX_VERSION)
    .sort((a, b) => a.order - b.order)
    .map((entry) => [entry.emoji, entry.label, entry.tags ?? [], entry.group])
}

/**
 * 글꼴이 실제로 한 글자로 그리는 이모지만 남긴다. 버전 필터만으로는
 * 모자란다 — 이 Twemoji 빌드에는 ♂·♀·키캡 같은 BMP 기호가 없어서
 * 🚶‍♂️ 같은 결합 이모지가 "사람 + 빈 칸 + 기호" 세 조각으로 갈라진다.
 * glyph 0 은 .notdef(그릴 수 없음)다.
 */
export function keepDrawable(rows, layout) {
  return rows.filter(([emoji]) => {
    const { glyphs } = layout(emoji)
    return glyphs.length === 1 && glyphs[0].id !== 0
  })
}

async function main() {
  const require = createRequire(import.meta.url)
  const fontkit = require('fontkit')
  const source = JSON.parse(await readFile(require.resolve('emojibase-data/ko/data.json'), 'utf8'))
  const font = fontkit.openSync(require.resolve('twemoji-colr-font/twemoji.woff2'))
  const output = fileURLToPath(new URL('../src/core/emojiData.json', import.meta.url))
  const rows = keepDrawable(trimEmojiData(source), (text) => font.layout(text))
  await writeFile(output, `${JSON.stringify(rows)}\n`, 'utf8')
  console.log(`Emoji data written to ${output}.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
