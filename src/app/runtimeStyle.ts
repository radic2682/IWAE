/**
 * 실행 중에 만드는 CSS 는 <style> 요소나 style="" 속성으로 넣지 않는다.
 * 제품 빌드의 CSP(style-src)에는 Tauri 가 nonce 를 붙여서 'unsafe-inline' 이 무시되고, 그런 요소·속성은 적용되지 않는다.
 * CSSOM(constructable stylesheet · el.style)은 style-src 의 대상이 아니라서 그대로 먹는다.
 */

type AdoptingDocument = Document & { adoptedStyleSheets: CSSStyleSheet[] }

function canAdopt(doc: Document): boolean {
  const view = doc.defaultView
  if (view === null || typeof view.CSSStyleSheet !== 'function') return false
  if (!('adoptedStyleSheets' in doc)) return false
  try {
    const probe = new view.CSSStyleSheet()
    return typeof probe.replaceSync === 'function'
  } catch {
    return false
  }
}

const keyed = new WeakMap<Document, Map<string, CSSStyleSheet>>()

/** key 하나당 시트 한 개를 문서에 달고, 다시 부르면 같은 시트를 고쳐 쓴다. constructable 시트가 없는 환경(테스트 등)에서만 <style id=key> 로 대신한다 */
export function setRuntimeSheet(key: string, css: string, doc: Document = document): void {
  if (canAdopt(doc)) {
    const adopting = doc as AdoptingDocument
    let sheets = keyed.get(doc)
    if (sheets === undefined) {
      sheets = new Map()
      keyed.set(doc, sheets)
    }
    let sheet = sheets.get(key)
    if (sheet === undefined) {
      sheet = new (doc.defaultView as Window & typeof globalThis).CSSStyleSheet()
      sheets.set(key, sheet)
      adopting.adoptedStyleSheets = [...adopting.adoptedStyleSheets, sheet]
    }
    sheet.replaceSync(css)
    return
  }
  let style = doc.getElementById(key)
  if (style === null) {
    style = doc.createElement('style')
    style.id = key
    doc.head.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css
}

/** 지금 key 의 CSS(없으면 null). 시트든 <style> 대체든 같은 글을 돌려준다 */
export function getRuntimeSheetCss(key: string, doc: Document = document): string | null {
  const sheet = keyed.get(doc)?.get(key)
  if (sheet !== undefined) return [...sheet.cssRules].map((rule) => rule.cssText).join('\n')
  const style = doc.getElementById(key)
  return style === null ? null : style.textContent
}

export function removeRuntimeSheet(key: string, doc: Document = document): void {
  const sheet = keyed.get(doc)?.get(key)
  if (sheet !== undefined) {
    const adopting = doc as AdoptingDocument
    adopting.adoptedStyleSheets = adopting.adoptedStyleSheets.filter((item) => item !== sheet)
    keyed.get(doc)?.delete(key)
    return
  }
  doc.getElementById(key)?.remove()
}

let transientCount = 0

/** 인쇄처럼 잠깐만 쓰는 CSS. 돌려받은 함수를 부르면 걷힌다 */
export function addTransientSheet(css: string, doc: Document = document): () => void {
  transientCount += 1
  const key = `iwae-transient-${transientCount}`
  setRuntimeSheet(key, css, doc)
  return () => removeRuntimeSheet(key, doc)
}

/**
 * innerHTML 로 들어온 style="" 속성은 CSP 가 막는다. 속성 글을 읽어 el.style(CSSOM)로 다시 입히면 먹는다.
 * 메모 서식(글자색·배경색 등)처럼 HTML 로 저장해 둔 글을 그릴 때 부른다.
 */
export function restoreInlineStyles(root: Element): void {
  const targets = root.querySelectorAll<HTMLElement>('[style]')
  targets.forEach((element) => {
    const text = element.getAttribute('style')
    if (text === null || text === '') return
    element.style.cssText = text
  })
}
