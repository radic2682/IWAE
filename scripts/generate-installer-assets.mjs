import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateSync } from 'node:zlib'

const COLORS = {
  ink: [20, 37, 49],
  paper: [247, 245, 239],
  cyan: [32, 193, 211],
  gold: [255, 190, 56],
  muted: [128, 145, 155],
}

function createCanvas(width, height, color) {
  const pixels = new Uint8Array(width * height * 3)
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels[offset] = color[0]
    pixels[offset + 1] = color[1]
    pixels[offset + 2] = color[2]
  }
  return { width, height, pixels }
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
  const offset = (y * canvas.width + x) * 3
  canvas.pixels[offset] = color[0]
  canvas.pixels[offset + 1] = color[1]
  canvas.pixels[offset + 2] = color[2]
}

function fillRect(canvas, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) setPixel(canvas, column, row, color)
  }
}

function ring(canvas, centerX, centerY, radius, thickness, color, gapStart = -Infinity, gapEnd = -Infinity) {
  const outer = radius * radius
  const inner = (radius - thickness) * (radius - thickness)
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const distance = (x - centerX) ** 2 + (y - centerY) ** 2
      if (distance > outer || distance < inner) continue
      const angle = (Math.atan2(y - centerY, x - centerX) * 180 / Math.PI + 360) % 360
      if (angle >= gapStart && angle <= gapEnd) continue
      setPixel(canvas, x, y, color)
    }
  }
}

function renderMark(canvas, centerX, centerY, scale = 1) {
  ring(canvas, centerX - Math.round(8 * scale), centerY + Math.round(6 * scale), Math.round(19 * scale), Math.max(3, Math.round(7 * scale)), COLORS.cyan, 252, 334)
  ring(canvas, centerX + Math.round(8 * scale), centerY - Math.round(6 * scale), Math.round(19 * scale), Math.max(3, Math.round(7 * scale)), COLORS.gold, 72, 154)
}

export function encodeBmp(canvas) {
  const rowSize = Math.ceil(canvas.width * 3 / 4) * 4
  const pixelBytes = rowSize * canvas.height
  const buffer = Buffer.alloc(54 + pixelBytes)
  buffer.write('BM', 0, 'ascii')
  buffer.writeUInt32LE(buffer.length, 2)
  buffer.writeUInt32LE(54, 10)
  buffer.writeUInt32LE(40, 14)
  buffer.writeInt32LE(canvas.width, 18)
  buffer.writeInt32LE(canvas.height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(pixelBytes, 34)
  buffer.writeInt32LE(3780, 38)
  buffer.writeInt32LE(3780, 42)

  for (let y = 0; y < canvas.height; y += 1) {
    const targetRow = canvas.height - 1 - y
    for (let x = 0; x < canvas.width; x += 1) {
      const source = (y * canvas.width + x) * 3
      const target = 54 + targetRow * rowSize + x * 3
      buffer[target] = canvas.pixels[source + 2] ?? 0
      buffer[target + 1] = canvas.pixels[source + 1] ?? 0
      buffer[target + 2] = canvas.pixels[source] ?? 0
    }
  }
  return buffer
}

export function readBmpInfo(buffer) {
  if (buffer.toString('ascii', 0, 2) !== 'BM') throw new Error('Not a BMP file')
  return {
    width: buffer.readInt32LE(18),
    height: buffer.readInt32LE(22),
    bitsPerPixel: buffer.readUInt16LE(28),
  }
}

function headerArtwork() {
  const canvas = createCanvas(150, 57, COLORS.paper)
  fillRect(canvas, 0, 0, 5, 57, COLORS.ink)
  fillRect(canvas, 5, 0, 2, 57, COLORS.cyan)
  renderMark(canvas, 122, 28, 0.78)
  fillRect(canvas, 18, 25, 60, 3, COLORS.ink)
  fillRect(canvas, 18, 32, 42, 2, COLORS.muted)
  return canvas
}

function sidebarArtwork() {
  const canvas = createCanvas(164, 314, COLORS.ink)
  fillRect(canvas, 0, 0, 4, 314, COLORS.cyan)
  renderMark(canvas, 82, 92, 1.65)
  fillRect(canvas, 34, 151, 96, 4, COLORS.paper)
  fillRect(canvas, 50, 164, 64, 2, COLORS.muted)
  for (let index = 0; index < 3; index += 1) {
    fillRect(canvas, 34 + index * 16, 238 - index * 13, 62, 2, index === 1 ? COLORS.gold : COLORS.cyan)
  }
  return canvas
}

export async function generateInstallerAssets(outputDirectory) {
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    writeFile(join(outputDirectory, 'header.bmp'), encodeBmp(headerArtwork())),
    writeFile(join(outputDirectory, 'sidebar.bmp'), encodeBmp(sidebarArtwork())),
  ])
}

