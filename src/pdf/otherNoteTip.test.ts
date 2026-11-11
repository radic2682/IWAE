import { describe, expect, it } from 'vitest'
import { OTHER_NOTE_TIP_BODY_LIMIT, otherNoteTipBody } from './otherNoteTip'

describe('otherNoteTipBody', () => {
  it('공백·줄바꿈을 하나로 줄인다', () => {
    expect(otherNoteTipBody('  첫째 줄\n\n둘째\t줄   ')).toBe('첫째 줄 둘째 줄')
  })
  it('글이 없으면 빈 문자열', () => {
    expect(otherNoteTipBody(undefined)).toBe('')
    expect(otherNoteTipBody(' \n ')).toBe('')
  })
  it('길면 80자에서 …으로 자른다(짧으면 그대로)', () => {
    const exact = '가'.repeat(OTHER_NOTE_TIP_BODY_LIMIT)
    expect(otherNoteTipBody(exact)).toBe(exact)
    expect(otherNoteTipBody(`${exact}나`)).toBe(`${exact}…`)
  })
})
