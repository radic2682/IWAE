// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { addTransientSheet, getRuntimeSheetCss, removeRuntimeSheet, restoreInlineStyles, setRuntimeSheet } from './runtimeStyle'

class FakeSheet {
  rules: string[] = []
  get cssRules() { return this.rules.map((cssText) => ({ cssText })) }
  replaceSync(css: string) { this.rules = [css] }
}

describe('runtimeStyle', () => {
  afterEach(() => {
    removeRuntimeSheet('k')
    Reflect.deleteProperty(window, 'CSSStyleSheet')
    Reflect.deleteProperty(document, 'adoptedStyleSheets')
  })

  it('constructable 시트가 없으면 <style id> 한 개로 대신한다', () => {
    setRuntimeSheet('k', 'a{color:red}')
    setRuntimeSheet('k', 'b{color:blue}')
    expect(document.querySelectorAll('style#k')).toHaveLength(1)
    expect(getRuntimeSheetCss('k')).toBe('b{color:blue}')
  })

  it('constructable 시트가 있으면 <style> 을 만들지 않고 시트 한 개를 고쳐 쓴다', () => {
    Object.defineProperty(window, 'CSSStyleSheet', { value: FakeSheet, configurable: true })
    Object.defineProperty(document, 'adoptedStyleSheets', { value: [], writable: true, configurable: true })
    setRuntimeSheet('k', 'a{color:red}')
    setRuntimeSheet('k', 'b{color:blue}')
    expect(document.querySelector('style#k')).toBeNull()
    expect((document as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets).toHaveLength(1)
    expect(getRuntimeSheetCss('k')).toBe('b{color:blue}')
    removeRuntimeSheet('k')
    expect((document as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets).toHaveLength(0)
  })

  it('잠깐 쓰는 시트는 돌려받은 함수로 걷힌다', () => {
    const remove = addTransientSheet('p{margin:0}')
    expect(document.querySelectorAll('style[id^="iwae-transient-"]')).toHaveLength(1)
    remove()
    expect(document.querySelectorAll('style[id^="iwae-transient-"]')).toHaveLength(0)
  })

  it('속성 글을 el.style 로 다시 입힌다', () => {
    const box = document.createElement('div')
    box.innerHTML = '<span style="color: red">a</span>'
    restoreInlineStyles(box)
    expect(box.querySelector('span')!.style.color).toBe('red')
  })
})
