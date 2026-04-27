import { useEffect, useRef, useState } from 'react'
import { MathBackground } from './MathBackground'

const MATH_CHARS = ['·', '·', '·', '+', '∑', '∫', '∂', '∇', '∞', '∈', 'λ', 'π', '≈', '×']

const TEAM = ['Amy Oduor', 'Samuel Tawiah', 'Sheki Okwayo', 'Wellington Mapise']

function TypewriterCredits(): JSX.Element {
  const [displayed, setDisplayed] = useState('')
  const [nameIdx, setNameIdx] = useState(0)
  const [phase, setPhase] = useState<'typing' | 'pause' | 'deleting'>('typing')

  useEffect(() => {
    const name = TEAM[nameIdx]
    let timeout: ReturnType<typeof setTimeout>

    if (phase === 'typing') {
      if (displayed.length < name.length) {
        timeout = setTimeout(() => setDisplayed(name.slice(0, displayed.length + 1)), 80)
      } else {
        timeout = setTimeout(() => setPhase('pause'), 1600)
      }
    } else if (phase === 'pause') {
      timeout = setTimeout(() => setPhase('deleting'), 400)
    } else {
      if (displayed.length > 0) {
        timeout = setTimeout(() => setDisplayed(d => d.slice(0, -1)), 45)
      } else {
        setNameIdx(i => (i + 1) % TEAM.length)
        setPhase('typing')
      }
    }

    return () => clearTimeout(timeout)
  }, [displayed, phase, nameIdx])

  return (
    <div style={{
      position: 'absolute',
      bottom: 0, left: 0, right: 0,
      padding: '14px 0 18px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 0,
      zIndex: 10,
      borderTop: '1px solid rgba(255,255,255,0.05)',
      background: 'rgba(5,5,10,0.5)',
      backdropFilter: 'blur(12px)',
      fontFamily: "'NTR', sans-serif",
      fontSize: 14,
      letterSpacing: '0.04em',
    }}>
      <span style={{ color: '#64748b' }}>Team &nbsp;</span>
      <span style={{ color: 'rgba(255,255,255,0.25)', marginRight: 8 }}>·</span>
      <span style={{ color: '#64ffda' }}>{displayed}</span>
      <span style={{
        display: 'inline-block',
        width: 2,
        height: '1.1em',
        background: '#64ffda',
        marginLeft: 2,
        verticalAlign: 'middle',
        animation: 'blink 1s step-end infinite',
      }} />
    </div>
  )
}

interface Particle {
  x: number
  y: number
  targetX: number
  targetY: number
  vx: number
  vy: number
  alpha: number
  baseAlpha: number
  delay: number
  char: string
  shimmer: number
}

