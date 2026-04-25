import { useState, useEffect, useRef } from 'react'
import './App.css'
import { Icon } from './icons'
import Chat from './Chat'
import MathRenderer from './MathRenderer'
import TextRenderer from './TextRenderer'
import type { SearchResult, Subject, SvdDim, MathSearchResult, LeetcodeSearchResult } from './types'

// ════════════════════════════════════════════════════════
// Similarity ring
// ════════════════════════════════════════════════════════

function SimRing({ score }: { score: number }): JSX.Element {
  const pct = Math.max(0, Math.min(1, score))
  const r = 9
  const c = 2 * Math.PI * r
  const color = score >= 0.75 ? '#059669' : score >= 0.55 ? '#f59e0b' : '#a78bfa'
  return (
    <svg className="sim-ring" viewBox="0 0 22 22">
      <circle cx="11" cy="11" r={r} fill="none" stroke="#e7f0eb" strokeWidth="3" />
      <circle
        cx="11" cy="11" r={r}
        fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={`${c * pct} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 11 11)"
      />
    </svg>
  )
}

// ════════════════════════════════════════════════════════
// Explain streaming helper
// ════════════════════════════════════════════════════════

async function streamExplain(
  problemId: number,
  subject: Subject,
  mode: 'hint' | 'walkthrough',
  onStart: () => void,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  onStart()
  try {
    const response = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem_id: problemId, subject, mode }),
    })
    if (!response.ok) {
      const data = await response.json() as Record<string, unknown>
      onError(String(data.error ?? response.status))
      return
    }
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const parsed = JSON.parse(line.slice(6)) as Record<string, unknown>
          if (typeof parsed.content === 'string') onChunk(parsed.content)
          if (typeof parsed.error === 'string') onError(parsed.error)
        } catch { /* ignore */ }
      }
    }
    onDone()
  } catch {
    onError('Something went wrong. Please try again.')
  }
}

// ════════════════════════════════════════════════════════
// WhyMatched
// ════════════════════════════════════════════════════════

function WhyMatched({ dims }: { dims: SvdDim[] | undefined }): JSX.Element | null {
  if (!dims || dims.length === 0) return null
  const pos = dims.filter(d => d.activation >= 0)
  const neg = dims.filter(d => d.activation < 0)
  if (pos.length === 0 && neg.length === 0) return null
  return (
    <details className="why-match">
      <summary>🔍 Why this matched in SVD</summary>
      <div className="why-box">
        {pos.length > 0 && (
          <div className="why-group">
            <div className="why-group-label pos">▲ Positive dimensions</div>
            <div className="why-dims">
              {pos.map(d => (
                <span key={d.dim} className="why-dim pos">
                  <small>Dim {d.dim} · +{d.activation.toFixed(2)} </small>
                  {d.label}
                </span>
              ))}
            </div>
          </div>
        )}
        {neg.length > 0 && (
          <div className="why-group">
            <div className="why-group-label neg">▼ Negative dimensions</div>
            <div className="why-dims">
              {neg.map(d => (
                <span key={d.dim} className="why-dim neg">
                  <small>Dim {d.dim} · {d.activation.toFixed(2)} </small>
                  {d.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  )
}

// ════════════════════════════════════════════════════════
// MathCard
// ════════════════════════════════════════════════════════

interface MathCardProps {
  p: MathSearchResult
  subject: Subject
  practiceMode: boolean
  useLlm: boolean
}

function MathCard({ p, subject, practiceMode, useLlm }: MathCardProps): JSX.Element {
  const [revealed, setRevealed] = useState(false)
  const [explainMode, setExplainMode] = useState<'hint' | 'walkthrough' | null>(null)
  const [explainText, setExplainText] = useState('')
  const [explainLoading, setExplainLoading] = useState(false)

  const handleExplain = (mode: 'hint' | 'walkthrough'): void => {
    if (explainMode === mode) {
      setExplainMode(null)
      setExplainText('')
      return
    }
    setExplainMode(mode)
    setExplainText('')
    void streamExplain(
      p.problem_id, subject, mode,
      () => setExplainLoading(true),
      (text) => { setExplainText(prev => prev + text); setExplainLoading(false) },
      () => setExplainLoading(false),
      (err) => { setExplainText('Error: ' + err); setExplainLoading(false) }
    )
  }

  return (
    <article className="card">
      <div className="card-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <div className="card-id">
            <span className="id-badge">#{String(p.problem_id).padStart(3, '0')}</span>
            <div className="sim-meter">
              <SimRing score={p.similarity_score} />
              <span>
                {Number.isFinite(p.similarity_score)
                  ? `${(p.similarity_score * 100).toFixed(0)}% match`
                  : '—'}
              </span>
            </div>
          </div>
          <h3 className="card-title">Problem #{p.problem_id}</h3>
        </div>
      </div>

      <div className="prob-body">
        <MathRenderer text={p.problem_raw} />
      </div>

      <div className="card-foot">
        {!revealed ? (
          <button className="btn primary" onClick={() => setRevealed(true)}>
            <Icon name="eye" size={15} />
            {practiceMode ? "I've tried — check answer" : 'Reveal answer'}
          </button>
        ) : (
          <button className="btn ghost" onClick={() => setRevealed(false)}>
            <Icon name="x" size={15} /> Hide answer
          </button>
        )}
        {useLlm && (
          <>
            <button
              className={`btn ghost ${explainMode === 'hint' ? 'active' : ''}`}
              onClick={() => handleExplain('hint')}
            >
              <span className="emoji">💡</span>
              {explainMode === 'hint' ? 'Hide hint' : 'Give me a hint'}
            </button>
            <button
              className={`btn ghost ${explainMode === 'walkthrough' ? 'active' : ''}`}
              onClick={() => handleExplain('walkthrough')}
            >
              <span className="emoji">✨</span>
              {explainMode === 'walkthrough' ? 'Hide' : 'Full walkthrough'}
            </button>
          </>
        )}
      </div>

      {revealed && (
        <div className="answer-block">
          <div className="answer-label">Answer</div>
          <div className="answer-value">
            <MathRenderer text={p.answer} />
          </div>
        </div>
      )}

      {explainMode && (
        <div className={`hint-chain ${explainMode === 'walkthrough' ? 'walkthrough' : ''}`}>
          <div className="hint-head">
            <span>{explainMode === 'hint' ? '💡 Hint' : '✨ Walkthrough'}</span>
            <button
              className="concepts-toggle"
              onClick={() => { setExplainMode(null); setExplainText('') }}
            >
              Close
            </button>
          </div>
          {explainLoading && !explainText && (
            <div className="msg-thinking"><span /><span /><span /></div>
          )}
          {explainText && (
            <div className="hint-steps">
              <div className="hint-step">{explainText}</div>
            </div>
          )}
        </div>
      )}

      <WhyMatched dims={p.top_dims} />
    </article>
  )
}

// ════════════════════════════════════════════════════════
// CSCard
// ════════════════════════════════════════════════════════

interface CSCardProps {
  p: LeetcodeSearchResult
  subject: Subject
  useLlm: boolean
}

function CSCard({ p, subject, useLlm }: CSCardProps): JSX.Element {
  const [explainMode, setExplainMode] = useState<'hint' | 'walkthrough' | null>(null)
  const [explainText, setExplainText] = useState('')
  const [explainLoading, setExplainLoading] = useState(false)

  const companies = Array.isArray(p.companies)
    ? p.companies.filter((c): c is string => typeof c === 'string')
    : []
  const topics = Array.isArray(p.related_topics)
    ? p.related_topics.filter((t): t is string => typeof t === 'string')
    : []

  const diffText = typeof p.difficulty === 'number' ? String(p.difficulty) : p.difficulty
  const diffCls = diffText === 'Easy' ? 'easy' : diffText === 'Medium' ? 'med' : diffText === 'Hard' ? 'hard' : ''

  const acceptanceNum = typeof p.acceptance_rate === 'number'
    ? (p.acceptance_rate <= 1 ? p.acceptance_rate * 100 : p.acceptance_rate)
    : parseFloat(String(p.acceptance_rate))
  const acceptanceText = Number.isFinite(acceptanceNum) ? `${acceptanceNum.toFixed(1)}%` : String(p.acceptance_rate)

  const handleExplain = (mode: 'hint' | 'walkthrough'): void => {
    if (explainMode === mode) {
      setExplainMode(null)
      setExplainText('')
      return
    }
    setExplainMode(mode)
    setExplainText('')
    void streamExplain(
      p.problem_id, subject, mode,
      () => setExplainLoading(true),
      (text) => { setExplainText(prev => prev + text); setExplainLoading(false) },
      () => setExplainLoading(false),
      (err) => { setExplainText('Error: ' + err); setExplainLoading(false) }
    )
  }

  return (
    <article className="card">
      <div className="card-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <div className="card-id">
            <span className="id-badge">LC #{p.problem_id}</span>
            {diffCls && (
              <span className={`diff-badge ${diffCls}`}>
                <span className="diff-dot" />{diffText}
              </span>
            )}
            <div className="sim-meter">
              <SimRing score={p.similarity_score} />
              <span>
                {Number.isFinite(p.similarity_score)
                  ? `${(p.similarity_score * 100).toFixed(0)}% match`
                  : '—'}
              </span>
            </div>
          </div>
          <h3 className="card-title">{p.title ?? `Problem #${p.problem_id}`}</h3>
        </div>
      </div>

      {(Number.isFinite(acceptanceNum) || companies.length > 0) && (
        <div className="cs-meta">
          {Number.isFinite(acceptanceNum) && (
            <span>✅ <b>{acceptanceText}</b> acceptance</span>
          )}
          {companies.length > 0 && (
            <span>
              🏢 <b>
                {companies.slice(0, 3).join(', ')}
                {companies.length > 3 ? ` +${companies.length - 3}` : ''}
              </b>
            </span>
          )}
        </div>
      )}

      {topics.length > 0 && (
        <div className="topic-row">
          {topics.slice(0, 8).map(t => (
            <span key={t} className="topic-chip">{t}</span>
          ))}
        </div>
      )}

      <div className="prob-body">
        <TextRenderer text={p.description ?? ''} />
      </div>

      <div className="card-foot">
        {p.url && (
          <a className="btn primary" href={p.url} target="_blank" rel="noreferrer">
            <Icon name="arrow" size={15} /> Open on LeetCode
          </a>
        )}
        {useLlm && (
          <>
            <button
              className={`btn ghost ${explainMode === 'hint' ? 'active' : ''}`}
              onClick={() => handleExplain('hint')}
            >
              <span className="emoji">💡</span>
              {explainMode === 'hint' ? 'Hide hint' : 'Give me a hint'}
            </button>
            <button
              className={`btn ghost ${explainMode === 'walkthrough' ? 'active' : ''}`}
              onClick={() => handleExplain('walkthrough')}
            >
              <span className="emoji">✨</span>
              {explainMode === 'walkthrough' ? 'Hide' : 'Walkthrough'}
            </button>
          </>
        )}
      </div>

      {explainMode && (
        <div className={`hint-chain ${explainMode === 'walkthrough' ? 'walkthrough' : ''}`}>
          <div className="hint-head">
            <span>{explainMode === 'hint' ? '💡 Hint' : '✨ Walkthrough'}</span>
            <button
              className="concepts-toggle"
              onClick={() => { setExplainMode(null); setExplainText('') }}
            >
              Close
            </button>
          </div>
          {explainLoading && !explainText && (
            <div className="msg-thinking"><span /><span /><span /></div>
          )}
          {explainText && (
            <div className="hint-steps">
              <div className="hint-step">{explainText}</div>
            </div>
          )}
        </div>
      )}

      <WhyMatched dims={p.top_dims} />
    </article>
  )
}

// ════════════════════════════════════════════════════════
// Concepts (SVD panel)
// ════════════════════════════════════════════════════════

function Concepts({ dims }: { dims: SvdDim[] }): JSX.Element {
  const [open, setOpen] = useState(true)
  const max = Math.max(...dims.map(d => Math.abs(d.activation)), 0.001)

  return (
    <section className="concepts">
      <div className="concepts-head">
        <div className="concepts-title">
          <span className="dot-g" />
          <span>Semantic concepts in your query</span>
        </div>
        <button className="concepts-toggle" onClick={() => setOpen(o => !o)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && (
        <div className="concept-rows">
          {dims.map(d => {
            const w = (Math.abs(d.activation) / max) * 45
            const neg = d.activation < 0
            return (
              <div key={d.dim} className="concept-row">
                <div className="concept-label">{d.label}</div>
                <div className="concept-bar">
                  <div className="concept-center" />
                  <div
                    className={`fill ${neg ? 'neg' : ''}`}
                    style={{ left: neg ? `${50 - w}%` : '50%', width: `${w}%` }}
                  />
                </div>
                <div className="concept-score">
                  {d.activation >= 0 ? '+' : ''}{d.activation.toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ════════════════════════════════════════════════════════
// Tweaks
// ════════════════════════════════════════════════════════

const PALETTES = {
  emerald: { accent: '#059669', accentInk: '#064e3b', accentSoft: '#d1f0e2', paper: '#f4f9f6', paper2: '#eaf3ee', line: '#d8e7df', line2: '#e7f0eb' },
  apricot: { accent: '#f59e0b', accentInk: '#78350f', accentSoft: '#fef3c7', paper: '#fdf9f3', paper2: '#f7eedf', line: '#ead9bd', line2: '#f4e7cf' },
  sky: { accent: '#0284c7', accentInk: '#0c4a6e', accentSoft: '#e0f2fe', paper: '#f4f9fd', paper2: '#e7f1fa', line: '#cfe2f1', line2: '#e0edf7' },
  rose: { accent: '#e11d48', accentInk: '#881337', accentSoft: '#ffe4e6', paper: '#fdf6f7', paper2: '#fae9ec', line: '#ecd1d6', line2: '#f6e0e4' },
} as const

type AccentKey = keyof typeof PALETTES

interface Tweaks {
  accent: AccentKey
  density: 'cozy' | 'compact'
  mascot: boolean
  practiceMode: boolean
}

// ════════════════════════════════════════════════════════
// App
// ════════════════════════════════════════════════════════

function App(): JSX.Element {
  const [useLlm, setUseLlm] = useState<boolean | null>(null)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [subject, setSubject] = useState<Subject>('math')
  const [results, setResults] = useState<SearchResult[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [belowThreshold, setBelowThreshold] = useState<boolean>(false)
  const [hasSearched, setHasSearched] = useState<boolean>(false)
  const [queryTopDims, setQueryTopDims] = useState<SvdDim[]>([])
  const [synthesis, setSynthesis] = useState<{ irQuery: string; answerText: string; loading: boolean } | null>(null)
  const [retrievalMode, setRetrievalMode] = useState<'svd' | 'tfidf' | 'bert'>('bert')
  const [tweaks, setTweaks] = useState<Tweaks>({ accent: 'emerald', density: 'cozy', mascot: true, practiceMode: false })
  const [tweaksOpen, setTweaksOpen] = useState<boolean>(false)

  const latestRequestId = useRef<number>(0)
  const latestSynthesisId = useRef<number>(0)

  useEffect(() => {
    const p = PALETTES[tweaks.accent]
    const root = document.documentElement
    root.style.setProperty('--accent', p.accent)
    root.style.setProperty('--accent-ink', p.accentInk)
    root.style.setProperty('--accent-soft', p.accentSoft)
    root.style.setProperty('--paper', p.paper)
    root.style.setProperty('--paper-2', p.paper2)
    root.style.setProperty('--line', p.line)
    root.style.setProperty('--line-2', p.line2)
  }, [tweaks.accent])

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(data => setUseLlm((data as { use_llm: boolean }).use_llm))
  }, [])

  const runSearch = async (value: string, subj: Subject, mode?: 'svd' | 'tfidf' | 'bert'): Promise<SearchResult[]> => {
    const requestId = latestRequestId.current + 1
    latestRequestId.current = requestId

    setLoading(true)
    setError(null)
    setMessage(null)
    setBelowThreshold(false)
    setQueryTopDims([])
    setSynthesis(null)

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subj, query: value, top_k: 20, retrieval_mode: mode ?? retrievalMode }),
      })

      const data = await response.json() as Record<string, unknown>
      if (latestRequestId.current !== requestId) return []

      if (!response.ok) {
        setError(String(data?.error ?? data?.message ?? `Search failed (${response.status})`))
        setResults([])
        setQueryTopDims([])
        return []
      }

      const fetched = Array.isArray(data?.results) ? data.results as SearchResult[] : []
      setResults(fetched)
      setBelowThreshold(data?.below_threshold === true)
      setQueryTopDims(Array.isArray(data?.query_top_dims) ? data.query_top_dims as SvdDim[] : [])
      if (typeof data?.message === 'string' && (data.message as string).trim() !== '') {
        setMessage(data.message as string)
      }
      return fetched
    } catch {
      setError('Something went wrong. Please try again.')
      setResults([])
      setQueryTopDims([])
      return []
    } finally {
      if (latestRequestId.current === requestId) setLoading(false)
    }
  }

  const runSynthesis = async (_context: SearchResult[], query: string, subj: Subject): Promise<void> => {
    const synthId = latestSynthesisId.current + 1
    latestSynthesisId.current = synthId
    setSynthesis({ irQuery: '', answerText: '', loading: true })

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, subject: subj }),
      })

      if (!response.ok || latestSynthesisId.current !== synthId) return

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value: chunk } = await reader.read()
        if (done || latestSynthesisId.current !== synthId) break
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as Record<string, unknown>
            if (typeof data.ir_query === 'string') {
              setSynthesis(prev => prev ? { ...prev, irQuery: data.ir_query as string } : null)
            }
            if (typeof data.content === 'string') {
              setSynthesis(prev => prev ? { ...prev, loading: false, answerText: prev.answerText + data.content } : null)
            }
          } catch { /* ignore */ }
        }
      }
      setSynthesis(prev => prev ? { ...prev, loading: false } : null)
    } catch {
      setSynthesis(null)
    }
  }

  const handleInputChange = (value: string): void => {
    setSearchTerm(value)
    if (value.trim() === '') {
      setResults([])
      setQueryTopDims([])
      setMessage(null)
      setError(null)
      setBelowThreshold(false)
      setHasSearched(false)
      setSynthesis(null)
    }
  }

  const handleSubmit = (): void => {
    const trimmed = searchTerm.trim()
    if (trimmed === '') return
    setHasSearched(true)
    void (async () => {
      const fetched = await runSearch(trimmed, subject)
      if (useLlm && fetched.length > 0) {
        void runSynthesis(fetched, trimmed, subject)
      }
    })()
  }

  const handleSubjectChange = (next: Subject): void => {
    setSubject(next)
    setSearchTerm('')
    setResults([])
    setQueryTopDims([])
    setMessage(null)
    setError(null)
    setBelowThreshold(false)
    setHasSearched(false)
    setSynthesis(null)
  }

  const handleRetrievalModeChange = (next: 'svd' | 'tfidf' | 'bert'): void => {
    setRetrievalMode(next)
    const trimmed = searchTerm.trim()
    if (trimmed !== '' && hasSearched) {
      setHasSearched(true)
      void (async () => {
        const fetched = await runSearch(trimmed, subject, next)
        if (useLlm && fetched.length > 0) void runSynthesis(fetched, trimmed, subject)
      })()
    }
  }

  const updateTweak = <K extends keyof Tweaks>(key: K, val: Tweaks[K]): void => {
    setTweaks(prev => ({ ...prev, [key]: val }))
  }

  if (useLlm === null) return <></>

  return (
    <div className={`app${tweaks.density === 'compact' ? ' compact' : ''}${useLlm ? ' llm-mode' : ''}`}>
      <main className="main">
        <div className="top-brand">
          <div className="top-brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20c0-5 3-8 8-10-5-1-8 2-10 5" />
              <path d="M12 20c0-5-3-8-8-10 5-1 8 2 10 5" />
              <path d="M12 20V10" />
            </svg>
          </div>
          <div className="top-brand-name">Studdy<em>Buddy</em></div>
        </div>

        <header className="main-head" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="main-greeting">
              Find your next <em>challenge</em>
            </div>
            <div className="main-sub">
              {subject === 'math' ? 'AIME-style · 4,500+ problems' : 'LeetCode · 2,400+ problems'}
            </div>
          </div>
        </header>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="subject-swap" role="tablist">
            <button
              className={`subject-btn ${subject === 'math' ? 'active' : ''}`}
              onClick={() => handleSubjectChange('math')}
            >
              <span className="emoji">∑</span> Math
            </button>
            <button
              className={`subject-btn ${subject === 'cs' ? 'active' : ''}`}
              onClick={() => handleSubjectChange('cs')}
            >
              <span className="emoji">{'{}'}</span> CS
            </button>
          </div>
          <div className="subject-swap" role="tablist" aria-label="Retrieval mode">
            <button
              className={`subject-btn ${retrievalMode === 'bert' ? 'active' : ''}`}
              onClick={() => handleRetrievalModeChange('bert')}
              title="BERT — deep semantic search, understands meaning and synonyms"
            >
              BERT
            </button>
            <button
              className={`subject-btn ${retrievalMode === 'svd' ? 'active' : ''}`}
              onClick={() => handleRetrievalModeChange('svd')}
              title="SVD (Latent Semantic Analysis) — topic-level semantic matching"
            >
              SVD
            </button>
            <button
              className={`subject-btn ${retrievalMode === 'tfidf' ? 'active' : ''}`}
              onClick={() => handleRetrievalModeChange('tfidf')}
              title="TF-IDF — exact keyword matching"
            >
              TF-IDF
            </button>
          </div>
          {useLlm && (
            <button
              className="chip"
              style={tweaks.practiceMode
                ? { background: 'var(--apricot)', borderColor: '#b45309', color: '#fff' }
                : {}}
              onClick={() => updateTweak('practiceMode', !tweaks.practiceMode)}
            >
              🎯 Practice mode {tweaks.practiceMode ? 'on' : 'off'}
            </button>
          )}
        </div>

        <div className="search-wrap">
          <div className="search-box">
            <span className="icon"><Icon name="search" size={20} /></span>
            <input
              id="search-input"
              value={searchTerm}
              onChange={e => handleInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
              placeholder={subject === 'math'
                ? "Paste a math problem or describe what you're stuck on…"
                : "Paste a CS problem or describe the pattern you want to learn…"}
            />
            <button
              className="search-submit"
              onClick={handleSubmit}
              disabled={!searchTerm.trim() || loading}
              aria-label="Search"
            >
              <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>

        <div className="hint-text">
          {subject === 'math'
            ? 'Tip: paste the full statement (with LaTeX) or a short concept like "circle tangency geometry". Press Enter to search.'
            : 'Tip: paste a CS problem statement or keywords like "shortest path with constraints". Press Enter to search.'}
        </div>

        {!loading && queryTopDims.length > 0 && results.length > 0 && (
          <Concepts dims={queryTopDims} />
        )}

        {!loading && !error && results.length > 0 && (
          <div className="results-head">
            <div className="results-count">
              <b>{results.length}</b> similar problems found
            </div>
          </div>
        )}

        {error && <div className="notice error">{error}</div>}
        {!error && message && <div className="notice">{message}</div>}

        {loading && (
          <div className="empty">
            <div className="msg-thinking" style={{ justifyContent: 'center', marginBottom: 10 }}>
              <span /><span /><span />
            </div>
            <div>Searching for similar problems…</div>
          </div>
        )}

        {!loading && !error && results.length === 0 && hasSearched && (
          <div className="empty">
            <div className="empty-big">
              {belowThreshold ? 'Nothing matched closely enough 🌱' : 'No problems found'}
            </div>
            <div>
              {belowThreshold
                ? 'Try rephrasing or using more specific terms.'
                : 'Try a different query.'}
            </div>
          </div>
        )}

        {useLlm && synthesis && (
          <section className="synthesis-section">
            <div className="synthesis-head">
              <span className="dot-g" /> AI Overview
              {synthesis.irQuery && (
                <span className="synthesis-query-pill">Modified query: <em>{synthesis.irQuery}</em></span>
              )}
            </div>
            {synthesis.loading && !synthesis.answerText && (
              <div className="msg-thinking" style={{ marginTop: 8 }}>
                <span /><span /><span />
              </div>
            )}
            {synthesis.answerText && (
              <p className="synthesis-text">{synthesis.answerText}</p>
            )}
          </section>
        )}

        {!loading && searchTerm.trim() === '' && (
          <div className="empty">
            <div className="empty-big">Start with a problem or concept ✦</div>
            <div>Paste any practice problem, or describe a topic you want to explore. Press Enter or → to search.</div>
          </div>
        )}

        {results.map(problem => {
          if (subject === 'math' && 'problem_raw' in problem) {
            return (
              <MathCard
                key={problem.problem_id}
                p={problem}
                subject={subject}
                practiceMode={tweaks.practiceMode}
                useLlm={useLlm}
              />
            )
          }
          if (subject === 'cs' && 'title' in problem) {
            return (
              <CSCard
                key={problem.problem_id}
                p={problem}
                subject={subject}
                useLlm={useLlm}
              />
            )
          }
          return null
        })}
      </main>

      {useLlm && <Chat subject={subject} context={results} />}

      {tweaksOpen ? (
        <div className="tweaks">
          <div className="tweaks-title">
            <span>🎨 Tweaks</span>
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              onClick={() => setTweaksOpen(false)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>

          <div className="tweak">
            <div className="tweak-label">Accent color</div>
            <div className="swatches">
              {(
                [['emerald', '#059669'], ['apricot', '#f59e0b'], ['sky', '#0284c7'], ['rose', '#e11d48']] as [AccentKey, string][]
              ).map(([k, c]) => (
                <button
                  key={k}
                  className={`swatch ${tweaks.accent === k ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => updateTweak('accent', k)}
                  title={k}
                />
              ))}
            </div>
          </div>

          <div className="tweak">
            <div className="tweak-label">Density</div>
            <div className="segmented">
              <button className={tweaks.density === 'cozy' ? 'on' : ''} onClick={() => updateTweak('density', 'cozy')}>Cozy</button>
              <button className={tweaks.density === 'compact' ? 'on' : ''} onClick={() => updateTweak('density', 'compact')}>Compact</button>
            </div>
          </div>

          <div className="tweak">
            <div className="tweak-label">Mascot</div>
            <div className="segmented">
              <button className={tweaks.mascot ? 'on' : ''} onClick={() => updateTweak('mascot', true)}>On</button>
              <button className={!tweaks.mascot ? 'on' : ''} onClick={() => updateTweak('mascot', false)}>Off</button>
            </div>
          </div>

          <div className="tweak">
            <div className="tweak-label">Practice mode default</div>
            <div className="segmented">
              <button className={tweaks.practiceMode ? 'on' : ''} onClick={() => updateTweak('practiceMode', true)}>On</button>
              <button className={!tweaks.practiceMode ? 'on' : ''} onClick={() => updateTweak('practiceMode', false)}>Off</button>
            </div>
          </div>
        </div>
      ) : (
        <button
          className="tweaks-closed"
          onClick={() => setTweaksOpen(true)}
          title="Tweaks"
        >
          <Icon name="tune" size={20} />
        </button>
      )}
    </div>
  )
}

export default App
