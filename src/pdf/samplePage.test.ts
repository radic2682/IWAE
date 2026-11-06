import { describe, expect, it } from 'vitest'
import {
  SAMPLE_PAGE_COUNT,
  SAMPLE_TITLE,
  samplePageImageUrl,
  samplePageTextIndex,
  samplePdfOutline,
} from './samplePage'

describe('development PDF fixture', () => {
  it('검색·목차·발췌를 시험할 수 있는 새 6페이지 가이드를 제공한다', () => {
    expect(SAMPLE_TITLE).toBe('IWAE — Evidence-Linked Research Guide')
    expect(SAMPLE_PAGE_COUNT).toBe(6)
    expect(samplePdfOutline.map((entry) => entry.title)).toEqual([
      'From Evidence to Insight',
      'A Reading Workflow',
      'Capture Meaningful Evidence',
      'Keep Context Attached',
      'Synthesize on the Canvas',
      'Review Checklist',
    ])
    expect(samplePageTextIndex(1).text).toContain('A useful research note preserves the claim')
    expect(samplePageTextIndex(4).text).toContain('Spatial arrangement turns a list of quotations')
    expect(samplePageImageUrl(5)).toBe('/dev-pdf/page-6.png')
  })
})
