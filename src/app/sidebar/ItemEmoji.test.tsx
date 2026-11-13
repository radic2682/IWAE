// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ItemEmoji } from './ItemEmoji'

describe('ItemEmoji', () => {
  it('draws the emoji in the bundled emoji font span', () => {
    const { container } = render(<ItemEmoji emoji="📚" fallback={<i data-testid="icon" />} />)
    const span = container.querySelector('.item-emoji')
    expect(span?.textContent).toBe('📚')
    expect(container.querySelector('[data-testid="icon"]')).toBeNull()
  })

  it('falls back to the original icon without an emoji', () => {
    const { container } = render(<ItemEmoji fallback={<i data-testid="icon" />} />)
    expect(container.querySelector('.item-emoji')).toBeNull()
    expect(container.querySelector('[data-testid="icon"]')).not.toBeNull()
  })
})
