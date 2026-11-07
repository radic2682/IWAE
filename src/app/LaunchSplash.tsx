import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import '../ui/launch-splash.css'

/**
 * 앱을 켤 때의 여는 장면.
 *
 * 세 겹으로 움직인다(motion-design 규칙):
 * - 바탕(ambient): 떠다니던 별이 가운데로 빨려 들며 빛줄기를 남긴다
 * - 주인공(primary): 로고 두 조각(파란 판+고리, 흰 판)이 양쪽에서 오다가, 뒤로 살짝 물러섰다(예비 동작)
 *   자석처럼 가속해 「탁」 맞물린다 — 1~2프레임 멈춤, 눌렸다 튀는 크기, 번쩍임, 충격파 고리, 파티클, 화면 흔들림
 * - 곁(secondary): 고리를 따라 빛이 훑고, 이름이 한 자씩 올라온다
 * 처음 설치한 뒤에는 전체(약 2.4초), 그 뒤로는 맞물림만 짧게(약 0.9초). 클릭·키 하나로 건너뛴다.
 * 움직임 줄이기를 켠 사람에게는 보이지 않는다.
 */

const SEEN_KEY = 'iwae:launch-seen:v1'
/** 파티클 색은 로고에서만: 파랑, 청록, 종이 흰색 */
const COLORS = ['#3f7fd6', '#2ec4b6', '#7ee3d8', '#f4efe6', '#9cc3ff'] as const

interface Star { x: number; y: number; vx: number; vy: number; trail: { x: number; y: number }[]; size: number; color: string; alive: boolean }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string }

export type LaunchVariant = 'full' | 'short'

export function launchVariant(): LaunchVariant | null {
  if (typeof window === 'undefined') return null
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null
  try { return window.localStorage.getItem(SEEN_KEY) === '1' ? 'short' : 'full' } catch { return 'full' }
}

function markSeen(): void {
  try { window.localStorage.setItem(SEEN_KEY, '1') } catch { /* 이번 실행에만 */ }
}

