import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const EQUATIONS = [
  'e^{iπ} + 1 = 0',
  'E = mc²',
  '∫₀^∞ e^{-x²} dx = √π/2',
  '∇²ψ = 0',
  'F = ma',
  '∂f/∂x',
  'Ax = λx',
  'det(A)',
  'O(n log n)',
  'P(A|B) = P(B|A)P(A)/P(B)',
  '∀x ∈ ℝ',
  '∃δ > 0',
  'lim_{x→0} sin(x)/x = 1',
  'gcd(a, b)',
  'a ≡ b (mod n)',
  '∑_{n=1}^∞ 1/n²= π²/6',
  'T(n) = 2T(n/2) + n',
  '‖v‖ = √(vᵀv)',
  '∇ × B = μ₀J',
  'E[X] = ∑xP(x)',
  'σ² = E[X²] − μ²',
  'O(1)',
  'ℝⁿ',
  '∞',
  '∈',
  '⊆',
  'f\'(x) = lim_{h→0}',
  'n! = n·(n-1)!',
  'C(n,k) = n!/k!(n-k)!',
  'sin²θ + cos²θ = 1',
  'i² = −1',
  '∮ E·dA = Q/ε₀',
  'H = −∑ p log p',
  'x = (−b ± √Δ) / 2a',
  '∇f = (∂f/∂x, ∂f/∂y)',
]

function makeSprite(text: string, opacity: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  canvas.width = 512
  canvas.height = 80
  ctx.clearRect(0, 0, 512, 80)
  const fontSize = text.length > 24 ? 18 : text.length > 14 ? 22 : 26
  ctx.font = `italic ${fontSize}px "Georgia", "Times New Roman", serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = `rgba(255,255,255,${opacity})`
  ctx.fillText(text, 256, 40)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(material)
  const scale = Math.random() * 1.2 + 0.7
  sprite.scale.set(scale * 9, scale * 1.4, 1)
  return sprite
}

export function MathBackground(): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = mountRef.current!
    const W = window.innerWidth
    const H = window.innerHeight

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 500)
    camera.position.z = 40

    // Build sprite pool
    const pool: Array<{ sprite: THREE.Sprite; vx: number; vy: number }> = []
    const count = Math.min(50, Math.floor(W / 30))

    for (let i = 0; i < count; i++) {
      const depth = Math.random()                   // 0 = far, 1 = close
      const opacity = depth * 0.22 + 0.03          // far ≈ 0.03, close ≈ 0.25
      const sprite = makeSprite(EQUATIONS[i % EQUATIONS.length], opacity)

      sprite.position.set(
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 70,
        -depth * 30,                               // z: 0 to -30
      )
      scene.add(sprite)

      const speed = depth * 0.012 + 0.003
      pool.push({
        sprite,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed,
      })
    }

    // Mouse parallax
    let targetX = 0
    let targetY = 0
    const onMouseMove = (e: MouseEvent) => {
      targetX = (e.clientX / window.innerWidth - 0.5) * 6
      targetY = (e.clientY / window.innerHeight - 0.5) * 4
    }
    window.addEventListener('mousemove', onMouseMove)

    const BOUND_X = 55
    const BOUND_Y = 40

    let raf: number
    const animate = () => {
      raf = requestAnimationFrame(animate)

      // Smooth parallax
      camera.position.x += (targetX - camera.position.x) * 0.04
      camera.position.y += (-targetY - camera.position.y) * 0.04
      camera.lookAt(0, 0, 0)

      // Drift sprites
      for (const { sprite, vx, vy } of pool) {
        sprite.position.x += vx
        sprite.position.y += vy
        if (sprite.position.x > BOUND_X) sprite.position.x = -BOUND_X
        if (sprite.position.x < -BOUND_X) sprite.position.x = BOUND_X
        if (sprite.position.y > BOUND_Y) sprite.position.y = -BOUND_Y
        if (sprite.position.y < -BOUND_Y) sprite.position.y = BOUND_Y
      }

      renderer.render(scene, camera)
    }
    animate()

    const onResize = () => {
      const W2 = window.innerWidth
      const H2 = window.innerHeight
      camera.aspect = W2 / H2
      camera.updateProjectionMatrix()
      renderer.setSize(W2, H2)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('resize', onResize)
      pool.forEach(({ sprite }) => {
        ;(sprite.material as THREE.SpriteMaterial).map?.dispose()
        ;(sprite.material as THREE.SpriteMaterial).dispose()
      })
      renderer.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div
      ref={mountRef}
      style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
    />
  )
}
