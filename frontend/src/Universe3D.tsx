import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import * as THREE from 'three'
import MathRenderer from './MathRenderer'
import TextRenderer from './TextRenderer'

// ─── Palette ─────────────────────────────────────────────────────────────────

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

// ─── Texture helpers ──────────────────────────────────────────────────────────

const _haloTexCache: Record<string, THREE.CanvasTexture> = {}
const _coreTexCache: Record<string, THREE.CanvasTexture> = {}
const _ringTexCache: Record<string, THREE.CanvasTexture> = {}

function parseHex(hex: string): [number, number, number] {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)))
  return clamped.toString(16).padStart(2, '0')
}

function brightenHex(hex: string, amount = 0.2): string {
  const [r, g, b] = parseHex(hex)
  const nr = r + (255 - r) * amount
  const ng = g + (255 - g) * amount
  const nb = b + (255 - b) * amount
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`
}

function finalizeTex(tex: THREE.CanvasTexture): THREE.CanvasTexture {
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

function getHaloTex(hex: string): THREE.CanvasTexture {
  if (_haloTexCache[hex]) return _haloTexCache[hex]
  const sz = 224
  const cv = document.createElement('canvas')
  cv.width = sz
  cv.height = sz
  const ctx = cv.getContext('2d')!
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const grad = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2)
  grad.addColorStop(0,    `rgba(${r},${g},${b},1)`)
  grad.addColorStop(0.12, `rgba(${r},${g},${b},0.58)`)
  grad.addColorStop(0.28, `rgba(${r},${g},${b},0.17)`)
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, sz, sz)
  const tex = finalizeTex(new THREE.CanvasTexture(cv))
  _haloTexCache[hex] = tex
  return tex
}

function getCoreTex(hex: string): THREE.CanvasTexture {
  if (_coreTexCache[hex]) return _coreTexCache[hex]
  const sz = 192
  const cv = document.createElement('canvas')
  cv.width = sz
  cv.height = sz
  const ctx = cv.getContext('2d')!
  const [r, g, b] = parseHex(hex)
  const grad = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2)
  grad.addColorStop(0,    `rgba(${r},${g},${b},1)`)
  grad.addColorStop(0.45, `rgba(${r},${g},${b},1)`)
  grad.addColorStop(0.72, `rgba(${r},${g},${b},0.55)`)
  grad.addColorStop(0.9,  `rgba(${r},${g},${b},0.1)`)
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, sz, sz)
  const tex = finalizeTex(new THREE.CanvasTexture(cv))
  _coreTexCache[hex] = tex
  return tex
}

function getRingTex(hex: string): THREE.CanvasTexture {
  if (_ringTexCache[hex]) return _ringTexCache[hex]
  const sz = 224
  const cv = document.createElement('canvas')
  cv.width = sz
  cv.height = sz
  const ctx = cv.getContext('2d')!
  const [r, g, b] = parseHex(hex)
  const grad = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2)
  grad.addColorStop(0,    `rgba(${r},${g},${b},0)`)
  grad.addColorStop(0.56, `rgba(${r},${g},${b},0)`)
  grad.addColorStop(0.72, `rgba(${r},${g},${b},0.95)`)
  grad.addColorStop(0.84, `rgba(${r},${g},${b},0.5)`)
  grad.addColorStop(0.94, `rgba(${r},${g},${b},0)`)
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, sz, sz)
  const tex = finalizeTex(new THREE.CanvasTexture(cv))
  _ringTexCache[hex] = tex
  return tex
}

// ─── Per-node ref ─────────────────────────────────────────────────────────────

interface NodeRef {
  group:    THREE.Group
  core:     THREE.Sprite
  coreMat:  THREE.SpriteMaterial
  halo:     THREE.Sprite
  haloMat:  THREE.SpriteMaterial
  ring:     THREE.Sprite
  ringMat:  THREE.SpriteMaterial
  baseSize: number
  color:    string
  pulseSeed: number
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Universe3D({ subject, highlightIds, onFindSimilar, onClose }: Universe3DProps) {
  const graphRef  = useRef<any>(null)
  const nodeRefs  = useRef<Map<string, NodeRef>>(new Map())
  const sceneObjs = useRef<THREE.Object3D[]>([])

  const [nodes,    setNodes]    = useState<UniverseNode[]>([])
  const [loading,  setLoading]  = useState(true)
  const [hovered,  setHovered]  = useState<UniverseNode | null>(null)
  const [selected, setSelected] = useState<UniverseNode | null>(null)
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720,
  }))

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── Fetch universe data ───────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/universe')
      .then(r => r.json())
      .then((d: { nodes: UniverseNode[] }) => { setNodes(d.nodes); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // ── Graph data — pin every node at its PCA position ───────────────────────
  const graphData = useMemo(() => ({
    nodes: nodes.map(n => ({ ...n, fx: n.x, fy: n.y, fz: n.z })),
    links: [],
  }), [nodes])

  const tooltipPreview = useCallback((node: UniverseNode) => {
    const text = node.preview_text?.trim() || node.preview.trim()
    return text.length > 120 ? `${text.slice(0, 120).trimEnd()}…` : text
  }, [])

  const panelBody = useCallback((node: UniverseNode) => {
    return node.full_text?.trim() || node.preview.trim()
  }, [])

  // ── Create node sprite group once ─────────────────────────────────────────
  const nodeThreeObject = useCallback((raw: object) => {
    const n = raw as UniverseNode
    const color    = COLORS[n.topic] ?? '#94a3b8'
    const baseSize =
      n.type === 'cs'
        ? (n.difficulty === 'Hard' ? 16 : n.difficulty === 'Medium' ? 11 : 8)
        : 10

    const haloMat = new THREE.SpriteMaterial({
      map:         getHaloTex(color),
      transparent: true,
      opacity:     0.26,
      blending:    THREE.NormalBlending,
      alphaTest:   0.02,
      depthWrite:  false,
    })
    const halo = new THREE.Sprite(haloMat)
    halo.scale.setScalar(baseSize * 1.2)

    const coreMat = new THREE.SpriteMaterial({
      map:         getCoreTex(color),
      transparent: true,
      opacity:     1,
      blending:    THREE.NormalBlending,
      alphaTest:   0.05,
      depthWrite:  false,
    })
    const core = new THREE.Sprite(coreMat)
    core.scale.setScalar(baseSize * 0.34)

    const ringMat = new THREE.SpriteMaterial({
      map:         getRingTex(brightenHex(color, 0.42)),
      transparent: true,
      opacity:     0,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
    })
    const ring = new THREE.Sprite(ringMat)
    ring.visible = false
    ring.scale.setScalar(baseSize * 2.6)

    const group = new THREE.Group()
    group.add(halo)
    group.add(core)
    group.add(ring)

    nodeRefs.current.set(n.id, {
      group, core, coreMat, halo, haloMat, ring, ringMat, baseSize, color, pulseSeed: Math.random() * 1000,
    })
    return group
  }, [])

  // ── Highlight / selection effect ──────────────────────────────────────────
  useEffect(() => {
    const hasSearch = highlightIds.size > 0
    const selectedId = selected?.id

    nodeRefs.current.forEach(({ core, coreMat, halo, haloMat, ring, ringMat, baseSize, color }, id) => {
      const isSearchHit = highlightIds.has(id)
      const isSelected = selectedId === id

      let baseColor = color
      let coreOpacity = 1
      let haloOpacity = 0.26
      let coreScale = baseSize * 0.34
      let haloScale = baseSize * 1.2
      let ringVisible = false
      let ringScale = baseSize * 2.6
      let ringOpacity = 0.55

      if (hasSearch) {
        if (isSearchHit) {
          baseColor = brightenHex(color, 0.12)
          coreOpacity = 1
          haloOpacity = 0.4
          coreScale *= 1.1
          haloScale *= 1.2
        } else {
          coreOpacity = 0.25
          haloOpacity = 0.04
        }
      }

      if (selectedId) {
        if (isSelected) {
          baseColor = brightenHex(color, 0.28)
          coreOpacity = 1
          haloOpacity = 0.58
          coreScale = baseSize * 0.95
          haloScale = baseSize * 2.2
          ringVisible = true
          ringScale = baseSize * 2.6
          ringOpacity = 0.62
        } else {
          coreOpacity *= 0.28
          haloOpacity *= 0.22
          coreScale *= 0.9
          haloScale *= 0.9
        }
      }

      coreMat.map = getCoreTex(baseColor)
      haloMat.map = getHaloTex(baseColor)
      ringMat.map = getRingTex(brightenHex(baseColor, 0.3))

      coreMat.opacity = coreOpacity
      haloMat.opacity = haloOpacity
      ringMat.opacity = ringVisible ? ringOpacity : 0
      coreMat.needsUpdate = true
      haloMat.needsUpdate = true
      ringMat.needsUpdate = true

      core.scale.setScalar(coreScale)
      halo.scale.setScalar(haloScale)
      ring.visible = ringVisible
      ring.scale.setScalar(ringScale)
    })
  }, [highlightIds, selected])

  // ── Selected-ring pulse ────────────────────────────────────────────────────
  useEffect(() => {
    if (!selected) return
    let raf = 0

    const animate = () => {
      const t = performance.now() * 0.004
      nodeRefs.current.forEach((ref, id) => {
        if (id !== selected.id || !ref.ring.visible) return
        const pulse = 1 + 0.12 * Math.sin(t + ref.pulseSeed)
        ref.ring.scale.setScalar(ref.baseSize * 2.6 * pulse)
        ref.ringMat.opacity = 0.46 + 0.12 * Math.sin(t * 1.3 + ref.pulseSeed)
      })
      raf = requestAnimationFrame(animate)
    }

    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [selected])

  // ── Scene setup: stars, nebulas, divider ─────────────────────────────────
  useEffect(() => {
    if (loading || !graphRef.current) return
    const scene  = graphRef.current.scene() as THREE.Scene
    const extras: THREE.Object3D[] = []

    // Fog (lighter, so node colors stay crisp)
    scene.fog = new THREE.FogExp2(0x000814, 0.00016)

    // Stars
    const STAR_N  = 5000
    const starPos = new Float32Array(STAR_N * 3)
    for (let i = 0; i < STAR_N * 3; i++) starPos[i] = (Math.random() - 0.5) * 5000
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
    const stars = new THREE.Points(starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0.54 }))
    scene.add(stars); extras.push(stars)

    // Topic nebulas
    const centroids: Record<string, { x: number; y: number; z: number; n: number }> = {}
    nodes.forEach(nd => {
      if (!centroids[nd.topic]) centroids[nd.topic] = { x: 0, y: 0, z: 0, n: 0 }
      centroids[nd.topic].x += nd.x; centroids[nd.topic].y += nd.y
      centroids[nd.topic].z += nd.z; centroids[nd.topic].n++
    })
    Object.entries(centroids).forEach(([topic, c]) => {
      const hex    = COLORS[topic] ?? '#888888'
      const nebula = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getHaloTex(hex), transparent: true, opacity: 0.012,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }))
      nebula.position.set(c.x / c.n, c.y / c.n, c.z / c.n)
      nebula.scale.setScalar(220)
      scene.add(nebula); extras.push(nebula)
    })

    // Galaxy-arm divider dust
    const DIV_N  = 600
    const divPos = new Float32Array(DIV_N * 3)
    for (let i = 0; i < DIV_N; i++) {
      divPos[i * 3]     = (Math.random() - 0.5) * 40
      divPos[i * 3 + 1] = (Math.random() - 0.5) * 700
      divPos[i * 3 + 2] = (Math.random() - 0.5) * 700
    }
    const divGeo = new THREE.BufferGeometry()
    divGeo.setAttribute('position', new THREE.BufferAttribute(divPos, 3))
    const divider = new THREE.Points(divGeo,
      new THREE.PointsMaterial({ color: 0x4466aa, size: 0.9, transparent: true, opacity: 0.05 }))
    scene.add(divider); extras.push(divider)

    sceneObjs.current = extras

    // Warp-in intro
    graphRef.current.cameraPosition({ x: 0, y: 0, z: 2800 }, { x: 0, y: 0, z: 0 }, 0)
    setTimeout(() => {
      graphRef.current?.cameraPosition({ x: 0, y: 80, z: 700 }, { x: 0, y: 0, z: 0 }, 2200)
    }, 80)

    return () => {
      extras.forEach(obj => {
        scene.remove(obj)
        if ('geometry' in obj) (obj as THREE.Points).geometry?.dispose()
        if ('material' in obj) {
          const m = (obj as THREE.Mesh).material
          Array.isArray(m) ? m.forEach(x => x.dispose()) : (m as THREE.Material).dispose()
        }
      })
      scene.fog = null
    }
  }, [loading, nodes])

  // ── Fly camera to search results ──────────────────────────────────────────
  useEffect(() => {
    if (!graphRef.current || highlightIds.size === 0 || nodes.length === 0) return
    const matched = nodes.filter(n => highlightIds.has(n.id))
    if (matched.length === 0) return
    const cx = matched.reduce((s, n) => s + n.x, 0) / matched.length
    const cy = matched.reduce((s, n) => s + n.y, 0) / matched.length
    const cz = matched.reduce((s, n) => s + n.z, 0) / matched.length
    graphRef.current.cameraPosition(
      { x: cx, y: cy + 25, z: cz + 260 },
      { x: cx, y: cy,      z: cz },
      1400,
    )
  }, [highlightIds, nodes])

  const handleNodeClick = useCallback((raw: object) => {
    const node = raw as UniverseNode
    setSelected(prev => {
      const next = prev?.id === node.id ? null : node
      if (next && graphRef.current) {
        graphRef.current.cameraPosition(
          { x: next.x, y: next.y + 20, z: next.z + 220 },
          { x: next.x, y: next.y,      z: next.z },
          900,
        )
      }
      return next
    })
  }, [])
  const handleNodeHover = useCallback((raw: object | null) => {
    setHovered(raw ? raw as UniverseNode : null)
    document.body.style.cursor = raw ? 'pointer' : 'default'
  }, [])

  useEffect(() => {
    return () => { document.body.style.cursor = 'default' }
  }, [])

  // ─── Render ───────────────────────────────────────────────────────────────
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

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="uni-topbar">
        <div className="uni-topbar-left">
          <span className="uni-brand">◉ Problem Multiverse</span>
          <span className="uni-stats">{mathCount} math · {csCount} cs · {nodes.length} total</span>
        </div>
        <div className="uni-topbar-right">
          <span className="uni-hint">Drag to orbit · Scroll to zoom · Click a node</span>
          <button className="uni-close-btn" onClick={onClose}>✕ Exit</button>
        </div>
      </div>

      {/* ── Galaxy arm labels ────────────────────────────────────────────── */}
      <div className="uni-arm-label uni-arm-left">⟵ MATHEMATICS</div>
      <div className="uni-arm-label uni-arm-right">COMPUTER SCIENCE ⟶</div>

      {/* ── Legend ──────────────────────────────────────────────────────── */}
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

      {/* ── Search result badge ──────────────────────────────────────────── */}
      {highlightIds.size > 0 && (
        <div className="uni-search-badge">
          ✦ {highlightIds.size} {subject === 'math' ? 'math' : 'CS'} problems matched
        </div>
      )}

      {/* ── Hover tooltip ───────────────────────────────────────────────── */}
      {hovered && !selected && (
        <div className="uni-tooltip">
          <div className="uni-tt-type" style={{ color: COLORS[hovered.topic] }}>
            {hovered.type === 'math' ? '∑ Math' : '{ } CS'} · {hovered.topic.replace('_', ' ')}
          </div>
          <div className="uni-tt-title">
            {hovered.title ?? `Problem #${hovered.problem_id}`}
          </div>
          <div className="uni-tt-preview">
            <TextRenderer text={tooltipPreview(hovered)} />
          </div>
          {hovered.difficulty && (
            <span className={`uni-tt-diff diff-${hovered.difficulty.toLowerCase()}`}>
              {hovered.difficulty}
            </span>
          )}
          <div className="uni-tt-cta">Click to open →</div>
        </div>
      )}

      {/* ── Selected node panel ─────────────────────────────────────────── */}
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
            <span className={`uni-panel-diff diff-${selected.difficulty.toLowerCase()}`}>
              {selected.difficulty}
            </span>
          )}
          <div className="uni-panel-preview">
            {selected.type === 'math' ? (
              <MathRenderer text={panelBody(selected)} />
            ) : (
              <TextRenderer text={panelBody(selected)} />
            )}
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

      {/* ── 3-D Canvas ──────────────────────────────────────────────────── */}
      <ForceGraph3D
        ref={graphRef}
        graphData={graphData}
        backgroundColor="#000814"
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        enableNodeDrag={false}
        cooldownTicks={0}
        d3AlphaMin={1}
        showNavInfo={false}
        width={viewport.width}
        height={viewport.height}
        nodeLabel=""
      />
    </div>
  )
}
