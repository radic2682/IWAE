// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { TemplateGlyph } from './TemplateGlyph'

afterEach(cleanup)

describe('TemplateGlyph — 새 화면 메뉴의 배치 그림', () => {
  it('템플릿마다 모양이 다르고, 모두 장식(aria-hidden)이며 글 색을 쓴다', () => {
    const ids = ['read', 'noteLeft', 'compare', 'organize', 'blank']
    const markup = ids.map((id) => {
      const { container, unmount } = render(<TemplateGlyph id={id} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.getAttribute('stroke')).toBe('currentColor')
      const html = svg.innerHTML
      unmount()
      return html
    })
    expect(new Set(markup).size).toBe(ids.length)
  })

  it('빈 화면만 점선 사각형이고, 비교는 2×2(세로 · 가로 나눔선 한 줄)다', () => {
    const dashed = (id: string) => { const view = render(<TemplateGlyph id={id} />); const result = view.container.querySelector('[stroke-dasharray]') !== null; view.unmount(); return result }
    expect(dashed('blank')).toBe(true)
    expect(dashed('read')).toBe(false)
    const view = render(<TemplateGlyph id="compare" />)
    expect(view.container.querySelector('path')?.getAttribute('d')).toContain('M8 2.5v11')
    expect(view.container.querySelector('path')?.getAttribute('d')).toContain('h13')
  })
})
