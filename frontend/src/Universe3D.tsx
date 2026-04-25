import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import MathRenderer from './MathRenderer'
import TextRenderer from './TextRenderer'

// ─── Palette ──────────────────────────────────────────────────────────────────

const COLORS: Record<string, string> = {
  geometry:      '#60a5fa',
  number_theory: '#fbbf24',
  algebra:       '#a78bfa',
  combinatorics: '#34d399',
  series:        '#f87171',
  array:         '#fb923c',
  graph:         '#4ade80',
  dp:            '#818cf8',
  string:        '#e879f9',
  math:          '#38bdf8',
  search:        '#fde68a',
  struct:        '#6ee7b7',
  other:         '#94a3b8',
}

const COLOR_OBJ: Record<string, THREE.Color> = Object.fromEntries(
  Object.entries(COLORS).map(([k, v]) => [k, new THREE.Color(v)])
)

const MATH_TOPICS = ['geometry', 'number_theory', 'algebra', 'combinatorics', 'series'] as const
const CS_TOPICS   = ['array', 'graph', 'dp', 'string', 'search', 'struct'] as const

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UniverseNode {
  id: string
  type: 'math' | 'cs'
  problem_id: number
  x: number; y: number; z: number
  topic: string
  difficulty?: string
  preview: string
  preview_text?: string
  full_text?: string
  query_seed?: string
  title?: string
  url?: string
}

export interface Universe3DProps {
  subject: 'math' | 'cs'
  highlightIds: Set<string>
  onFindSimilar: (node: UniverseNode) => void
  onClose: () => void
}

// ─── GLSL shaders ─────────────────────────────────────────────────────────────
//
// Every node is a gl_PointCoord circle computed in the fragment shader.
// Nothing is sampled from a texture, so there is zero blurring at any zoom level.

const VERT = /* glsl */`
attribute float aSize;
attribute vec3  aColor;
attribute float aOpacity;
attribute float aGlow;

varying vec3  vColor;
varying float vOpacity;
varying float vGlow;

void main() {
  vColor   = aColor;
  vOpacity = aOpacity;
  vGlow    = aGlow;

  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // size attenuation: appears larger when close, smaller when far
  gl_PointSize = clamp(aSize * 800.0 / -mv.z, 1.5, 60.0);
  gl_Position  = projectionMatrix * mv;
}
`

const FRAG = /* glsl */`
varying vec3  vColor;
varying float vOpacity;
varying float vGlow;

void main() {
  vec2  uv   = gl_PointCoord * 2.0 - 1.0;
  float dist = length(uv);
  if (dist > 1.0) discard;

  // Crisp filled circle — 1-2px soft edge only for antialiasing, nothing more
  float circle = 1.0 - smoothstep(0.78, 1.0, dist);

  // Subtle spherical shading: slightly brighter centre
  float shine  = (1.0 - smoothstep(0.0, 0.55, dist)) * 0.28;

  vec3  color = mix(vColor, vec3(1.0), shine);
  float alpha = circle * vOpacity;

  // Thin selection ring — only drawn when selected (vGlow > 1)
  float ring = smoothstep(0.66, 0.72, dist)
             * (1.0 - smoothstep(0.82, 0.92, dist))
             * clamp(vGlow - 1.0, 0.0, 1.0);
  alpha = max(alpha, ring * 0.9 * vOpacity);
  color = mix(color, vec3(1.0), ring * 0.75);

  gl_FragColor = vec4(color, alpha);
}
`

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nodeBaseSize(n: UniverseNode): number {
  if (n.type === 'cs') {
    if (n.difficulty === 'Hard')   return 11
    if (n.difficulty === 'Medium') return 8
    return 6
  }
  return 7
}

type FlyTo = {
  target: THREE.Vector3; lookAt: THREE.Vector3
  start: THREE.Vector3;  startLook: THREE.Vector3
  t0: number; dur: number
}

type ThreeCtx = {
  renderer: THREE.WebGLRenderer
  scene:    THREE.Scene
  camera:   THREE.PerspectiveCamera
  controls: OrbitControls
  points:   THREE.Points
  geo:      THREE.BufferGeometry
  flyTo:    FlyTo | null
  raf:      number
}

