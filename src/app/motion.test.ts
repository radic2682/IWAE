import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { springSoft, EASE_SPRING_SOFT, EASE_SPRING_FIRM } from './motion'

describe('springSoft', () => {
  it('starts at 0 and lands exactly on 1', () => {
    expect(springSoft(0)).toBe(0)
    expect(springSoft(1)).toBe(1)
    expect(springSoft(2)).toBe(1)
  })
  it('overshoots about 5% and settles back', () => {
    let peak = 0
    for (let i = 0; i <= 200; i++) peak = Math.max(peak, springSoft(i / 200))
    expect(peak).toBeGreaterThan(1.04)
    expect(peak).toBeLessThan(1.06)
    expect(Math.abs(springSoft(0.99) - 1)).toBeLessThan(0.005)
  })
})

describe('motion tokens', () => {
  const css = readFileSync('src/ui/motion.css', 'utf8')
  it('keeps the JS spring curves identical to the CSS tokens', () => {
    const cssSoft = /--ease-spring-soft: (linear\([^)]*\));/u.exec(css)?.[1]
    const cssFirm = /--ease-spring-firm: (linear\([^)]*\));/u.exec(css)?.[1]
    expect(cssSoft).toBe(EASE_SPRING_SOFT)
    expect(cssFirm).toBe(EASE_SPRING_FIRM)
  })
  it('defines the three durations and honours reduced motion', () => {
    expect(css).toMatch(/--motion-fast: 120ms/u)
    expect(css).toMatch(/--motion-base: 180ms/u)
    expect(css).toMatch(/--motion-slow: 260ms/u)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important/u)
  })
  it('is loaded last by theme.css so it overrides the older per-file transitions', () => {
    const imports = [...readFileSync('src/ui/theme.css', 'utf8').matchAll(/@import '\.\/([^']+)'/gu)].map((m) => m[1])
    expect(imports.at(-1)).toBe('motion.css')
  })
})