// ---------- HTML 그림(src-tauri/installer/*.html)을 브라우저로 2배 크기로 찍어 BMP 로 ----------
// NSIS(MUI2)는 그림을 칸 크기에 맞춰 줄이므로 2배로 주면 125%·150% 배율 화면에서도 선명하다

export const CHROMIUM_CANDIDATES = [
  process.env.IWAE_CHROMIUM,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
]

/** 있는 브라우저 모두(앞의 것 먼저) */
export function findChromiums(candidates = CHROMIUM_CANDIDATES) {
  return [...new Set(candidates.filter((path) => typeof path === 'string' && path !== '' && existsSync(path)))]
}

export function findChromium(candidates = CHROMIUM_CANDIDATES) {
  return findChromiums(candidates)[0] ?? null
}

/** 8비트 RGB/RGBA PNG → { width, height, pixels(RGB) } */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG file')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const data = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[12] !== 0) throw new Error('Only 8-bit non-interlaced PNG is supported')
      colorType = body[9]
    } else if (type === 'IDAT') {
      data.push(body)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (channels === 0) throw new Error(`Unsupported PNG color type ${colorType}`)
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const rows = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const source = y * (stride + 1) + 1
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? rows[y * stride + x - channels] : 0
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0
      const upLeft = y > 0 && x >= channels ? rows[(y - 1) * stride + x - channels] : 0
      let value = raw[source + x]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      rows[y * stride + x] = value & 255
    }
  }
  const pixels = new Uint8Array(width * height * 3)
  for (let index = 0; index < width * height; index += 1) {
    const alpha = channels === 4 ? rows[index * 4 + 3] / 255 : 1
    for (let channel = 0; channel < 3; channel += 1) {
      // 투명한 곳은 흰 바탕에 얹는다
      pixels[index * 3 + channel] = Math.round(rows[index * channels + channel] * alpha + 255 * (1 - alpha))
    }
  }
  return { width, height, pixels }
}

/** 스크린샷 파일이 생기고 크기가 멈출 때까지 기다린다(최대 8초) */
async function waitForShot(path) {
  let lastSize = -1
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const size = await stat(path).then((info) => info.size, () => -1)
    if (size > 0 && size === lastSize) return
    lastSize = size
    await new Promise((done) => setTimeout(done, 250))
  }
  throw new Error(`스크린샷이 만들어지지 않았습니다: ${path}`)
}

/**
 * 헤드리스 Edge 는 이미 떠 있는 Edge 가 있으면 일을 넘기고 그림 없이 끝나는 때가 있다(따로 프로필을 줘도).
 * 브라우저마다 두 번씩 찍어 보고, 안 되면 다음 브라우저(Chrome …)로 넘어간다
 */
async function screenshot(browsers, html, width, height, scale) {
  let lastError
  for (const browser of browsers) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await screenshotOnce(browser, html, width, height, scale)
      } catch (error) {
        lastError = error
      }
    }
  }
  throw lastError
}

async function screenshotOnce(browser, html, width, height, scale) {
  const directory = await mkdtemp(join(tmpdir(), 'iwae-installer-art-'))
  const output = join(directory, 'shot.png')
  try {
    // 따로 프로필을 쓰지 않으면 이미 떠 있는 Edge 에 일을 넘기고 바로 끝나, 그림이 생기기 전에 읽게 된다
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
      `--user-data-dir=${join(directory, 'profile')}`,
      `--force-device-scale-factor=${scale}`, `--window-size=${width},${height}`,
      `--screenshot=${output}`, pathToFileURL(html).href,
    ], { stdio: 'ignore' })
    await waitForShot(output)
    return decodePng(await readFile(output))
  } finally {
    // 헤드리스 Edge 가 끝난 직후에도 프로필 파일을 잠깐 붙들고 있다: 몇 번 다시 해 보고, 그래도 안 되면 임시 폴더라 남겨 둔다
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {})
  }
}

/** HTML 그림을 찍어 BMP 로 쓴다. 브라우저가 없으면 false(그때는 픽셀 그림으로) */
export async function renderInstallerAssets(outputDirectory, { browser, scale = 2 } = {}) {
  const browsers = browser === undefined ? findChromiums() : browser === null ? [] : [browser]
  if (browsers.length === 0) return false
  const source = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/installer')
  await mkdir(outputDirectory, { recursive: true })
  const header = await screenshot(browsers, join(source, 'header.html'), 150, 57, scale)
  const sidebar = await screenshot(browsers, join(source, 'sidebar.html'), 164, 314, scale)
  await writeFile(join(outputDirectory, 'header.bmp'), encodeBmp(header))
  await writeFile(join(outputDirectory, 'sidebar.bmp'), encodeBmp(sidebar))
  return true
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(currentFile)) {
  const output = resolve(dirname(currentFile), '../src-tauri/installer')
  if (await renderInstallerAssets(output)) {
    console.log('Rendered IWAE NSIS installer artwork from HTML (2x).')
  } else {
    await generateInstallerAssets(output)
    console.log('No Chromium browser found: generated fallback NSIS installer artwork.')
  }
}