export function LaunchSplash({ variant, onDone }: { readonly variant: LaunchVariant; readonly onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const logoRef = useRef<HTMLDivElement | null>(null)
  const backRef = useRef<HTMLImageElement | null>(null)
  const frontRef = useRef<HTMLImageElement | null>(null)
  const finalRef = useRef<HTMLImageElement | null>(null)
  const flashRef = useRef<HTMLDivElement | null>(null)
  const shineRef = useRef<HTMLDivElement | null>(null)
  const nameRef = useRef<HTMLDivElement | null>(null)
  const [ready, setReady] = useState(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  // 조각 그림을 먼저 읽어 둔다 — 첫 프레임이 끊기지 않게
  useEffect(() => {
    let alive = true
    const sources = ['/about/iwae-logo-back.png', '/about/iwae-logo-front.png', '/iwae-logo.png']
    void Promise.all(sources.map((src) => new Promise<void>((resolve) => {
      const image = new Image()
      image.onload = () => resolve()
      image.onerror = () => resolve()
      image.src = src
    }))).then(() => { if (alive) setReady(true) })
    // 그림이 늦어도 1초 넘게 기다리지 않는다
    const timer = window.setTimeout(() => { if (alive) setReady(true) }, 1000)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [])

  useEffect(() => {
    if (!ready) return
    const root = rootRef.current
    const canvas = canvasRef.current
    const stage = stageRef.current
    const logo = logoRef.current
    const back = backRef.current
    const front = frontRef.current
    if (root === null || canvas === null || stage === null || logo === null || back === null || front === null) return
    const context = canvas.getContext('2d')
    const full = variant === 'full'

    // ---------- 캔버스 ----------
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = 0
    let height = 0
    const resize = () => {
      width = root.clientWidth
      height = root.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    resize()
    window.addEventListener('resize', resize)

    const fx = { pull: 0, starAlpha: full ? 0 : 0, ringR: 0, ringA: 0, ringW: 0, scatter: 0 }
    const stars: Star[] = []
    const sparks: Spark[] = []
    const pick = () => COLORS[Math.floor(Math.random() * COLORS.length)] ?? COLORS[0]
    const spawnStar = (edge: boolean): Star => {
      let x = Math.random() * width
      let y = Math.random() * height
      if (edge) {
        const side = Math.floor(Math.random() * 4)
        x = side === 0 ? -10 : side === 1 ? width + 10 : Math.random() * width
        y = side === 2 ? -10 : side === 3 ? height + 10 : Math.random() * height
      }
      return { x, y, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, trail: [], size: 0.6 + Math.random() * 1.4, color: Math.random() < 0.7 ? '#dfe9ff' : pick(), alive: true }
    }
    if (full) for (let index = 0; index < 110; index += 1) stars.push(spawnStar(false))
    const burst = () => {
      const cx = width / 2
      const cy = height / 2 - 18
      const count = full ? 320 : 180
      for (let index = 0; index < count; index += 1) {
        const angle = Math.random() * Math.PI * 2
        const speed = (full ? 5 : 4) + Math.random() * (full ? 11 : 8)
        const max = 0.38 + Math.random() * 0.3
        sparks.push({ x: cx + Math.cos(angle) * 20, y: cy + Math.sin(angle) * 20, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: max, max, size: 1 + Math.random() * 2.2, color: pick() })
      }
    }

    let last = performance.now()
    const draw = () => {
      if (context === null) return
      const now = performance.now()
      const dt = Math.min((now - last) / 16.67, 3)
      last = now
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = 'lighter'
      const cx = width / 2
      const cy = height / 2 - 18

      // 별: 끌림(pull)이 커질수록 가운데로 가속하고, 빛줄기가 길어진다
      for (const star of stars) {
        if (!star.alive) continue
        const dx = cx - star.x
        const dy = cy - star.y
        const distance = Math.hypot(dx, dy) || 1
        if (fx.scatter > 0) {
          star.vx -= (dx / distance) * 0.12 * fx.scatter * dt
          star.vy -= (dy / distance) * 0.12 * fx.scatter * dt
        } else if (fx.pull > 0) {
          const force = (0.5 + 2600 / (distance + 90)) * fx.pull * 0.09
          star.vx += (dx / distance) * force * dt
          star.vy += (dy / distance) * force * dt
          // 옆으로 조금 휘어 들어온다(소용돌이)
          star.vx += (-dy / distance) * force * 0.3 * dt
          star.vy += (dx / distance) * force * 0.3 * dt
        }
        star.vx *= fx.pull > 0 ? 0.992 : 0.995
        star.vy *= fx.pull > 0 ? 0.992 : 0.995
        star.trail.push({ x: star.x, y: star.y })
        const keep = 2 + Math.round(fx.pull * 14)
        while (star.trail.length > keep) star.trail.shift()
        star.x += star.vx * dt
        star.y += star.vy * dt
        if (fx.pull > 0.05 && distance < 34) {
          // 가운데에 닿은 별은 사라지고, 끌림이 남아 있으면 가장자리에서 다시 온다
          if (fx.pull < 0.95) Object.assign(star, spawnStar(true))
          else star.alive = false
          continue
        }
        const alpha = fx.starAlpha
        if (alpha <= 0) continue
        const head = star.trail[0]
        if (head !== undefined && star.trail.length > 2) {
          context.strokeStyle = star.color
          context.globalAlpha = alpha * (0.35 + fx.pull * 0.5)
          context.lineWidth = star.size
          context.lineCap = 'round'
          context.beginPath()
          context.moveTo(head.x, head.y)
          context.lineTo(star.x, star.y)
          context.stroke()
        }
        context.globalAlpha = alpha
        context.fillStyle = star.color
        context.beginPath()
        context.arc(star.x, star.y, star.size, 0, Math.PI * 2)
        context.fill()
      }

      // 충격파 고리
      if (fx.ringA > 0.01 && fx.ringW > 0.05) {
        context.globalAlpha = fx.ringA
        context.strokeStyle = '#bfe9ff'
        context.lineWidth = fx.ringW
        context.beginPath()
        context.arc(cx, cy, fx.ringR, 0, Math.PI * 2)
        context.stroke()
        context.globalAlpha = fx.ringA * 0.35
        context.strokeStyle = '#2ec4b6'
        context.lineWidth = fx.ringW * 3
        context.beginPath()
        context.arc(cx, cy, fx.ringR * 0.92, 0, Math.PI * 2)
        context.stroke()
      }

      // 파티클: 빠르게 튀고 세게 감쇠, 조금 떨어지며 사라진다
      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index]
        if (spark === undefined) continue
        spark.life -= dt / 60
        if (spark.life <= 0) { sparks.splice(index, 1); continue }
        const damping = Math.pow(0.92, dt)
        spark.vx *= damping
        spark.vy = spark.vy * damping + 0.05 * dt
        spark.x += spark.vx * dt
        spark.y += spark.vy * dt
        const t = spark.life / spark.max
        context.globalAlpha = Math.min(1, t * 1.6)
        context.fillStyle = spark.color
        context.beginPath()
        context.arc(spark.x, spark.y, spark.size * (0.4 + t * 0.6), 0, Math.PI * 2)
        context.fill()
      }
      context.globalAlpha = 1
      context.globalCompositeOperation = 'source-over'
    }
    gsap.ticker.add(draw)

    // ---------- 타임라인 ----------
    const vw = width
    const near = Math.min(vw * 0.14, 180)
    const far = Math.min(vw * 0.32, 420)
    gsap.set(back, { x: full ? -far : -near * 1.3, opacity: 0, rotate: full ? -8 : -4 })
    gsap.set(front, { x: full ? far : near * 1.3, opacity: 0, rotate: full ? 7 : 4 })
    gsap.set(logo, { scale: 1 })
    gsap.set(finalRef.current, { opacity: 0 })
    gsap.set(nameRef.current?.children ?? [], { opacity: 0, y: 8 })

    const finish = () => {
      markSeen()
      doneRef.current()
    }
    const timeline = gsap.timeline({ onComplete: finish })
    if (full) {
      // 0~0.6초: 별이 떠오르고, 조각이 멀리서 천천히 나타난다
      timeline.to(fx, { starAlpha: 1, duration: 0.35, ease: 'sine.out' }, 0)
      timeline.to(fx, { pull: 1, duration: 0.9, ease: 'power2.in' }, 0.15)
      timeline.to([back, front], { opacity: 1, duration: 0.3, ease: 'sine.out' }, 0.25)
      timeline.to(back, { x: -near, rotate: -4, duration: 0.45, ease: 'power2.out' }, 0.25)
      timeline.to(front, { x: near, rotate: 4, duration: 0.45, ease: 'power2.out' }, 0.25)
    } else {
      timeline.to([back, front], { opacity: 1, duration: 0.14, ease: 'sine.out' }, 0)
      timeline.to(back, { x: -near, duration: 0.18, ease: 'power2.out' }, 0)
      timeline.to(front, { x: near, duration: 0.18, ease: 'power2.out' }, 0)
    }
    // 예비 동작: 맞물리기 직전, 살짝 뒤로 물러선다
    const pullBack = full ? 0.7 : 0.18
    timeline.to(back, { x: -near - 10, rotate: -5, duration: 0.12, ease: 'sine.inOut' }, pullBack)
    timeline.to(front, { x: near + 10, rotate: 5, duration: 0.12, ease: 'sine.inOut' }, pullBack)
    // 자석 끌림: 끝으로 갈수록 빨라지다가, 마지막 몇 px 에서 한 번 더 빨려 든다
    const pullStart = pullBack + 0.12
    timeline.to(back, { x: -6, rotate: -1, duration: full ? 0.24 : 0.18, ease: 'expo.in' }, pullStart)
    timeline.to(front, { x: 6, rotate: 1, duration: full ? 0.24 : 0.18, ease: 'expo.in' }, pullStart)
    const contact = pullStart + (full ? 0.24 : 0.18)
    timeline.to([back, front], { x: 0, rotate: 0, duration: 0.05, ease: 'power4.in' }, contact - 0.05)

    // 「탁」: 1~2프레임 멈춤(히트스톱) 뒤에 한꺼번에
    const hit = contact + 0.033
    timeline.call(burst, [], hit)
    timeline.to(logo, { scale: 0.94, duration: 0.05, ease: 'power2.out' }, contact)
    timeline.to(logo, { scale: 1.06, duration: 0.08, ease: 'power3.out' }, hit)
    timeline.to(logo, { scale: 1, duration: 0.3, ease: 'elastic.out(1, 0.45)' }, hit + 0.08)
    timeline.fromTo(flashRef.current, { opacity: 0, scale: 0.6 }, { opacity: 0.9, scale: 1, duration: 0.03, ease: 'none', immediateRender: false }, hit)
    timeline.to(flashRef.current, { opacity: 0, scale: 1.5, duration: 0.18, ease: 'power2.out' }, hit + 0.03)
    timeline.fromTo(fx, { ringR: 40, ringA: 0.85, ringW: 6 }, { ringR: Math.max(width, height) * (full ? 0.36 : 0.26), ringA: 0, ringW: 0, duration: 0.45, ease: 'expo.out', immediateRender: false }, hit)
    timeline.to(stage, {
      keyframes: { x: [5, -4, 3, -2, 1, 0], rotate: [0.5, -0.4, 0.25, -0.12, 0, 0] },
      duration: 0.22,
      ease: 'none',
    }, hit)
    timeline.set(finalRef.current, { opacity: 1 }, hit + 0.16)
    if (full) {
      timeline.to(fx, { pull: 0, duration: 0.01 }, hit)
      timeline.to(fx, { scatter: 1, duration: 0.2, ease: 'power2.out' }, hit)
      timeline.to(fx, { starAlpha: 0, duration: 0.7, ease: 'sine.in' }, hit + 0.2)
      // 여운: 빛이 로고를 한 번 훑고, 이름이 한 자씩 올라온다
      timeline.fromTo(shineRef.current, { xPercent: -140, opacity: 0 }, { xPercent: 140, opacity: 1, duration: 0.55, ease: 'power2.inOut', immediateRender: false }, hit + 0.18)
      timeline.to(shineRef.current, { opacity: 0, duration: 0.15 }, hit + 0.6)
      timeline.to(nameRef.current?.children ?? [], { opacity: 1, y: 0, duration: 0.32, ease: 'power3.out', stagger: 0.06 }, hit + 0.22)
    }
    // 퇴장: 살짝 작아지며 흐려지고, 앱 화면이 드러난다
    const exit = full ? hit + 1.0 : hit + 0.35
    timeline.to(stage, { scale: 0.92, filter: 'blur(4px)', duration: 0.3, ease: 'power2.in' }, exit)
    timeline.to(root, { opacity: 0, duration: 0.3, ease: 'power2.in' }, exit)

    // 건너뛰기: 클릭·키 → 퇴장만 보인다
    const skip = () => {
      if (timeline.time() < exit) timeline.seek(exit)
    }
    root.addEventListener('pointerdown', skip)
    window.addEventListener('keydown', skip)
    return () => {
      timeline.kill()
      gsap.ticker.remove(draw)
      window.removeEventListener('resize', resize)
      root.removeEventListener('pointerdown', skip)
      window.removeEventListener('keydown', skip)
    }
  }, [ready, variant])

  return (
    <div ref={rootRef} className="launch-splash" aria-hidden="true">
      <canvas ref={canvasRef} className="launch-splash-canvas" />
      <div ref={stageRef} className="launch-splash-stage">
        <div ref={logoRef} className="launch-splash-logo">
          <img ref={backRef} className="launch-splash-piece" src="/about/iwae-logo-back.png" alt="" />
          <img ref={frontRef} className="launch-splash-piece" src="/about/iwae-logo-front.png" alt="" />
          <img ref={finalRef} className="launch-splash-piece" src="/iwae-logo.png" alt="" />
          <div className="launch-splash-shine-mask"><div ref={shineRef} className="launch-splash-shine" /></div>
        </div>
        <div ref={nameRef} className="launch-splash-name">
          {'IWAE'.split('').map((letter, index) => <span key={index}>{letter}</span>)}
        </div>
      </div>
      <div ref={flashRef} className="launch-splash-flash" />
    </div>
  )
}
