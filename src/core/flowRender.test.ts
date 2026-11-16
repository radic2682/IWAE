// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flowHeadings, flowPlainText, flowSectionPreviews, renderFlowDocument } from './flowRender'
import { renderMarkdown } from './markdown'

/** 결과 HTML 을 다시 읽어 실행될 수 있는 것이 남았는지 본다 */
function expectInert(html: string): void {
  const template = document.createElement('template')
  template.innerHTML = html
  const dangerous = template.content.querySelectorAll('script, iframe, frame, object, embed, style, link, meta, base, form, input, button, svg, template, noscript')
  expect(dangerous.length).toBe(0)
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      expect(attribute.name.startsWith('on')).toBe(false)
      expect(attribute.name).not.toBe('style')
      if (['href', 'src'].includes(attribute.name)) expect(attribute.value).not.toMatch(/^\s*(?:javascript|vbscript):/iu)
    }
  }
}

describe('renderFlowDocument: markdown', () => {
  it('예전 renderMarkdown 과 바이트까지 같다', () => {
    const source = '# 제목\n\n본문 **굵게** [링크](https://example.com)\n\n![그림](a/b.png)\n\n| A |\n|---|\n| 1 |\n'
    const result = renderFlowDocument('markdown', source)
    expect(result.html).toBe(renderMarkdown(source))
    expect(result.headings).toEqual([{ depth: 1, title: '제목' }])
    expect(result.notice).toBeUndefined()
  })
})

describe('renderFlowDocument: text', () => {
  it('모든 글자를 이스케이프하고 태그·링크를 해석하지 않는다', () => {
    const { html } = renderFlowDocument('text', '<b>굵게</b> & https://example.com [x](y) # 제목 "따옴표"')
    expect(html).toBe('<p class="flow-text">&lt;b&gt;굵게&lt;/b&gt; &amp; https://example.com [x](y) # 제목 &quot;따옴표&quot;</p>')
    expect(html).not.toContain('<a')
  })

  it('빈 줄로 문단을 나누고 문단 안 줄바꿈·빈칸·탭은 그대로 둔다', () => {
    const { html, headings } = renderFlowDocument('text', 'a  b\n\tc\n\n\n   \nd')
    const template = document.createElement('template')
    template.innerHTML = html
    const paragraphs = [...template.content.querySelectorAll('p.flow-text')].map((p) => p.textContent)
    expect(paragraphs).toEqual(['a  b\n\tc', 'd'])
    expect(headings).toEqual([])
  })

  it('CRLF·CR 줄바꿈도 같게 다루고 문단 사이에 줄바꿈 글자를 둔다', () => {
    const { html } = renderFlowDocument('text', '가\r\n\r\n나\r다')
    const template = document.createElement('template')
    template.innerHTML = html
    expect(template.content.textContent).toBe('가\n나\n다')
  })

  it('빈 글은 빈 본문', () => {
    expect(renderFlowDocument('text', '').html).toBe('')
    expect(renderFlowDocument('text', '\n\n  \n').html).toBe('')
  })

  it('아주 긴 줄도 한 문단으로 둔다', () => {
    const { html } = renderFlowDocument('text', 'x'.repeat(200_000))
    expect(html.length).toBeGreaterThan(200_000)
    expect(html.match(/<p /gu)).toHaveLength(1)
  })
})