// ── Screen-space hit detection ─────────────────────────────────────────────
// Projects every node to CSS pixel space and matches the cursor accurately.
// Two-pass strategy:
//   Pass 1 — cursor within the node's actual rendered pixel circle + prefer
//             the frontmost node (smallest NDC-z) when several overlap.
//   Pass 2 — fallback: nearest node within 18 px (catches very-small nodes
//             when the camera is far away).
// This is zoom-level-independent and always selects the visually correct node.
const _v = new THREE.Vector3()
function screenHit(
  nodes: UniverseNode[],
  camera: THREE.PerspectiveCamera,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): UniverseNode | null {
  const rect  = canvas.getBoundingClientRect()
  const mx    = clientX - rect.left
  const my    = clientY - rect.top
  const w     = rect.width
  const h     = rect.height
  const dpr   = window.devicePixelRatio || 1
  const camX  = camera.position.x
  const camY  = camera.position.y
  const camZ  = camera.position.z

  let best: UniverseNode | null = null
  let bestNdcZ = Infinity  // smaller NDC-z = closer to camera

  // Pass 1: accurate circle-based hit with depth ordering
  for (const n of nodes) {
    _v.set(n.x * S, n.y * S, n.z * S)
    _v.project(camera)
    if (_v.z >= 1 || _v.z < -1) continue  // clipped or behind camera

    const sx = (_v.x + 1) * 0.5 * w
    const sy = (1 - _v.y) * 0.5 * h
    const dx = sx - mx
    const dy = sy - my
    const screenDist = Math.sqrt(dx * dx + dy * dy)

    // Replicate shader size: aSize * 800 / camDist, clamped [1.5, 60]
    const ex = n.x * S - camX
    const ey = n.y * S - camY
    const ez = n.z * S - camZ
    const camDist = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1
    const cssRadius = Math.max(Math.min(nodeBaseSize(n) * 800 / camDist, 60), 1.5) / dpr / 2

    if (screenDist < cssRadius + 4 && _v.z < bestNdcZ) {
      bestNdcZ = _v.z
      best = n
    }
  }
  if (best) return best

  // Pass 2 fallback: nearest node within 18 CSS pixels
  let bestSq = 18 * 18
  for (const n of nodes) {
    _v.set(n.x * S, n.y * S, n.z * S)
    _v.project(camera)
    if (_v.z >= 1 || _v.z < -1) continue
    const sx  = (_v.x + 1) * 0.5 * w
    const sy  = (1 - _v.y) * 0.5 * h
    const dSq = (sx - mx) ** 2 + (sy - my) ** 2
    if (dSq < bestSq) { bestSq = dSq; best = n }
  }
  return best
}

// Multiply backend PCA positions by this factor so nodes aren't crammed together.
// The backend compresses everything into [-150,+150]; with 1600+ nodes that means
// ~25-unit average spacing, which causes overlapping circles even when zoomed in.
// At scale 3 the average gap becomes ~75 units — visually separable at any zoom.
const S = 5

// ─── Component ────────────────────────────────────────────────────────────────

