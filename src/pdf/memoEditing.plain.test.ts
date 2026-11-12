// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { memoPlainText } from './memoEditing'

describe('memoPlainText', () => {
  it('화면 밖이라 innerText 가 비어도 글과 줄을 그대로 돌려준다', () => {
    const element = document.createElement('div')
    element.innerHTML = '<p>첫 줄</p><p>둘째 줄<br>셋째 줄</p><ul><li>하나</li><li>둘</li></ul>'
    Object.defineProperty(element, 'innerText', { value: '', configurable: true })
    expect(memoPlainText(element)).toBe('첫 줄\n둘째 줄\n셋째 줄\n하나\n둘')
  })

  it('정말 빈 칸이면 빈 글이다', () => {
    const element = document.createElement('div')
    element.innerHTML = '<p><br></p>'
    Object.defineProperty(element, 'innerText', { value: '', configurable: true })
    expect(memoPlainText(element)).toBe('')
  })

  it('innerText 가 있으면 그대로 쓴다', () => {
    const element = document.createElement('div')
    Object.defineProperty(element, 'innerText', { value: '보이는 글', configurable: true })
    expect(memoPlainText(element)).toBe('보이는 글')
  })
})
