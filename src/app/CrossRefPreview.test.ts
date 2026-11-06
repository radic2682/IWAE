import { describe, expect, it } from 'vitest'
import { referenceAt } from './CrossRefPreview'

describe('referenceAt', () => {
  const text = 'The Retry-After header uses a delay value (Table 53), see Section 5.1.9.3 and Figure 6-3.'
  it('커서가 놓인 참조만 돌려준다', () => {
    expect(referenceAt(text, text.indexOf('Table 53') + 3)?.label).toBe('Table 53')
    expect(referenceAt(text, text.indexOf('5.1.9.3') + 2)).toMatchObject({ label: '§5.1.9.3', target: { kind: 'section', number: '5.1.9.3' } })
    expect(referenceAt(text, text.indexOf('Figure 6-3') + 8)).toMatchObject({ target: { kind: 'caption', label: 'Figure', number: '6-3' } })
  })
  it('참조가 아닌 글자 위에서는 null', () => {
    expect(referenceAt(text, text.indexOf('Retry-After'))).toBeNull()
  })
})
