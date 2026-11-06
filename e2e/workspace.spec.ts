import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const OLLAMA_ORIGIN = 'http://127.0.0.1:11434'

let browserErrors: string[] = []

test.beforeEach(async ({ page }) => {
  // Treat Ollama as unavailable everywhere so a local Ollama install cannot change the result.
  await page.route(`${OLLAMA_ORIGIN}/**`, (route) => route.abort('connectionrefused'))

  browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    // The browser logs refused fetches even when the app handles them.
    if (message.location().url.startsWith(OLLAMA_ORIGIN)) return
    browserErrors.push(message.text())
  })
})

test('workspace renders without browser errors or layout-observer loops', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.shell')).toBeVisible()
  await expect(page.locator('.sidebar')).toHaveCount(1)
  await expect(page.locator('.pane')).toHaveCount(2)
  await expect(page.locator('.pdf-pane')).toBeVisible()
  await expect(page.locator('.note-flow')).toBeVisible()
  await expect(page.getByRole('button', { name: /검색/ }).first()).toBeVisible()
  await page.waitForTimeout(1_000)

  expect(browserErrors, browserErrors.join('\n')).toEqual([])
  await expect(page).toHaveScreenshot('workspace.png', { fullPage: true })
  await page.screenshot({
    path: resolve('docs/images/iwae-workspace.png'),
    fullPage: true,
  })

  await page.getByRole('button', { name: '사이드바 접기' }).click()
  await expect(page.locator('.shell')).toHaveClass(/shell-sidebar-collapsed/)
  await page.getByRole('button', { name: '사이드바 펼치기' }).click()
  await expect(page.locator('.shell')).not.toHaveClass(/shell-sidebar-collapsed/)

  await page.getByRole('button', { name: '설정' }).click()
  await page.getByRole('radio', { name: '다크' }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('radio', { name: '라이트' }).check()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: '설정 닫기' }).click()

  expect(browserErrors, browserErrors.join('\n')).toEqual([])
})

test('library mode, emoji, and reader focus', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.shell')).toBeVisible()

  await page.getByRole('button', { name: '라이브러리 펼치기' }).click()
  await expect(page.locator('.shell')).toHaveClass(/shell-library-expanded/)
  const grid = page.getByRole('grid', { name: '항목 목록' })
  await expect(grid).toBeVisible()

  const pdfRow = grid.getByRole('row').filter({ hasText: 'PDF' }).first()
  await pdfRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '이모지 설정…' }).click()
  const picker = page.getByRole('dialog', { name: '이모지 선택' })
  await picker.getByRole('searchbox', { name: '이모지 검색' }).fill('책')
  await picker.getByRole('button').filter({ hasText: '📚' }).first().click()
  await expect(pdfRow.getByText('📚')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator('.shell')).not.toHaveClass(/shell-library-expanded/)
  await expect(page.locator('.sidebar').getByText('📚')).toBeVisible()

  await page.getByRole('button', { name: '문서 전체 화면' }).click()
  await expect(page.locator('.shell')).toHaveClass(/shell-reader-focused/)
  await expect(page.locator('.pane-right')).toHaveAttribute('aria-hidden', 'true')
  await page.getByRole('button', { name: '분할 화면으로' }).click()
  await expect(page.locator('.shell')).not.toHaveClass(/shell-reader-focused/)

  expect(browserErrors, browserErrors.join('\n')).toEqual([])
})

interface DevChar { c: string; x: number; y: number; w: number; h: number }

/** 개발 미리보기 PDF 첫 쪽에서 낱말이 있는 자리(페이지 points). 끌기 좌표를 지어내지 않으려고 실제 글자 상자에서 읽는다 */
function wordSpan(word: string) {
  const fixture = JSON.parse(readFileSync(resolve('src/pdf/devPdfData.json'), 'utf8')) as {
    pages: { text: string; chars: DevChar[] }[]
    metadata: { pageSizes: [number, number][] }
  }
  const page = fixture.pages[0]!
  const start = page.text.indexOf(word)
  const first = page.chars[start]!
  const last = page.chars[start + word.length - 1]!
  return { first, last, pageWidth: fixture.metadata.pageSizes[0]![0] }
}

