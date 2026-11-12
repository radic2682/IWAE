// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { hasMemoFormatting, inlineMarkdownToHtml, memoDisplayHtml, plainMemoTextToHtml, sanitizeMemoHtml, togglePlainCheck } from './memoRichText'
import { looksLikeMarkdown } from './memoEditing'
import { MemoNoteView } from './MemoEditor'

describe('글만 있는 메모를 Markdown 처럼 그리기', () => {
  it('표시가 없는 글은 예전 그대로(줄바꿈은 <br>)', () => {
    expect(plainMemoTextToHtml('a < b\n다음 줄')).toBe('a &lt; b<br>다음 줄')
    expect(plainMemoTextToHtml('3 * 4 * 5 = 60')).toBe('3 * 4 * 5 = 60')
  })

  it('한 줄 안: `코드`, **굵게**, ~~취소선~~, *기울임*. 코드 안의 표시는 그대로', () => {
    expect(inlineMarkdownToHtml('`a**b**` 와 **굵게** ~~옛~~ *기울*')).toBe('<code>a**b**</code> 와 <b>굵게</b> <s>옛</s> <i>기울</i>')
    expect(inlineMarkdownToHtml('`<tag>`')).toBe('<code>&lt;tag&gt;</code>')
  })

  it('``` 코드 블록, 제목, 목록, 할 일, 인용, 구분선', () => {
    const html = plainMemoTextToHtml([
      '# 큰 제목', '앞 글', '```c', 'int a = 1;', '  return a;', '```', '- 하나', '- 둘', '1. 첫째', '- [x] 끝냄', '- [ ] 할 것', '> 인용', '---', '끝',
    ].join('\n'))
    expect(html).toBe('<h2>큰 제목</h2>앞 글<pre>int a = 1;<br>  return a;</pre><ul><li>하나</li><li>둘</li></ul><ol><li>첫째</li></ol>'
      + '<ul data-type="check"><li data-checked="true">끝냄</li><li data-checked="false">할 것</li></ul><blockquote>인용</blockquote><hr>끝')
  })

  it('닫지 않은 ``` 는 끝까지 코드', () => {
    expect(plainMemoTextToHtml('```\nx\ny')).toBe('<pre>x<br>y</pre>')
  })

  it('서식이 저장돼 있으면 그것을 쓴다', () => {
    expect(memoDisplayHtml('`x`', '<b>x</b>')).toBe('<b>x</b>')
    expect(memoDisplayHtml('`x`', undefined)).toBe('<code>x</code>')
  })
})

describe('서식 거르기', () => {
  it('새 서식(코드 블록·인용·제목·구분선·할 일)은 남기고, 다른 제목은 세 단계로 맞춘다', () => {
    const html = sanitizeMemoHtml('<h1>큰</h1><h6>작은</h6><pre>x<br>y</pre><blockquote>q</blockquote><hr><ul data-type="check" onclick="x"><li data-checked="true" data-x="1">a</li><li data-checked="evil">b</li></ul><del>d</del>')
    expect(html).toBe('<h2>큰</h2><h4>작은</h4><pre>x<br>y</pre><blockquote>q</blockquote><hr><ul data-type="check"><li data-checked="true">a</li><li>b</li></ul><s>d</s>')
    expect(hasMemoFormatting('<pre>x</pre>')).toBe(true)
    expect(hasMemoFormatting('<hr>')).toBe(true)
  })

  it('커서 자리용 폭 없는 글자는 저장하지 않는다', () => {
    expect(sanitizeMemoHtml('<code>a</code>​ 다음')).toBe('<code>a</code> 다음')
  })
})

describe('할 일 체크', () => {
  it('글만 있는 메모는 n 번째 - [ ] 를 뒤집는다', () => {
    expect(togglePlainCheck('- [ ] a\n글\n- [x] b', 1)).toBe('- [ ] a\n글\n- [ ] b')
    expect(togglePlainCheck('- [ ] a', 0)).toBe('- [x] a')
    expect(togglePlainCheck('그냥 글', 0)).toBeNull()
  })

  it('보기 화면에서 네모를 누르면 고치기로 들어가지 않고 체크만 바꿔 저장한다', () => {
    const onEdit = vi.fn()
    const onChange = vi.fn()
    const { container, rerender } = render(<MemoNoteView note={'- [ ] a\n- [ ] b'} noteHtml={undefined} onEdit={onEdit} onChange={onChange} />)
    fireEvent.click(container.querySelectorAll('li')[1]!, { clientX: 4 })
    expect(onEdit).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith({ text: '- [ ] a\n- [x] b', html: '' })

    rerender(<MemoNoteView note="a" noteHtml={'<ul data-type="check"><li data-checked="false">a</li></ul>'} onEdit={onEdit} onChange={onChange} />)
    fireEvent.click(container.querySelector('li')!, { clientX: 4 })
    expect(onChange).toHaveBeenLastCalledWith({ text: 'a', html: '<ul data-type="check"><li data-checked="true">a</li></ul>' })
    // 글 쪽(네모 밖)을 누르면 고치기
    fireEvent.click(container.querySelector('li')!, { clientX: 200 })
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})

describe('붙여 넣기', () => {
  it('Markdown 표시가 있는 글을 알아본다', () => {
    expect(looksLikeMarkdown('```\nx\n```')).toBe(true)
    expect(looksLikeMarkdown('- a\n- b')).toBe(true)
    expect(looksLikeMarkdown('`x` 는')).toBe(true)
    expect(looksLikeMarkdown('그냥 두 줄\n글')).toBe(false)
  })
})