export default function Universe3D({ subject, highlightIds, onFindSimilar, onClose }: Universe3DProps) {
  const mountRef  = useRef<HTMLDivElement>(null)
  const ctxRef    = useRef<ThreeCtx | null>(null)
  const nodesRef  = useRef<UniverseNode[]>([])
  const dnRef     = useRef<{ x: number; y: number } | null>(null) // mousedown pos

  const [nodes,    setNodes]    = useState<UniverseNode[]>([])
  const [loading,  setLoading]  = useState(true)
  const [hovered,  setHovered]  = useState<UniverseNode | null>(null)
  const [selected, setSelected] = useState<UniverseNode | null>(null)
  const [cursorXY, setCursorXY] = useState({ x: 0, y: 0 })

  useEffect(() => { nodesRef.current = nodes }, [nodes])

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/universe')
      .then(r => r.json())
      .then((d: { nodes: UniverseNode[] }) => { setNodes(d.nodes); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // ── Three.js bootstrap ────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || !mountRef.current || nodes.length === 0) return
    const el = mountRef.current

    // Renderer — full device pixel ratio, antialiased
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.setClearColor(0x000814, 1)
    el.appendChild(renderer.domElement)

    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.5, 20000)
    camera.position.set(0, 0, 2800)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping  = true
    controls.dampingFactor  = 0.06
    controls.minDistance    = 5
    controls.maxDistance    = 20000
    controls.zoomToCursor   = true
    controls.screenSpacePanning = true

    // ── Star field ──────────────────────────────────────────────────────────
    const starPos = new Float32Array(6000 * 3)
    for (let i = 0; i < starPos.length; i++) starPos[i] = (Math.random() - 0.5) * 28000
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    scene.add(new THREE.Points(starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, sizeAttenuation: true, transparent: true, opacity: 0.55 })
    ))

    // ── Galaxy-arm divider ──────────────────────────────────────────────────
    const divPos = new Float32Array(800 * 3)
    for (let i = 0; i < 800; i++) {
      divPos[i * 3]     = (Math.random() - 0.5) * 200
      divPos[i * 3 + 1] = (Math.random() - 0.5) * 4000
      divPos[i * 3 + 2] = (Math.random() - 0.5) * 4000
    }
    const divGeo = new THREE.BufferGeometry()
    divGeo.setAttribute('position', new THREE.BufferAttribute(divPos, 3))
    scene.add(new THREE.Points(divGeo,
      new THREE.PointsMaterial({ color: 0x4466aa, size: 1.0, transparent: true, opacity: 0.07 })
    ))

    // ── Problem nodes (single draw call, shader-computed circles) ───────────
    const N   = nodes.length
    const pos = new Float32Array(N * 3)
    const col = new Float32Array(N * 3)
    const sz  = new Float32Array(N)
    const op  = new Float32Array(N)
    const gl  = new Float32Array(N)

    nodes.forEach((n, i) => {
      pos[i * 3]     = n.x * S
      pos[i * 3 + 1] = n.y * S
      pos[i * 3 + 2] = n.z * S

      const c = COLOR_OBJ[n.topic] ?? COLOR_OBJ['other']
      col[i * 3]     = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b

      sz[i] = nodeBaseSize(n)
      op[i] = 1.0
      gl[i] = 1.0
    })

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aColor',   new THREE.BufferAttribute(col, 3))
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sz,  1))
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(op,  1))
    geo.setAttribute('aGlow',    new THREE.BufferAttribute(gl,  1))

    const mat = new THREE.ShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      transparent:    true,
      depthWrite:     false,
    })
    const points = new THREE.Points(geo, mat)
    scene.add(points)

    // ── Render loop ─────────────────────────────────────────────────────────
    const ctx: ThreeCtx = { renderer, scene, camera, controls, points, geo, flyTo: null, raf: 0 }
    ctxRef.current = ctx

    const animate = (now: number) => {
      ctx.raf = requestAnimationFrame(animate)
      controls.update()

      // Smooth camera flyto
      if (ctx.flyTo) {
        const { target, lookAt, start, startLook, t0, dur } = ctx.flyTo
        const t = Math.min((now - t0) / dur, 1)
        const e = 1 - Math.pow(1 - t, 3) // cubic ease-out
        camera.position.lerpVectors(start, target, e)
        controls.target.lerpVectors(startLook, lookAt, e)
        if (t >= 1) ctx.flyTo = null
      }

      renderer.render(scene, camera)
    }
    ctx.raf = requestAnimationFrame(animate)

    // Warp-in intro
    setTimeout(() => flyToPos(ctx, 0, 400, 3500, 0, 0, 0, 2200), 120)

    // ── Resize ──────────────────────────────────────────────────────────────
    const onResize = () => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(ctx.raf)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      geo.dispose()
      mat.dispose()
      starGeo.dispose()
      divGeo.dispose()
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
      ctxRef.current = null
    }
  }, [loading, nodes])

  // ── Sync highlight / selection → shader attributes ────────────────────────
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx || nodes.length === 0) return

    const opAttr  = ctx.geo.getAttribute('aOpacity') as THREE.BufferAttribute
    const glAttr  = ctx.geo.getAttribute('aGlow')    as THREE.BufferAttribute
    const colAttr = ctx.geo.getAttribute('aColor')   as THREE.BufferAttribute

    const hasSearch  = highlightIds.size > 0
    const selId      = selected?.id

    nodes.forEach((n, i) => {
      const isHit = highlightIds.has(n.id)
      const isSel = n.id === selId
      const base  = COLOR_OBJ[n.topic] ?? COLOR_OBJ['other']

      let r = base.r, g = base.g, b = base.b
      let opacity = 1.0
      let glow    = 1.0

      if (hasSearch) {
        if (isHit) {
          // Brighten hit nodes
          r = Math.min(r + 0.18, 1); g = Math.min(g + 0.18, 1); b = Math.min(b + 0.18, 1)
          glow    = 1.9
        } else {
          opacity = 0.10
          glow    = 0.15
        }
      }

      if (selId) {
        if (isSel) {
          r = Math.min(r + 0.35, 1); g = Math.min(g + 0.35, 1); b = Math.min(b + 0.35, 1)
          opacity = 1.0
          glow    = 2.8   // glow > 1 triggers the selection ring in FRAG shader
        } else if (!isHit) {
          opacity *= 0.18
          glow    *= 0.18
        }
      }

      opAttr.setX(i, opacity)
      glAttr.setX(i, glow)
      colAttr.setXYZ(i, r, g, b)
    })

    opAttr.needsUpdate  = true
    glAttr.needsUpdate  = true
    colAttr.needsUpdate = true
  }, [highlightIds, selected, nodes])

  // ── Camera flyto on new search results ────────────────────────────────────
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx || highlightIds.size === 0 || nodes.length === 0) return
    const matched = nodes.filter(n => highlightIds.has(n.id))
    if (!matched.length) return
    const cx = matched.reduce((s, n) => s + n.x * S, 0) / matched.length
    const cy = matched.reduce((s, n) => s + n.y * S, 0) / matched.length
    const cz = matched.reduce((s, n) => s + n.z * S, 0) / matched.length
    flyToPos(ctx, cx, cy + 60, cz + 800, cx, cy, cz, 1400)
  }, [highlightIds, nodes])

  // ── FlyTo ─────────────────────────────────────────────────────────────────
  function flyToPos(
    ctx: ThreeCtx,
    px: number, py: number, pz: number,
    lx: number, ly: number, lz: number,
    dur = 900,
  ) {
    ctx.flyTo = {
      target:    new THREE.Vector3(px, py, pz),
      lookAt:    new THREE.Vector3(lx, ly, lz),
      start:     ctx.camera.position.clone(),
      startLook: ctx.controls.target.clone(),
      t0:        performance.now(),
      dur,
    }
  }

  // ── Hover ─────────────────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const ctx = ctxRef.current
    if (!ctx || nodesRef.current.length === 0) return
    setCursorXY({ x: e.clientX, y: e.clientY })
    const node = screenHit(nodesRef.current, ctx.camera, ctx.renderer.domElement, e.clientX, e.clientY)
    setHovered(node)
    document.body.style.cursor = node ? 'pointer' : 'default'
  }, [])

  useEffect(() => () => { document.body.style.cursor = 'default' }, [])

  // ── Click (distinguish from drag) ────────────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dnRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (dnRef.current) {
      const dx = e.clientX - dnRef.current.x
      const dy = e.clientY - dnRef.current.y
      if (dx * dx + dy * dy > 64) return   // was a drag, not a click (>8px)
    }
    const ctx = ctxRef.current
    if (!ctx || nodesRef.current.length === 0) return
    const node = screenHit(nodesRef.current, ctx.camera, ctx.renderer.domElement, e.clientX, e.clientY)
    if (!node) { setSelected(null); return }
    setSelected(prev => {
      const next = prev?.id === node.id ? null : node
      if (next) flyToPos(ctx, next.x*S, next.y*S + 5, next.z*S + 50, next.x*S, next.y*S, next.z*S, 900)
      return next
    })
  }, [])

  const tooltipText = useCallback((node: UniverseNode) => {
    const t = (node.preview_text ?? node.preview).trim()
    return t.length > 120 ? t.slice(0, 120).trimEnd() + '…' : t
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="uni-overlay">
      <div className="uni-loading">
        <div className="uni-dots"><span /><span /><span /></div>
        <p>Mapping the Problem Multiverse…</p>
      </div>
    </div>
  )

  const mathCount = nodes.filter(n => n.type === 'math').length
  const csCount   = nodes.filter(n => n.type === 'cs').length

  return (
    <div className="uni-overlay">

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="uni-topbar">
        <div className="uni-topbar-left">
          <span className="uni-brand">◉ Problem Multiverse</span>
          <span className="uni-stats">{mathCount} math · {csCount} cs · {nodes.length} total</span>
        </div>
        <div className="uni-topbar-right">
          <span className="uni-hint">Drag to orbit · Scroll to zoom · Click a star</span>
          <button className="uni-close-btn" onClick={onClose}>✕ Exit</button>
        </div>
      </div>

      {/* ── Galaxy arm labels ─────────────────────────────────────────────── */}
      <div className="uni-arm-label uni-arm-left">⟵ MATHEMATICS</div>
      <div className="uni-arm-label uni-arm-right">COMPUTER SCIENCE ⟶</div>

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="uni-legend">
        <div className="uni-legend-col">
          <div className="uni-legend-head">∑ Math</div>
          {MATH_TOPICS.map(t => (
            <div key={t} className="uni-legend-item">
              <span className="uni-dot" style={{ background: COLORS[t] }} />
              {t.replace('_', ' ')}
            </div>
          ))}
        </div>
        <div className="uni-legend-col">
          <div className="uni-legend-head">{'{ }'} CS</div>
          {CS_TOPICS.map(t => (
            <div key={t} className="uni-legend-item">
              <span className="uni-dot" style={{ background: COLORS[t] }} />
              {t}
            </div>
          ))}
        </div>
      </div>

      {/* ── Search badge ──────────────────────────────────────────────────── */}
      {highlightIds.size > 0 && (
        <div className="uni-search-badge">
          ✦ {highlightIds.size} {subject === 'math' ? 'math' : 'CS'} problems matched
        </div>
      )}

      {/* ── WebGL canvas ──────────────────────────────────────────────────── */}
      <div
        ref={mountRef}
        style={{ position: 'absolute', inset: 0, zIndex: 0 }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
      />

      {/* ── Hover tooltip ─────────────────────────────────────────────────── */}
      {hovered && !selected && (
        <div
          className="uni-tooltip"
          style={{ position: 'fixed', left: cursorXY.x + 18, top: cursorXY.y - 10, pointerEvents: 'none' }}
        >
          <div className="uni-tt-type" style={{ color: COLORS[hovered.topic] }}>
            {hovered.type === 'math' ? '∑ Math' : '{ } CS'} · {hovered.topic.replace('_', ' ')}
          </div>
          <div className="uni-tt-title">{hovered.title ?? `Problem #${hovered.problem_id}`}</div>
          <div className="uni-tt-preview">
            <TextRenderer text={tooltipText(hovered)} />
          </div>
          {hovered.difficulty && (
            <span className={`uni-tt-diff diff-${hovered.difficulty.toLowerCase()}`}>{hovered.difficulty}</span>
          )}
          <div className="uni-tt-cta">Click to open →</div>
        </div>
      )}

      {/* ── Selected node panel ───────────────────────────────────────────── */}
      {selected && (
        <div className="uni-panel">
          <button className="uni-panel-close" onClick={() => setSelected(null)}>✕</button>
          <div className="uni-panel-type" style={{ color: COLORS[selected.topic] }}>
            {selected.type === 'math' ? '∑ Math' : '{ } CS'} · {selected.topic.replace('_', ' ')}
          </div>
          <div className="uni-panel-title">
            {selected.title ?? `Problem #${selected.problem_id}`}
          </div>
          {selected.difficulty && (
            <span className={`uni-panel-diff diff-${selected.difficulty.toLowerCase()}`}>{selected.difficulty}</span>
          )}
          <div className="uni-panel-preview">
            {selected.type === 'math'
              ? <MathRenderer text={(selected.full_text ?? selected.preview).trim()} />
              : <TextRenderer  text={(selected.full_text ?? selected.preview).trim()} />
            }
          </div>
          <div className="uni-panel-actions">
            {selected.type === 'cs' && selected.url && (
              <a className="uni-btn-primary" href={selected.url} target="_blank" rel="noreferrer">
                Open on LeetCode ↗
              </a>
            )}
            <button className="uni-btn-ghost" onClick={() => onFindSimilar(selected)}>
              Find similar →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