describe('renderFlowDocument: html', () => {
  it('제목·문단·목록·표·코드·인용·그림·링크를 읽기용으로 남긴다', () => {
    const { html, headings } = renderFlowDocument('html', `<!doctype html><html><head><title>페이지</title></head><body>
      <h1>큰 제목</h1><h2>중간</h2><h4>작은</h4>
      <p>문단 <a href="https://example.com/x">바깥 링크</a> <a href="other.html#a">다른 문서</a></p>
      <ul><li>하나</li></ul><ol><li>둘</li></ol>
      <table><tr><th>A</th><td>1</td></tr></table>
      <pre><code>a  b</code></pre><blockquote>인용</blockquote>
      <figure><img src="images/a.png" alt="그림"><figcaption>설명</figcaption></figure>
      <dl><dt>용어</dt><dd>뜻</dd></dl><details><summary>더보기</summary>숨은 글</details>
    </body></html>`)
    for (const tag of ['<h1', '<h2', '<ul>', '<ol>', '<table>', '<pre>', '<code>', '<blockquote>', '<figure>', '<figcaption>', '<dl>', '<dt>', '<dd>', '<details', '<summary>']) {
      expect(html).toContain(tag)
    }
    expect(html).toContain('<div class="markdown-table-wrap"><table>')
    expect(html).toContain('href="https://example.com/x"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).toContain('data-md-src="images/a.png"')
    expect(html).not.toMatch(/\ssrc="images\/a\.png"/u)
    expect(headings).toEqual([
      { depth: 1, title: '큰 제목' },
      { depth: 2, title: '중간' },
      { depth: 4, title: '작은' },
    ])
  })

  it('h1 이 없으면 <title> 을 제목으로 올린다', () => {
    const { html, headings } = renderFlowDocument('html', '<html><head><title> 저장한   글 </title></head><body><p>본문</p></body></html>')
    expect(html.startsWith('<h1>저장한 글</h1>')).toBe(true)
    expect(headings).toEqual([{ depth: 1, title: '저장한 글' }])
  })

  it('h1 이 있으면 <title> 을 더하지 않는다', () => {
    const { html } = renderFlowDocument('html', '<title>이름</title><h1>본문 제목</h1>')
    expect(html).not.toContain('이름')
  })

  it('조각(body 없는 HTML)도 읽는다', () => {
    expect(renderFlowDocument('html', '<p>조각</p>').html).toBe('<p>조각</p>')
  })

  it('class·style·data-* 와 hidden 요소를 지운다', () => {
    const { html } = renderFlowDocument('html', '<p class="markdown-pane pdf-page" style="position:fixed" data-markdown-highlight-id="x" data-md-src="evil">본문</p><p hidden>숨김</p>')
    expect(html).toBe('<p>본문</p>')
  })

  it('id 와 #링크·이름표에 앞머리를 붙여 앱 화면 id 와 겹치지 않게 한다', () => {
    const { html } = renderFlowDocument('html', '<h2 id="root">절</h2><a href="#root">위로</a><a name="old">옛 이름표</a><a href="#old">가기</a>')
    expect(html).toContain('id="flow-root"')
    expect(html).toContain('href="#flow-root"')
    expect(html).toContain('id="flow-old"')
    expect(html).toContain('href="#flow-old"')
    expect(html).not.toMatch(/\sid="root"/u)
  })

  it('빈 제목은 목차에 올리지 않는다', () => {
    const { headings } = renderFlowDocument('html', '<h2></h2><h2>  </h2><h3>있음</h3>')
    expect(headings).toEqual([{ depth: 3, title: '있음' }])
  })

  it('점 찍는 그림의 data: 주소만 남기고 SVG data: 는 지운다', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    const { html } = renderFlowDocument('html', `<img src="${png}"><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="data:text/html;base64,PHNjcmlwdD4=">`)
    expect(html).toContain(`src="${png}"`)
    expect(html).not.toContain('svg+xml')
    expect(html).not.toContain('text/html')
  })

  it('바깥 그림은 그대로 두어 CSP 가 막게 한다(앱은 바깥 주소를 직접 읽지 않는다)', () => {
    const { html } = renderFlowDocument('html', '<img src="https://tracker.example/p.png">')
    expect(html).toContain('src="https://tracker.example/p.png"')
    expect(html).not.toContain('data-md-src')
  })

  describe('악의적인 입력', () => {
    const hostile: readonly [string, string][] = [
      ['script', '<p>앞</p><script>alert(1)</script><p>뒤</p>'],
      ['img onerror', '<img src=x onerror="alert(1)"><img src="a.png" onload="alert(2)">'],
      ['javascript: 링크', '<a href="javascript:alert(1)">눌러</a><a href=" JaVa\tScRiPt:alert(1)">눌러</a><a href="&#106;avascript:alert(1)">눌러</a>'],
      ['svg onload', '<svg onload="alert(1)"><script>alert(2)</script><circle r="5"/></svg><svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'],
      ['iframe', '<iframe src="https://evil.example"></iframe><iframe srcdoc="<script>alert(1)</script>"></iframe>'],
      ['style', '<style>body{display:none}</style><p style="background:url(https://evil.example/x)">글</p>'],
      ['base href', '<base href="https://evil.example/"><a href="x.html">링크</a>'],
      ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example"><p>글</p>'],
      ['중첩 template', '<template><template><script>alert(1)</script><img src=x onerror=alert(2)></template></template><p>글</p>'],
      ['엔티티 속임', '<a href="jav&#x61;script&colon;alert(1)">x</a><a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)">y</a>'],
      ['form·input', '<form action="https://evil.example"><input name="pw"><button>보내기</button><select><option>a</option></select><textarea>x</textarea></form>'],
      ['object·embed', '<object data="x.swf"></object><embed src="x.swf"><applet code="x"></applet>'],
      ['math·noscript', '<math><mtext><script>alert(1)</script></mtext></math><noscript><img src=x onerror=alert(1)></noscript>'],
      ['mXSS 꼴', '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>'],
      ['data: 링크', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'],
      ['file: 링크·그림', '<a href="file:///C:/Windows/win.ini">x</a><img src="file:///C:/Windows/win.ini">'],
      ['target·ping', '<a href="https://example.com" target="_blank" ping="https://evil.example">x</a>'],
    ]
    for (const [name, source] of hostile) {
      it(`${name} 는 실행될 수 있는 것이 남지 않는다`, () => {
        const { html } = renderFlowDocument('html', source)
        expectInert(html)
        expect(html).not.toMatch(/javascript:/iu)
        expect(html).not.toContain('alert(')
      })
    }

    it('앞뒤 문단은 살아남는다', () => {
      const { html } = renderFlowDocument('html', '<p>앞</p><script>alert(1)</script><p>뒤</p>')
      expect(html).toBe('<p>앞</p><p>뒤</p>')
    })

    it('data: 링크·file: 링크는 href 가 사라진다', () => {
      expect(renderFlowDocument('html', '<a href="data:text/html;base64,AAAA">x</a>').html).toBe('<a>x</a>')
      expect(renderFlowDocument('html', '<a href="file:///C:/a.txt">x</a>').html).toBe('<a>x</a>')
    })

    it('target·ping 은 지운다', () => {
      const { html } = renderFlowDocument('html', '<a href="https://example.com" target="_blank" ping="https://evil.example">x</a>')
      expect(html).not.toContain('target')
      expect(html).not.toContain('ping')
    })

    it('엔티티로 쓴 글자는 글자일 뿐 태그가 되지 않는다', () => {
      const { html } = renderFlowDocument('html', '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
      expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
      expectInert(html)
    })
  })
})

describe('renderFlowDocument: xml', () => {
  const sample = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- 주석 -->\n<root a="1" b="x &amp; y">\n  <item id="1">첫째</item>\n  <empty/>\n  <![CDATA[ 글 ]]>\n  <?pi data?>\n</root>\n'

  it('들여 쓴 원문을 색깔 span 으로 그린다', () => {
    const { html, headings, notice } = renderFlowDocument('xml', sample)
    expect(notice).toBeUndefined()
    expect(headings).toEqual([])
    expect(html.startsWith('<pre class="flow-xml">')).toBe(true)
    const template = document.createElement('template')
    template.innerHTML = html
    const lines = template.content.querySelector('pre')!.textContent!.split('\n')
    expect(lines).toEqual([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- 주석 -->',
      '<root a="1" b="x & y">',
      '  <item id="1">첫째</item>',
      '  <empty/>',
      '  <![CDATA[ 글 ]]>',
      '  <?pi data?>',
      '</root>',
    ])
    for (const className of ['xml-tag', 'xml-attr', 'xml-val', 'xml-text', 'xml-comment', 'xml-pi', 'xml-cdata']) {
      expect(html).toContain(`class="${className}"`)
    }
  })

  it('글과 태그가 섞인 요소는 글을 바꾸지 않고 한 줄에 둔다', () => {
    const { html } = renderFlowDocument('xml', '<p>안녕 <b>세상</b> 입니다 </p>')
    const template = document.createElement('template')
    template.innerHTML = html
    expect(template.content.querySelector('pre')!.textContent).toBe('<p>안녕 <b>세상</b> 입니다 </p>')
  })

  it('공백뿐인 글은 접고 글자 내용은 그대로 보존한다', () => {
    const { html } = renderFlowDocument('xml', '<a>\n   <b>  가  나  </b>\n\n   <c>다</c>\n</a>')
    const template = document.createElement('template')
    template.innerHTML = html
    expect(template.content.querySelector('pre')!.textContent).toBe('<a>\n  <b>  가  나  </b>\n  <c>다</c>\n</a>')
  })

  it('이름공간·접두어 속성을 그대로 보인다', () => {
    const { html } = renderFlowDocument('xml', '<x:root xmlns:x="urn:x" x:k="v"><x:a/></x:root>')
    const template = document.createElement('template')
    template.innerHTML = html
    expect(template.content.querySelector('pre')!.textContent).toBe('<x:root xmlns:x="urn:x" x:k="v">\n  <x:a/>\n</x:root>')
  })

  it('XML 을 HTML 로 해석하지 않는다(<script> 요소·CDATA 안 <script>)', () => {
    const { html } = renderFlowDocument('xml', '<root><script>alert(1)</script><img src="x" onerror="alert(2)"/><![CDATA[<script>alert(3)</script>]]></root>')
    expectInert(html)
    const template = document.createElement('template')
    template.innerHTML = html
    // 요소는 pre 와 span 뿐이다
    const names = new Set([...template.content.querySelectorAll('*')].map((element) => element.tagName))
    expect([...names].sort()).toEqual(['PRE', 'SPAN'])
    expect(template.content.textContent).toContain('<script>alert(1)</script>')
    expect(template.content.textContent).toContain('<![CDATA[<script>alert(3)</script>]]>')
  })

  it('속성값의 따옴표·꺾쇠도 글자로만 나온다', () => {
    const { html } = renderFlowDocument('xml', '<a t="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"/>')
    expectInert(html)
    expect(html).not.toContain('<script')
  })

  it('XHTML 이름공간 안 script 요소도 글자로 보인다', () => {
    const { html } = renderFlowDocument('xml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><script>alert(1)</script></body></html>')
    expectInert(html)
  })

  it('깨진 XML 은 글자 그대로 보여 주고 알린다', () => {
    const result = renderFlowDocument('xml', '<root><a></root>')
    expect(result.notice).toBe('XML 형식이 올바르지 않아 글자 그대로 보여 줍니다.')
    expect(result.html).toBe('<p class="flow-text">&lt;root&gt;&lt;a&gt;&lt;/root&gt;</p>')
    expect(result.headings).toEqual([])
  })

  it('깨진 XML 안의 스크립트도 이스케이프된다', () => {
    const result = renderFlowDocument('xml', '<root><script>alert(1)</script><img onerror="alert(2)">')
    expect(result.notice).toBeDefined()
    expectInert(result.html)
  })

  it('빈 글·태그가 없는 글은 깨진 XML 로 본다', () => {
    expect(renderFlowDocument('xml', '').notice).toBeDefined()
    expect(renderFlowDocument('xml', '그냥 글').notice).toBeDefined()
  })

  it('BOM 이 앞에 있어도 읽는다', () => {
    expect(renderFlowDocument('xml', '\ufeff<a/>').notice).toBeUndefined()
  })
})

describe('flowHeadings / flowSectionPreviews', () => {
  it('Markdown 은 원문에서, HTML 은 본문에서 제목을 읽는다', () => {
    expect(flowHeadings('markdown', '# A\n## B')).toEqual([{ depth: 1, title: 'A' }, { depth: 2, title: 'B' }])
    expect(flowHeadings('html', '<h1>A</h1><h3>C</h3>')).toEqual([{ depth: 1, title: 'A' }, { depth: 3, title: 'C' }])
    expect(flowHeadings('text', '# 제목')).toEqual([])
    expect(flowHeadings('xml', '<h1>x</h1>')).toEqual([])
  })

  it('HTML 절 미리보기는 h1–h3 로 나눈다', () => {
    const sections = flowSectionPreviews('html', '<h1>가</h1><p>첫 줄</p><ul><li>항목</li></ul><h2>나</h2><p>둘째</p><h5>작은</h5>')
    expect(sections).toEqual([
      { title: '가', depth: 1, excerpt: '첫 줄 항목' },
      { title: '나', depth: 2, excerpt: '둘째' },
    ])
    expect(flowSectionPreviews('text', '본문')).toEqual([])
    expect(flowSectionPreviews('markdown', '# A\n본문')).toEqual([{ title: 'A', depth: 1, excerpt: '본문' }])
  })
})

describe('큰 적대적 입력', () => {
  const backticks = '`'.repeat(300_000)
  const angles = '<'.repeat(300_000)

  it('텍스트: 백틱·꺾쇠 30만 개도 멈추지 않고 이스케이프한다', () => {
    expect(renderFlowDocument('text', backticks).html.length).toBeGreaterThan(300_000)
    const { html } = renderFlowDocument('text', angles)
    expect(html).not.toContain('<<')
    expect(html.startsWith('<p class="flow-text">&lt;&lt;')).toBe(true)
  })

  it('텍스트: 줄이 아주 많아도 문단이 많아도 처리한다', () => {
    expect(renderFlowDocument('text', 'a\n\n'.repeat(100_000)).html.split('\n')).toHaveLength(100_000)
    expect(renderFlowDocument('text', 'a\n'.repeat(300_000)).html.match(/<p /gu)).toHaveLength(1)
  })

  it('XML: 꺾쇠·백틱 30만 개는 깨진 XML 로 보고 글자 그대로 보인다', () => {
    for (const source of [angles, backticks, `<a>${angles}</a>`]) {
      const result = renderFlowDocument('xml', source)
      expectInert(result.html)
    }
  })

  it('XML: 형제 요소가 수만 개여도 처리한다', () => {
    const result = renderFlowDocument('xml', `<r>${'<i>1</i>'.repeat(50_000)}</r>`)
    expect(result.notice).toBeUndefined()
    expect(result.html.match(/<span class="xml-text">1<\/span>/gu)).toHaveLength(50_000)
  })

  it('HTML: 꺾쇠·백틱 30만 개도 처리한다', () => {
    expectInert(renderFlowDocument('html', angles).html)
    expectInert(renderFlowDocument('html', backticks).html)
  })
})

describe('flowPlainText', () => {
  it('HTML 은 보이는 글만 뽑고 스크립트·스타일·태그는 뺀다', () => {
    const text = flowPlainText('html', '<html><head><title>제목</title><style>.a{}</style></head><body><h1>큰 제목</h1><p>첫 <b>글</b></p><script>var secret=1</script><ul><li>하나</li><li>둘</li></ul></body></html>')
    expect(text).toContain('큰 제목')
    expect(text).toContain('첫 글')
    expect(text).toContain('하나\n둘')
    expect(text).not.toContain('secret')
    expect(text).not.toContain('.a{}')
    expect(text).not.toContain('<')
  })

  it('XML 은 글 마디와 속성값을 뽑고 태그 이름은 뺀다', () => {
    const text = flowPlainText('xml', '<root id="r1" empty=""><item name="가나">첫째<![CDATA[ 셋째 ]]></item><!-- 주석 --></root>')
    expect(text).toBe('r1\n가나\n첫째\n셋째')
  })

  it('깨진 XML 은 원문 그대로, 텍스트·Markdown 은 그대로', () => {
    expect(flowPlainText('xml', '<a><b>')).toBe('<a><b>')
    expect(flowPlainText('text', '<b>x</b>')).toBe('<b>x</b>')
    expect(flowPlainText('markdown', '# 제목')).toBe('# 제목')
  })

  it('아주 깊은 XML 도 스택이 넘치지 않는다', () => {
    const deep = '<a>'.repeat(5000) + '글' + '</a>'.repeat(5000)
    expect(() => flowPlainText('xml', deep)).not.toThrow()
  })
})
