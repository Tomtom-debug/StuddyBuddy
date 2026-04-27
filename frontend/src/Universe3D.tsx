import { useEffect, useRef, useState, useCallback } from 'react'
import { X, Sparkles, Search } from 'lucide-react'
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

export interface UniverseEdge {
  source: string
  target: string
  weight: number
}

export interface Universe3DProps {
  subject: 'math' | 'cs'
  highlightIds: Set<string>
  onSearch: (query: string, subject: 'math' | 'cs', retrieval: 'svd' | 'tfidf' | 'bert') => void
  onReset: () => void
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

type EdgeAnim = {
  lines:   THREE.LineSegments
  geo:     THREE.BufferGeometry
  targets: { sx: number; sy: number; sz: number; tx: number; ty: number; tz: number }[]
  t0:      number
  dur:     number
  stagger: number
  done:    boolean
}

type ThreeCtx = {
  renderer:  THREE.WebGLRenderer
  scene:     THREE.Scene
  camera:    THREE.PerspectiveCamera
  controls:  OrbitControls
  points:    THREE.Points
  geo:       THREE.BufferGeometry
  flyTo:     FlyTo | null
  raf:       number
  edgeAnim:  EdgeAnim | null
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

export default function Universe3D({ subject, highlightIds, onSearch, onReset, onClose }: Universe3DProps) {
  const mountRef       = useRef<HTMLDivElement>(null)
  const ctxRef         = useRef<ThreeCtx | null>(null)
  const nodesRef       = useRef<UniverseNode[]>([])
  const dnRef          = useRef<{ x: number; y: number } | null>(null)
  const edgesRef       = useRef<UniverseEdge[]>([])
  const nodeIndexRef   = useRef<Map<string, number>>(new Map())
  const edgeNodeMapRef = useRef<Map<string, number[]>>(new Map())

  const [nodes,           setNodes]           = useState<UniverseNode[]>([])
  const [loading,         setLoading]         = useState(true)
  const [hovered,         setHovered]         = useState<UniverseNode | null>(null)
  const [selected,        setSelected]        = useState<UniverseNode | null>(null)
  const [cursorXY,        setCursorXY]        = useState({ x: 0, y: 0 })
  const [localHighlights, setLocalHighlights] = useState<Set<string>>(new Set())
  const [simLoading,      setSimLoading]      = useState(false)
  const localHighlightsRef = useRef<Set<string>>(new Set())
  const treeRootRef        = useRef<string | null>(null)

  const [uniQuery,     setUniQuery]     = useState('')
  const [uniSubject,   setUniSubject]   = useState<'math' | 'cs'>(subject)
  const [uniRetrieval, setUniRetrieval] = useState<'svd' | 'tfidf' | 'bert'>('bert')

  const handleUniSearch = useCallback(() => {
    const q = uniQuery.trim()
    if (!q) return
    onSearch(q, uniSubject, uniRetrieval)
  }, [uniQuery, uniSubject, uniRetrieval, onSearch])

  const handleReset = useCallback(() => {
    onReset()
    setUniQuery('')
    setSelected(null)
    treeRootRef.current = null
    localHighlightsRef.current = new Set()
    setLocalHighlights(new Set())
    const ctx = ctxRef.current
    if (!ctx) return
    if (ctx.edgeAnim) {
      ctx.scene.remove(ctx.edgeAnim.lines)
      ctx.edgeAnim.geo.dispose()
      ctx.edgeAnim = null
    }
    flyToPos(ctx, 0, 400, 3500, 0, 0, 0, 1400)
  }, [onReset])

  useEffect(() => { nodesRef.current = nodes }, [nodes])

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/universe')
      .then(r => r.json())
      .then((d: { nodes: UniverseNode[]; edges?: UniverseEdge[] }) => {
        edgesRef.current = d.edges ?? []
        setNodes(d.nodes)
        setLoading(false)
      })
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

    // ── Build neighbor lookup maps (no geometry yet — edges drawn on demand) ──
    const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]))
    nodeIndexRef.current = nodeIndex
    const edgeNodeMap = new Map<string, number[]>()
    edgesRef.current.forEach((e, i) => {
      if (!edgeNodeMap.has(e.source)) edgeNodeMap.set(e.source, [])
      if (!edgeNodeMap.has(e.target)) edgeNodeMap.set(e.target, [])
      edgeNodeMap.get(e.source)!.push(i)
      edgeNodeMap.get(e.target)!.push(i)
    })
    edgeNodeMapRef.current = edgeNodeMap

    // ── Render loop ─────────────────────────────────────────────────────────
    const ctx: ThreeCtx = { renderer, scene, camera, controls, points, geo, flyTo: null, raf: 0, edgeAnim: null }
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

      // Animated edge draw — keep edgeAnim alive after done so cleanup can remove lines
      if (ctx.edgeAnim && !ctx.edgeAnim.done) {
        const { geo: eg, targets, t0, dur, stagger } = ctx.edgeAnim
        const posAttr = eg.getAttribute('position') as THREE.BufferAttribute
        let allDone = true
        targets.forEach((tgt, i) => {
          const elapsed = now - t0 - i * stagger
          const progress = Math.max(0, Math.min(1, elapsed / dur))
          if (progress < 1) allDone = false
          const ease = 1 - Math.pow(1 - progress, 3)
          posAttr.setXYZ(i*2+1,
            tgt.sx + (tgt.tx - tgt.sx) * ease,
            tgt.sy + (tgt.ty - tgt.sy) * ease,
            tgt.sz + (tgt.tz - tgt.sz) * ease,
          )
        })
        posAttr.needsUpdate = true
        if (allDone) ctx.edgeAnim.done = true
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
      if (ctx.edgeAnim) { ctx.edgeAnim.geo.dispose(); ctx.scene.remove(ctx.edgeAnim.lines) }
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
    const szAttr  = ctx.geo.getAttribute('aSize')    as THREE.BufferAttribute

    const effective = localHighlights.size > 0 ? localHighlights : highlightIds
    const hasSearch  = effective.size > 0
    const selId      = selected?.id

    nodes.forEach((n, i) => {
      const isHit = effective.has(n.id)
      const isSel = n.id === selId
      const base  = COLOR_OBJ[n.topic] ?? COLOR_OBJ['other']

      let r = base.r, g = base.g, b = base.b
      let opacity = 1.0
      let glow    = 1.0
      let size    = nodeBaseSize(n)

      if (hasSearch) {
        if (isHit) {
          r = Math.min(r + 0.18, 1); g = Math.min(g + 0.18, 1); b = Math.min(b + 0.18, 1)
          glow = 1.9
          size = nodeBaseSize(n) * 2.2   // make hit nodes pop
        } else {
          opacity = 0.10
          glow    = 0.15
          size    = nodeBaseSize(n) * 0.7
        }
      }

      if (selId) {
        if (isSel) {
          r = Math.min(r + 0.35, 1); g = Math.min(g + 0.35, 1); b = Math.min(b + 0.35, 1)
          opacity = 1.0
          glow    = 2.8
          size    = nodeBaseSize(n) * 2.5
        } else if (!isHit) {
          opacity *= 0.18
          glow    *= 0.18
        }
      }

      opAttr.setX(i, opacity)
      glAttr.setX(i, glow)
      colAttr.setXYZ(i, r, g, b)
      szAttr.setX(i, size)
    })

    opAttr.needsUpdate  = true
    glAttr.needsUpdate  = true
    colAttr.needsUpdate = true
    szAttr.needsUpdate  = true
  }, [highlightIds, localHighlights, selected, nodes])

  // ── Clear edges only when selecting outside the current tree ─────────────
  useEffect(() => {
    // null = deselect (double-click), root node, or any result node — keep tree intact
    if (!selected) return
    if (selected.id === treeRootRef.current) return
    if (localHighlightsRef.current.has(selected.id)) return
    // Clicked outside the tree — tear down
    const ctx = ctxRef.current
    if (ctx?.edgeAnim) {
      ctx.scene.remove(ctx.edgeAnim.lines)
      ctx.edgeAnim.geo.dispose()
      ctx.edgeAnim = null
    }
    treeRootRef.current = null
    localHighlightsRef.current = new Set()
    setLocalHighlights(new Set())
  }, [selected])

  // ── Camera flyto on new search results ────────────────────────────────────
  useEffect(() => {
    const ctx = ctxRef.current
    const effective = localHighlights.size > 0 ? localHighlights : highlightIds
    if (!ctx || effective.size === 0 || nodes.length === 0) return
    const matched = nodes.filter(n => effective.has(n.id))
    if (!matched.length) return
    const cx = matched.reduce((s, n) => s + n.x * S, 0) / matched.length
    const cy = matched.reduce((s, n) => s + n.y * S, 0) / matched.length
    const cz = matched.reduce((s, n) => s + n.z * S, 0) / matched.length
    // Compute spread so that fewer/tighter results get a closer camera
    const spread = matched.reduce((mx, n) => {
      const dx = n.x * S - cx, dy = n.y * S - cy, dz = n.z * S - cz
      return Math.max(mx, Math.sqrt(dx*dx + dy*dy + dz*dz))
    }, 0)
    const dist = Math.max(60, Math.min(spread * 1.0 + 50, 350))
    flyToPos(ctx, cx, cy + dist * 0.08, cz + dist, cx, cy, cz, 1400)
  }, [highlightIds, localHighlights, nodes])

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

  // ── Fire animated edges from source → targets ─────────────────────────────
  function fireEdgeAnim(ctx: ThreeCtx, source: UniverseNode, targets: UniverseNode[]) {
    if (ctx.edgeAnim) {
      ctx.scene.remove(ctx.edgeAnim.lines)
      ctx.edgeAnim.geo.dispose()
      ctx.edgeAnim = null
    }
    if (targets.length === 0) return
    const ec = targets.length
    const edgePos = new Float32Array(ec * 6)
    const edgeCol = new Float32Array(ec * 6)
    const animTargets: EdgeAnim['targets'] = []
    targets.forEach((nb, i) => {
      const sx = source.x*S, sy = source.y*S, sz = source.z*S
      edgePos[i*6]   = sx; edgePos[i*6+1] = sy; edgePos[i*6+2] = sz
      edgePos[i*6+3] = sx; edgePos[i*6+4] = sy; edgePos[i*6+5] = sz
      const c = COLOR_OBJ[nb.topic] ?? COLOR_OBJ['other']
      edgeCol[i*6]   = c.r; edgeCol[i*6+1] = c.g; edgeCol[i*6+2] = c.b
      edgeCol[i*6+3] = c.r; edgeCol[i*6+4] = c.g; edgeCol[i*6+5] = c.b
      animTargets.push({ sx, sy, sz, tx: nb.x*S, ty: nb.y*S, tz: nb.z*S })
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3))
    geo.setAttribute('color',    new THREE.BufferAttribute(edgeCol, 3))
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false,
    }))
    ctx.scene.add(lines)
    ctx.edgeAnim = { lines, geo, targets: animTargets, t0: performance.now(), dur: 600, stagger: 60, done: false }
  }

  // ── Find similar: search + draw edges + highlight — stay in universe ───────
  const handleFindSimilarHere = useCallback(async () => {
    if (!selected) return
    const ctx = ctxRef.current
    if (!ctx) return
    setSimLoading(true)
    const query = (selected.query_seed ?? selected.preview).trim()
    const subj  = selected.type
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subj, query, top_k: 15, retrieval_mode: 'svd', min_similarity: 0.3 }),
      })
      const data = await res.json() as { results?: { problem_id: number }[] }
      const hitIds = new Set((data.results ?? []).map(r => `${subj}_${r.problem_id}`))
      hitIds.delete(selected.id)
      const targetNodes = nodes.filter(n => hitIds.has(n.id))
      treeRootRef.current = selected.id
      localHighlightsRef.current = hitIds
      setLocalHighlights(hitIds)
      fireEdgeAnim(ctx, selected, targetNodes)
      if (targetNodes.length > 0) {
        const all = [selected, ...targetNodes]
        const cx = all.reduce((s, n) => s + n.x*S, 0) / all.length
        const cy = all.reduce((s, n) => s + n.y*S, 0) / all.length
        const cz = all.reduce((s, n) => s + n.z*S, 0) / all.length
        const spread = all.reduce((mx, n) => {
          const dx = n.x*S - cx, dy = n.y*S - cy, dz = n.z*S - cz
          return Math.max(mx, Math.sqrt(dx*dx + dy*dy + dz*dz))
        }, 0)
        const dist = Math.max(80, Math.min(spread * 1.3 + 80, 500))
        flyToPos(ctx, cx, cy + dist * 0.1, cz + dist, cx, cy, cz, 1400)
      }
    } catch { /* silent */ }
    finally { setSimLoading(false) }
  }, [selected, nodes])

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

    // While a tree is active, only allow clicks on tree nodes (root + results)
    const treeActive = treeRootRef.current !== null
    if (treeActive) {
      if (!node) return  // clicked empty space — ignore
      const inTree = node.id === treeRootRef.current || localHighlightsRef.current.has(node.id)
      if (!inTree) return  // clicked outside tree — ignore
    } else {
      if (!node) { setSelected(null); return }
    }

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

        <div className="uni-topbar-search">
          <div className="uni-search-subject">
            <button
              className={`uni-subj-btn${uniSubject === 'math' ? ' active' : ''}`}
              onClick={() => setUniSubject('math')}
            >Math</button>
            <button
              className={`uni-subj-btn${uniSubject === 'cs' ? ' active' : ''}`}
              onClick={() => setUniSubject('cs')}
            >CS</button>
          </div>
          <input
            className="uni-search-input"
            value={uniQuery}
            onChange={e => setUniQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleUniSearch() }}
            placeholder="Search problems…"
          />
          <select
            className="uni-retrieval-select"
            value={uniRetrieval}
            onChange={e => setUniRetrieval(e.target.value as 'svd' | 'tfidf' | 'bert')}
            title="Retrieval method"
          >
            <option value="bert">BERT</option>
            <option value="svd">SVD</option>
            <option value="tfidf">TF-IDF</option>
          </select>
          <button className="uni-search-btn" onClick={handleUniSearch}>
            <Search size={14} />
          </button>
          <button className="uni-reset-btn" onClick={handleReset} title="Reset search and return to overview">
            <X size={13} /> Reset
          </button>
        </div>

        <div className="uni-topbar-right">
          <span className="uni-hint">Drag · Scroll · Click</span>
          <button className="uni-close-btn" onClick={onClose}><X size={14} /> Exit</button>
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
          <Sparkles size={13} /> {highlightIds.size} {subject === 'math' ? 'math' : 'CS'} problems matched
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
          <button className="uni-panel-close" onClick={() => setSelected(null)}><X size={14} /></button>
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
            <button
              className="uni-btn-ghost"
              onClick={() => void handleFindSimilarHere()}
              disabled={simLoading}
            >
              {simLoading ? 'Searching…' : 'Find similar →'}
            </button>
          </div>
          {(() => {
            const neighborIds = (edgeNodeMapRef.current.get(selected.id) ?? [])
              .map(i => { const e = edgesRef.current[i]; return e.source === selected.id ? e.target : e.source })
            const neighbors = neighborIds
              .map(id => nodes.find(n => n.id === id))
              .filter((n): n is UniverseNode => n !== undefined)
            if (neighbors.length === 0) return null
            return (
              <div className="uni-panel-neighbors">
                <div className="uni-panel-neighbors-label">Similar in this cluster</div>
                {neighbors.map(n => (
                  <button key={n.id} className="uni-neighbor-btn" onClick={() => setSelected(n)}>
                    <span className="uni-neighbor-dot" style={{ background: COLORS[n.topic] }} />
                    <span className="uni-neighbor-name">{n.title ?? `Problem #${n.problem_id}`}</span>
                    <span className="uni-neighbor-score">
                      {((edgesRef.current.find(e =>
                        (e.source === selected.id && e.target === n.id) ||
                        (e.target === selected.id && e.source === n.id)
                      )?.weight ?? 0) * 100).toFixed(0)}%
                    </span>
                  </button>
                ))}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