function buildParticles(W: number, H: number): Particle[] {
  const offscreen = document.createElement('canvas')
  offscreen.width = W
  offscreen.height = H
  const ctx = offscreen.getContext('2d')!

  const fontSize = Math.max(44, Math.min(Math.floor(W * 0.155), 148))
  ctx.font = `bold ${fontSize}px "NTR", Georgia, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  const NAV_H = 58
  ctx.fillText('StudyBuddy', W / 2, NAV_H + (H - NAV_H) * 0.44)

  const { data: pixels } = ctx.getImageData(0, 0, W, H)
  const gap = Math.max(5, Math.floor(W / 160))
  const particles: Particle[] = []

  for (let y = 0; y < H; y += gap) {
    for (let x = 0; x < W; x += gap) {
      const i = (y * W + x) * 4
      if (pixels[i + 3] > 100) {
        const brightness = pixels[i] / 255
        particles.push({
          x: (Math.random() - 0.5) * W * 1.8 + W / 2,
          y: (Math.random() - 0.5) * H * 1.8 + H / 2,
          targetX: x,
          targetY: y,
          vx: (Math.random() - 0.5) * 8,
          vy: (Math.random() - 0.5) * 8,
          alpha: 0,
          baseAlpha: 0.45 + brightness * 0.55,
          delay: Math.random() * 1.0,
          char: MATH_CHARS[Math.floor(Math.random() * MATH_CHARS.length)],
          shimmer: Math.random() * Math.PI * 2,
        })
      }
    }
  }

  return particles
}

interface Props {
  onEnter: () => void
}

export function LandingPage({ onEnter }: Props): JSX.Element {
  const landingRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -1000, y: -1000, active: false })
  const particlesRef = useRef<Particle[]>([])
  const startTimeRef = useRef<number | null>(null)
  const rafRef = useRef<number>(0)
  const hasInitializedRef = useRef(false)
  const [ctaVisible, setCtaVisible] = useState(false)

  // Re-run animations whenever the landing section scrolls back into view
  useEffect(() => {
    const el = landingRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        if (!hasInitializedRef.current) {
          hasInitializedRef.current = true
          return // first load — animations already started by the canvas effect
        }
        const W = window.innerWidth
        const H = window.innerHeight
        void document.fonts.ready.then(() => {
          particlesRef.current = buildParticles(W, H)
          startTimeRef.current = performance.now()
          setCtaVisible(false)
          setTimeout(() => setCtaVisible(true), 2600)
        })
      },
      { threshold: 0.5 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Scroll/swipe down while landing is in view → jump to search section
  useEffect(() => {
    let touchStartY = 0
    const onWheel = (e: WheelEvent) => {
      if (window.scrollY < window.innerHeight * 0.5 && e.deltaY > 30) onEnter()
    }
    const onTouchStart = (e: TouchEvent) => { touchStartY = e.touches[0].clientY }
    const onTouchEnd = (e: TouchEvent) => {
      if (window.scrollY < window.innerHeight * 0.5 && touchStartY - e.changedTouches[0].clientY > 50) onEnter()
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const W = window.innerWidth
    const H = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio, 2)

    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    document.fonts.ready.then(() => {
      particlesRef.current = buildParticles(W, H)
      startTimeRef.current = performance.now()
      setTimeout(() => setCtaVisible(true), 2600)
    })

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate)
      ctx.clearRect(0, 0, W, H)
      if (!startTimeRef.current || !particlesRef.current.length) return

      const elapsed = (performance.now() - startTimeRef.current) / 1000
      const mouse = mouseRef.current

      ctx.font = '7px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#64ffda'

      for (const p of particlesRef.current) {
        const t = elapsed - p.delay
        if (t < 0) continue

        const fadeEased = 1 - Math.pow(1 - Math.min(t / 1.8, 1), 2)
        const shimmerVal = mouse.active ? Math.sin(elapsed * 2.5 + p.shimmer) * 0.13 : 0
        p.alpha = Math.max(0, p.baseAlpha * fadeEased + shimmerVal)

        if (mouse.active) {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const maxDist = 110
          if (dist < maxDist && dist > 0) {
            const force = (1 - dist / maxDist) * 6
            p.vx += (dx / dist) * force
            p.vy += (dy / dist) * force
          }
        }

        const moveEased = 1 - Math.pow(1 - Math.min(t / 2.8, 1), 3)
        const pull = 0.006 + moveEased * 0.09
        p.vx += (p.targetX - p.x) * pull
        p.vy += (p.targetY - p.y) * pull

        if (t > 1.8) {
          p.vx += Math.sin(elapsed * 0.55 + p.targetY * 0.07) * 0.09
          p.vy += Math.cos(elapsed * 0.55 + p.targetX * 0.07) * 0.09
        }

        p.vx *= 0.87
        p.vy *= 0.87
        p.x += p.vx
        p.y += p.vy

        ctx.globalAlpha = Math.min(1, p.alpha)
        ctx.fillText(p.char, p.x, p.y)
      }

      ctx.globalAlpha = 1
    }

    animate()

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY, active: true }
    }
    const onMouseLeave = () => {
      mouseRef.current = { x: -1000, y: -1000, active: false }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseleave', onMouseLeave)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  return (
    <div
      ref={landingRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100vh',
        background: '#05050a',
        overflow: 'hidden',
        fontFamily: "'NTR', sans-serif",
      }}
    >
      <MathBackground />

      {/* Particle canvas — pointer events none so mouse events go to window */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}
      />

      {/* Tagline + CTA */}
      <div
        style={{
          position: 'absolute',
          bottom: '13%',
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 22,
          zIndex: 10,
          opacity: ctaVisible ? 1 : 0,
          transform: ctaVisible ? 'translateY(0)' : 'translateY(22px)',
          transition: 'opacity 1s ease, transform 1s ease',
        }}
      >
        <p style={{ fontSize: 17, color: '#8892b0', margin: 0, letterSpacing: '0.05em', textAlign: 'center' }}>
          4,500+ math &nbsp;·&nbsp; 2,400+ CS problems &nbsp;·&nbsp; semantic search
        </p>
        <button onClick={onEnter} style={ctaBtnStyle}>
          Start Searching →
        </button>
      </div>

      {ctaVisible && (
        <div style={{
          position: 'absolute',
          bottom: 64,
          left: 0, right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          zIndex: 10,
          animation: 'bounce-arrow 1.6s ease-in-out infinite',
          cursor: 'pointer',
        }} onClick={onEnter}>
          <span style={{ fontSize: 11, letterSpacing: '0.12em', color: '#64748b', textTransform: 'uppercase' }}>scroll</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 9l5 5 5-5" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}

      <TypewriterCredits />
    </div>
  )
}


const ctaBtnStyle: React.CSSProperties = {
  fontFamily: "'NTR', sans-serif",
  fontSize: 18,
  fontWeight: 600,
  padding: '14px 42px',
  borderRadius: 999,
  border: '1px solid rgba(100,255,218,0.45)',
  background: 'rgba(100,255,218,0.1)',
  color: '#64ffda',
  cursor: 'pointer',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 0 28px rgba(100,255,218,0.14)',
  letterSpacing: '0.03em',
}