test('PDF highlight note, annotation panel, history, and spread', async ({ page }) => {
  await page.goto('/')
  const slot = page.locator('.pdf-page-slot').first()
  await expect(slot).toBeVisible()
  const box = (await slot.boundingBox())!
  const { first, last, pageWidth } = wordSpan('From Evidence')
  const scale = box.width / pageWidth
  const y = box.y + (first.y + first.h / 2) * scale

  // 형광펜으로 "From Evidence" 를 칠한다.
  await page.getByRole('button', { name: '형광펜', exact: true }).click()
  await page.mouse.move(box.x + (first.x + 1) * scale, y)
  await page.mouse.down()
  await page.mouse.move(box.x + (last.x + last.w - 1) * scale, y, { steps: 6 })
  await page.mouse.up()
  await expect(page.locator('.selection-persistent-highlight').first()).toBeVisible()

  // 텍스트 모드로 돌아와 형광펜을 눌러 메모를 단다.
  await page.getByRole('button', { name: '텍스트 선택' }).click()
  await page.mouse.click(box.x + (first.x + first.w) * scale, y)
  const note = page.getByRole('textbox', { name: '형광펜 메모' })
  await note.fill('표지 제목')
  await page.keyboard.press('Escape')

  await page.getByRole('radio', { name: '주석' }).click()
  const list = page.getByRole('list')
  await expect(list.getByText('From Evidence')).toBeVisible()
  await expect(list.getByText('표지 제목')).toBeVisible()

  // 목차 점프 → 뒤로.
  await page.getByRole('radio', { name: '목록' }).click()
  await page.getByRole('button', { name: 'Capture Meaningful Evidence 3쪽' }).click()
  await expect(page.getByRole('spinbutton', { name: '페이지' })).toHaveValue('3')
  await page.getByRole('button', { name: '뒤로' }).click()
  await expect(page.getByRole('spinbutton', { name: '페이지' })).toHaveValue('1')

  // 두 쪽 보기: 2·3쪽이 같은 줄에 놓인다.
  await page.getByRole('button', { name: '보기 옵션' }).click()
  await page.getByRole('radio', { name: '두 쪽' }).click()
  await page.keyboard.press('Escape')
  await page.locator('.pdf-pane').evaluate((element) => { element.scrollTop = 300 })
  await expect.poll(async () => page.locator('.pdf-page-slot').evaluateAll((slots) => {
    const tops = slots.map((element) => (element as HTMLElement).style.top)
    return new Set(tops).size < tops.length
  })).toBe(true)

  expect(browserErrors, browserErrors.join('\n')).toEqual([])
})

test('external AI settings section explains the desktop requirement in the browser preview', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '설정' }).click()
  await page.getByRole('tab', { name: '외부 AI 연결' }).or(page.getByRole('button', { name: '외부 AI 연결' })).first().click()
  await expect(page.getByText('외부 AI 연결은 데스크톱 앱에서만 쓸 수 있습니다.')).toBeVisible()
  expect(browserErrors, browserErrors.join('\n')).toEqual([])
})

test('note exports with its evidence as one self-contained HTML file', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.note-flow')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '근거와 함께 내보내기' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/ 근거\.html$/)
  const html = readFileSync(await download.path(), 'utf8')
  expect(html).toContain('<h2 class="section">근거</h2>')
  expect(html).toContain('data:image/jpeg;base64,')
  expect(html).toContain('data:image/png;base64,')
  expect(html).not.toContain('원본 쪽을 불러오지 못했습니다')
  expect(html).not.toContain('<script')
  expect(browserErrors, browserErrors.join('\n')).toEqual([])
})
