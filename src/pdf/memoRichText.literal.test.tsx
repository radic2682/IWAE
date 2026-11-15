// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach } from 'vitest'
import { hasMemoFormatting, literalHtmlIfNeeded, memoDisplayHtml, plainMemoTextToHtml, readsAsMarkdown, sanitizeMemoHtml } from './memoRichText'
import { MemoEditor, MemoNoteView } from './MemoEditor'
import { flushEditors } from '../app/editorFlush'
import { EXTERNAL_LINK_REQUEST_EVENT } from '../bridge/external'
import { lineBeforeCaret } from './memoEditing'

afterEach(() => cleanup())

describe('글을 쓴 그대로 남기기(N2)', () => {
  it('Markdown 으로 읽으면 달라지는 글만 그대로 보이는 HTML 을 남긴다', () => {
    expect(readsAsMarkdown('2026. 11. 15. 회의록')).toBe(true)
    expect(literalHtmlIfNeeded('2026. 11. 15. 회의록\n참석: 3명')).toBe('2026. 11. 15. 회의록<br>참석: 3명')
    expect(literalHtmlIfNeeded('---')).toBe('---')
    expect(literalHtmlIfNeeded('```')).toBe('```')
    expect(literalHtmlIfNeeded('a < b & c')).toBe('')
    expect(literalHtmlIfNeeded('그냥 글\n다음 줄')).toBe('')
  })

  it('남긴 HTML 은 그대로 그려지고(번호 목록 · 구분선 · 코드 블록이 되지 않는다), 서식으로 세지 않는다', () => {
    const html = literalHtmlIfNeeded('2026. 11. 15. 회의록')
    expect(memoDisplayHtml('2026. 11. 15. 회의록', html)).toBe('2026. 11. 15. 회의록')
    expect(hasMemoFormatting(html)).toBe(false)
  })

  it('번호 목록은 시작 번호를 지킨다', () => {
    expect(plainMemoTextToHtml('3. a\n4. b')).toBe('<ol start="3"><li>a</li><li>b</li></ol>')
    expect(plainMemoTextToHtml('1. a')).toBe('<ol><li>a</li></ol>')
    expect(sanitizeMemoHtml('<ol start="3"><li>a</li></ol>')).toBe('<ol start="3"><li>a</li></ol>')
    expect(sanitizeMemoHtml('<ol start="-2"><li>a</li></ol>')).toBe('<ol><li>a</li></ol>')
  })

  it('CRLF 로 온 Markdown 도 같은 서식이 된다(N13)', () => {
    expect(plainMemoTextToHtml('# 제목\r\n\r\n- a\r\n- b\r\n')).toBe('<h2>제목</h2><ul><li>a</li><li>b</li></ul>')
  })
})

