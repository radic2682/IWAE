// A few dozen quietly twinkling stars behind the content. Cheap on purpose:
// one small canvas, ~30 fps, and a single still frame for reduced motion.
const COUNT = 70
const FRAME_MS = 33

interface Star {
  x: number // 0..1
  y: number // 0..1
  r: number // css px
  base: number // alpha
  speed: number
  phase: number
}

// Fixed seed so the sky looks the same every time the window opens.
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeStars(): Star[] {
  const r = rng(20261116)
  return Array.from({ length: COUNT }, () => ({
    x: r(),
    y: r(),
    r: 0.5 + r() * 0.7,
    base: 0.3 + r() * 0.5,
    speed: 0.25 + r() * 0.6,
    phase: r() * Math.PI * 2,
  }))
}

export function startStarfield(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const stars = makeStars()
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let w = 0
  let h = 0

  const resize = () => {
    const dpr = window.devicePixelRatio || 1
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  const draw = (seconds: number) => {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#fff'
    for (const s of stars) {
      const tw = still ? 1 : 0.65 + 0.35 * Math.sin(seconds * s.speed + s.phase)
      ctx.globalAlpha = s.base * tw
      ctx.beginPath()
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  resize()
  window.addEventListener('resize', () => {
    resize()
    if (still) draw(0)
  })
  if (still) {
    draw(0)
    return
  }
  let last = 0
  const loop = (ms: number) => {
    if (ms - last >= FRAME_MS) {
      last = ms
      draw(ms / 1000)
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}
