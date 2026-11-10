import { describe, expect, it } from 'vitest'
import { EN } from './en'
import { COMMON } from './en/common'
import { GROUP_1 } from './en/group1'
import { GROUP_2 } from './en/group2'
import { GROUP_3 } from './en/group3'
import { GROUP_4 } from './en/group4'
import { GROUP_5 } from './en/group5'
import { GROUP_6 } from './en/group6'
import { GROUP_7 } from './en/group7'
import { INTEROP } from './en/interop'
import { SHORTCUTS } from './en/shortcuts'
import { SUPPORT } from './en/support'
import { THEME_FILES } from './en/themeFiles'

/**
 * 영어 사전은 파일을 합칠 때 같은 열쇠가 뒤의 것으로 덮인다. 두 파일이 같은 한국어에 다른 영어를 적어 두면
 * 어느 쪽이 보일지가 파일 순서에 달려 있어 화면마다 용어가 어긋난다(「노트」가 Note 와 Notes 로 갈리는 식).
 * 같은 열쇠를 여러 파일에 두는 것은 괜찮지만, 영어는 하나여야 한다.
 * 정말 맥락마다 달라야 하면 한국어 열쇠를 다르게 쓴다(예: '노트 한 장').
 */
const FILES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  shortcuts: SHORTCUTS, group1: GROUP_1, group2: GROUP_2, group3: GROUP_3, group4: GROUP_4, group5: GROUP_5,
  group6: GROUP_6, group7: GROUP_7, interop: INTEROP, themeFiles: THEME_FILES, support: SUPPORT, common: COMMON,
}

describe('영어 사전 중복 열쇠', () => {
  it('같은 열쇠는 어느 파일에서나 같은 영어다', () => {
    const seen = new Map<string, Map<string, string[]>>()
    for (const [file, entries] of Object.entries(FILES)) {
      for (const [key, english] of Object.entries(entries)) {
        const byEnglish = seen.get(key) ?? new Map<string, string[]>()
        byEnglish.set(english, [...(byEnglish.get(english) ?? []), file])
        seen.set(key, byEnglish)
      }
    }
    const conflicts = [...seen]
      .filter(([, byEnglish]) => byEnglish.size > 1)
      .map(([key, byEnglish]) => `  ${key}: ${[...byEnglish].map(([english, files]) => `"${english}" (${files.join(', ')})`).join(' ≠ ')}`)
    expect(conflicts.length, `같은 열쇠에 다른 영어가 있다 ${conflicts.length}개:\n${conflicts.join('\n')}`).toBe(0)
  })
})

describe('영어 사전 용어', () => {
  it('왼쪽 바 머리말 「노트」는 Notes 다', () => {
    expect(EN['노트']).toBe('Notes')
    expect(EN['내 테마']).toBe('My theme')
  })
})