describe('붙여 넣은 서식 거르기(N14)', () => {
  it('아무것도 바꾸지 않는 style 은 지우고, 꾸밈 없는 span 은 벗긴다', () => {
    const pasted = '<span style="background-color: transparent; font-weight: inherit; font-style: inherit;">글</span>'
    expect(sanitizeMemoHtml(pasted)).toBe('글')
    expect(hasMemoFormatting(sanitizeMemoHtml(pasted))).toBe(false)
    expect(sanitizeMemoHtml('<span style="color: red; font-weight: inherit">글</span>')).toBe('<span style="color: red">글</span>')
  })

  it('바깥에 배경색이 있으면 안쪽의 transparent(배경 없음)는 남긴다', () => {
    const html = sanitizeMemoHtml('<span style="background-color: rgb(255, 241, 168)">가<span style="background-color: transparent">나</span></span>')
    expect(html).toContain('transparent')
  })

  it('링크는 http(s) · mailto 만 남기고 rel 을 붙인다. 그림은 버린다', () => {
    expect(sanitizeMemoHtml('<a href="https://a.com/x" onclick="x()">링크</a>')).toBe('<a href="https://a.com/x" rel="noopener noreferrer">링크</a>')
    expect(sanitizeMemoHtml('<a href="mailto:a@b.com">메일</a>')).toBe('<a href="mailto:a@b.com" rel="noopener noreferrer">메일</a>')
    expect(sanitizeMemoHtml('<a href="javascript:alert(1)">나쁜 링크</a>')).toBe('나쁜 링크')
    expect(sanitizeMemoHtml('<a href="file:///C:/x">파일</a>')).toBe('파일')
    expect(sanitizeMemoHtml('앞<img src="data:image/png;base64,AAAA">뒤')).toBe('앞뒤')
    expect(hasMemoFormatting(sanitizeMemoHtml('<a href="https://a.com">링크</a>'))).toBe(true)
  })

  it('저장된 메모의 링크를 누르면 앱의 바깥 링크 확인을 거친다', () => {
    const requested: string[] = []
    const listen = (event: Event) => requested.push((event as CustomEvent<string>).detail)
    window.addEventListener(EXTERNAL_LINK_REQUEST_EVENT, listen)
    const onEdit = vi.fn()
    const { container } = render(<MemoNoteView note="링크" noteHtml={'<a href="https://example.com/a">링크</a>'} onEdit={onEdit} />)
    fireEvent.click(container.querySelector('a')!)
    window.removeEventListener(EXTERNAL_LINK_REQUEST_EVENT, listen)
    expect(requested).toEqual(['https://example.com/a'])
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('칸이 사라질 때 쓴 글 저장(N1)', () => {
  const type = (editor: HTMLElement, text: string) => {
    editor.textContent = text
    // 사람이 쓴 것과 같게 DOM 을 바꾼 뒤 MutationObserver 가 알아채도록 한 틱 기다린다
  }

  it('쓰던 칸이 포커스를 잃지 않고 사라져도 쓴 글을 저장한다', async () => {
    const onSave = vi.fn()
    const { container, unmount } = render(<MemoEditor initialText="hello" onSave={onSave} onCancel={vi.fn()} />)
    type(container.querySelector('.pdf-memo-editor') as HTMLElement, 'hello world')
    await Promise.resolve()
    unmount()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0]).toMatchObject({ text: 'hello world' })
  })

  it('고친 것이 없으면 사라질 때 저장하지 않는다', () => {
    const onSave = vi.fn()
    const { unmount } = render(<MemoEditor initialText="hello" onSave={onSave} onCancel={vi.fn()} />)
    unmount()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('창 닫기 · Vault 바꾸기 전의 flush 가 쓰던 칸의 글을 먼저 내려 보낸다', async () => {
    const onSave = vi.fn()
    const { container, unmount } = render(<MemoEditor initialText="" onSave={onSave} onCancel={vi.fn()} />)
    type(container.querySelector('.pdf-memo-editor') as HTMLElement, '2026. 11. 15. 회의록')
    await flushEditors()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]![0]).toEqual({ text: '2026. 11. 15. 회의록', html: '2026. 11. 15. 회의록' })
    unmount()
    // 이미 내려 보낸 글은 사라질 때 다시 저장하지 않는다
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})

describe('줄 앞까지의 글 찾기(N5)', () => {
  it('줄바꿈이 많아도 커서가 있는 줄만 본다', () => {
    const editor = document.createElement('div')
    editor.innerHTML = `${Array.from({ length: 3000 }, (_, index) => `줄 ${index}<br>`).join('')}# 제목`
    document.body.appendChild(editor)
    const text = editor.lastChild as Text
    const caret = document.createRange()
    caret.setStart(text, text.length)
    caret.collapse(true)
    const started = performance.now()
    const range = lineBeforeCaret(editor, caret)
    expect(performance.now() - started).toBeLessThan(50)
    expect(range.toString()).toBe('# 제목')
    editor.remove()
  })

  it('앞 문단이 <div> 로 나뉜 글에서도 그 줄만 돌려준다', () => {
    const editor = document.createElement('div')
    editor.innerHTML = '<div>첫째<br>둘째</div>셋째 줄'
    const text = editor.lastChild as Text
    const caret = document.createRange()
    caret.setStart(text, 3)
    caret.collapse(true)
    expect(lineBeforeCaret(editor, caret).toString()).toBe('셋째 ')
  })
})
