// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createMarkdownCapture, isMarkdownCaptureStale, sanitizeRenderSnapshot } from './markdownCapture'

describe('markdown capture', () => {
  it('실행 가능한 마크업을 제거하고 문서 구조는 보존한다', () => {
    const html = '<table><tr><td onclick="x()">A</td></tr></table><script>x()</script>'
    expect(sanitizeRenderSnapshot(html)).toBe('<table><tbody><tr><td>A</td></tr></tbody></table>')
  })

  it('캡처의 비율과 원문 해시를 보존한다', () => {
    const capture = createMarkdownCapture({
      sourceFileId: 'doc-1', sourceHash: 'hash-a', anchor: { startOffset: 2, endOffset: 3 },
      plainText: 'A', renderedSnapshot: '<strong>A</strong>', width: 400, height: 200,
    })
    expect(capture.aspectRatio).toBe(2)
    expect(isMarkdownCaptureStale(capture, 'hash-b')).toBe(true)
  })

  it('원격 URL과 이벤트 속성을 허용하지 않는다', () => {
    expect(sanitizeRenderSnapshot('<a href="javascript:x" onmouseover="x()">A</a><img src="https://x.test/a.png">'))
      .toBe('<a>A</a><img>')
  })
})
