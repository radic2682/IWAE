// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { installNativeContextMenuSuppressor } from './suppressNativeContextMenu'

function fire(el: Element): boolean {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event.defaultPrevented
}

describe('installNativeContextMenuSuppressor', () => {
  let dispose = () => {}
  afterEach(() => { dispose(); document.body.innerHTML = '' })

  it('blocks the native menu on plain content but keeps it in text fields', () => {
    dispose = installNativeContextMenuSuppressor()
    document.body.innerHTML = '<div id="a"><span id="s">x</span></div><input id="i"><textarea id="t"></textarea><div id="c" contenteditable="true"><b id="b">y</b></div>'
    expect(fire(document.getElementById('s')!)).toBe(true)
    expect(fire(document.getElementById('i')!)).toBe(false)
    expect(fire(document.getElementById('t')!)).toBe(false)
    expect(fire(document.getElementById('b')!)).toBe(false)
  })

  it('leaves app-handled events alone', () => {
    dispose = installNativeContextMenuSuppressor()
    document.body.innerHTML = '<div id="a"></div>'
    const a = document.getElementById('a')!
    a.addEventListener('contextmenu', (e) => e.preventDefault())
    expect(fire(a)).toBe(true)
  })
})
