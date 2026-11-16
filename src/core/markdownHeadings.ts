/** Markdown 원문의 제목(# … ######) 목록. 코드 블록 안의 # 은 뺀다 */
export function markdownHeadings(source: string): { title: string; depth: number }[] {
  const out: { title: string; depth: number }[] = []
  let inFence = false
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line)
    if (match !== null) out.push({ depth: match[1]!.length, title: match[2]!.replace(/[*_`]/gu, '') })
  }
  return out
}

/** 절 미리보기용: h1–h3 로 나눈 절마다 제목과 첫 몇 줄(표·코드 기호는 걷어 낸다) */
export function markdownSectionPreviews(source: string, lines = 4): { title: string; depth: number; excerpt: string }[] {
  const out: { title: string; depth: number; excerpt: string[] }[] = []
  let inFence = false
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence
      continue
    }
    const heading = inFence ? null : /^(#{1,3})\s+(.+?)\s*#*\s*$/u.exec(line)
    if (heading !== null) {
      out.push({ title: heading[2]!.replace(/[*_`]/gu, ''), depth: heading[1]!.length, excerpt: [] })
      continue
    }
    const current = out.at(-1)
    const text = line.replace(/^[#>\-*+|\s]+|[|*_`]/gu, ' ').replace(/\s+/gu, ' ').trim()
    if (current !== undefined && text !== '' && current.excerpt.length < lines && !/^[-:| ]+$/u.test(line.trim())) current.excerpt.push(text)
  }
  return out.map((item) => ({ title: item.title, depth: item.depth, excerpt: item.excerpt.join(' ') }))
}
