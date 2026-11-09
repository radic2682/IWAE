import { describe, expect, it } from 'vitest'
import { diffLines, pageLines } from './pdfTextDiff'

describe('pdfTextDiff', () => {
  it('같은 글은 바뀐 곳이 없고, 띄어쓰기 차이는 같은 줄로 본다', () => {
    const a = pageLines(['Alpha  line\nBeta line'])
    const b = pageLines(['Alpha line\nBeta   line'])
    expect(diffLines(a, b).hunks).toEqual([])
  })

  it('바뀐 줄·더한 줄·지운 줄을 쪽 번호와 함께 덩어리로 묶는다', () => {
    const before = pageLines(['Intro\nThe voltage is 3.3 V\nKeep this', 'Old appendix\nEnd'])
    const after = pageLines(['Intro\nThe voltage is 1.8 V\nKeep this\nNew note', 'End'])
    const { hunks, truncated } = diffLines(before, after)
    expect(truncated).toBe(false)
    expect(hunks).toEqual([
      { kind: 'changed', before: [{ page: 0, text: 'The voltage is 3.3 V' }], after: [{ page: 0, text: 'The voltage is 1.8 V' }] },
      { kind: 'changed', before: [{ page: 1, text: 'Old appendix' }], after: [{ page: 0, text: 'New note' }] },
    ])
  })

  it('끝에 더한 줄만 있으면 「더함」 하나', () => {
    const { hunks } = diffLines(pageLines(['A\nB']), pageLines(['A\nB\nC']))
    expect(hunks).toEqual([{ kind: 'added', before: [], after: [{ page: 0, text: 'C' }] }])
  })

  it('큰 문서도 앞뒤가 같으면 빨리 끝난다', () => {
    const same = Array.from({ length: 20000 }, (_, index) => `line ${index}`).join('\n')
    const changed = same.replace('line 10000', 'line ten thousand')
    const { hunks } = diffLines(pageLines([same]), pageLines([changed]))
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.kind).toBe('changed')
  })
})
