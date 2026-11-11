// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { fitMenuInViewport } from './fitMenu'

function menu(left: number, top: number, width: number, height: number): HTMLElement {
  const element = document.createElement('div')
  element.style.position = 'fixed'
  element.style.left = `${left}px`
  element.style.top = `${top}px`
  Object.defineProperty(element, 'offsetWidth', { value: width })
  Object.defineProperty(element, 'offsetHeight', { value: height })
  document.body.appendChild(element)
  return element
}

describe('fitMenuInViewport', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('창 아래로 넘치면 transform 과 상관없이 레이아웃 높이만큼 위로 올린다', () => {
    window.innerHeight = 800
    window.innerWidth = 1200
    const element = menu(200, 700, 200, 450)
    fitMenuInViewport(element)
    expect(element.style.top).toBe(`${800 - 450 - 8}px`)
    expect(element.style.left).toBe('200px')
  })

  it('오른쪽으로 넘치면 왼쪽으로 옮긴다', () => {
    window.innerHeight = 800
    window.innerWidth = 1000
    const element = menu(950, 100, 200, 100)
    fitMenuInViewport(element)
    expect(element.style.left).toBe(`${1000 - 200 - 8}px`)
  })

  it('창보다 길면 높이를 줄이고 안에서 스크롤한다', () => {
    window.innerHeight = 400
    window.innerWidth = 1000
    const element = menu(100, 300, 200, 600)
    fitMenuInViewport(element)
    expect(element.style.maxHeight).toBe('384px')
    expect(element.style.overflowY).toBe('auto')
    expect(element.style.top).toBe('8px')
  })
})
