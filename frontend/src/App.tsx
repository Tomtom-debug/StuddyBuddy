import { useState, useEffect, useRef } from 'react'
import './App.css'
import SearchIcon from './assets/mag.png'
import Chat from './Chat'
import MathRenderer from './MathRenderer'
import TextRenderer from './TextRenderer'
import type { SearchResult, Subject, SvdDim } from './types'

function App(): JSX.Element {
  const [useLlm, setUseLlm] = useState<boolean | null>(null)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [subject, setSubject] = useState<Subject>('math')
  const [results, setResults] = useState<SearchResult[]>([])
  const [revealedAnswers, setRevealedAnswers] = useState<Set<number>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [queryTopDims, setQueryTopDims] = useState<SvdDim[]>([])
  const latestRequestId = useRef<number>(0)

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(data => setUseLlm(data.use_llm))
  }, [])

  const runSearch = async (value: string, subj: Subject): Promise<void> => {
    const requestId = latestRequestId.current + 1
    latestRequestId.current = requestId

    setLoading(true)
    setError(null)
    setMessage(null)
    setRevealedAnswers(new Set())
    setQueryTopDims([])

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subj,
          query: value,
          top_k: 5,
        }),
      })

      const data = await response.json()

      if (latestRequestId.current !== requestId) return

      if (!response.ok) {
        setError(data?.error || data?.message || `Search failed (${response.status})`)
        setResults([])
        setQueryTopDims([])
        return
      }

      setResults(Array.isArray(data?.results) ? (data.results as SearchResult[]) : [])
      setQueryTopDims(Array.isArray(data?.query_top_dims) ? (data.query_top_dims as SvdDim[]) : [])
      if (typeof data?.message === 'string' && data.message.trim() !== '') {
        setMessage(data.message)
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setResults([])
      setQueryTopDims([])
    } finally {
      if (latestRequestId.current === requestId) setLoading(false)
    }
  }

  const handleSearch = (value: string): void => {
    setSearchTerm(value)
    const trimmed = value.trim()
    if (trimmed === '') {
      setResults([])
      setQueryTopDims([])
      setMessage(null)
      setError(null)
      return
    }
    void runSearch(trimmed, subject)
  }

  const handleSubjectChange = (next: Subject): void => {
    setSubject(next)
    setRevealedAnswers(new Set())
    const trimmed = searchTerm.trim()
    if (trimmed === '') {
      setResults([])
      setQueryTopDims([])
      setMessage(null)
      setError(null)
      return
    }
    void runSearch(trimmed, next)
  }

  const similarityAccent = (score: number): { border: string; badgeBg: string; badgeFg: string } => {
    if (!Number.isFinite(score)) {
      return { border: 'rgba(15, 23, 42, 0.2)', badgeBg: 'rgba(15, 23, 42, 0.06)', badgeFg: 'rgba(15, 23, 42, 0.7)' }
    }
    if (score >= 0.75) {
      return { border: '#16a34a', badgeBg: 'rgba(22, 163, 74, 0.12)', badgeFg: '#15803d' }
    }
    if (score >= 0.55) {
      return { border: '#2563eb', badgeBg: 'rgba(37, 99, 235, 0.12)', badgeFg: '#1d4ed8' }
    }
    if (score >= 0.35) {
      return { border: '#7c3aed', badgeBg: 'rgba(124, 58, 237, 0.12)', badgeFg: '#6d28d9' }
    }
    return { border: '#64748b', badgeBg: 'rgba(100, 116, 139, 0.14)', badgeFg: 'rgba(71, 85, 105, 0.9)' }
  }

  const asStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    return value.filter(v => typeof v === 'string') as string[]
  }

  const renderDimSection = (topDims: SvdDim[] | undefined): JSX.Element | null => {
    if (!topDims || topDims.length === 0) return null
    const posDims = topDims.filter(d => {
      const q = queryTopDims.find(q => q.dim === d.dim)
      return q ? q.activation * d.activation > 0 : d.activation >= 0
    })
    const negDims = topDims.filter(d => {
      const q = queryTopDims.find(q => q.dim === d.dim)
      return q ? q.activation * d.activation < 0 : d.activation < 0
    })
    if (posDims.length === 0 && negDims.length === 0) return null
    const shortLabel = (label: string) => label.split(' · ').slice(0, 3).join(', ')
    return (
      <div className="why-matched-section">
        <div className="why-matched-title">Why this matched in SVD</div>
        {posDims.length > 0 && (
          <div className="dim-group">
            <div className="dim-group-label positive">Positive dimensions</div>
            <div className="dim-tags">
              {posDims.map(d => (
                <div key={d.dim} className="dim-tag dim-tag-positive" title={`activation ${d.activation.toFixed(3)}`}>
                  Dim {d.dim}: {shortLabel(d.label)}
                </div>
              ))}
            </div>
          </div>
        )}
        {negDims.length > 0 && (
          <div className="dim-group">
            <div className="dim-group-label negative">Negative dimensions</div>
            <div className="dim-tags">
              {negDims.map(d => (
                <div key={d.dim} className="dim-tag dim-tag-negative" title={`activation ${d.activation.toFixed(3)}`}>
                  Dim {d.dim}: {shortLabel(d.label)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const toggleAnswer = (problemId: number): void => {
    setRevealedAnswers(prev => {
      const next = new Set(prev)
      if (next.has(problemId)) {
        next.delete(problemId)
      } else {
        next.add(problemId)
      }
      return next
    })
  }

  if (useLlm === null) return <></>

  return (
    <div className={`full-body-container ${useLlm ? 'llm-mode' : ''}`}>
      <div className="page">
        {/* Header (always shown) */}
        <div className="app-header">
          <div className="brand">StudyBuddy</div>
          <div className="subtitle">Find similar practice problems for math and CS</div>
        </div>

        {/* Search bar (always shown) */}
        <div className="top-text">
          <div className="subject-toggle" role="tablist" aria-label="Choose subject">
            <button
              type="button"
              className={`subject-button ${subject === 'math' ? 'active' : ''}`}
              onClick={() => handleSubjectChange('math')}
            >
              Math
            </button>
            <button
              type="button"
              className={`subject-button ${subject === 'cs' ? 'active' : ''}`}
              onClick={() => handleSubjectChange('cs')}
            >
              CS
            </button>
          </div>

          <div className="input-box" onClick={() => document.getElementById('search-input')?.focus()}>
            <img src={SearchIcon} alt="search" />
            <input
              id="search-input"
              placeholder={subject === 'math' ? 'Paste a math problem or concept…' : 'Paste a CS problem or concept…'}
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>

          <div className="hint-text">
            {subject === 'math'
              ? 'Tip: paste the full statement (with LaTeX) or a short concept like “circle tangency geometry”.'
              : 'Tip: paste a CS problem statement (or keywords) like “shortest path in a graph with constraints” or “DP on grids”.'}
          </div>
        </div>

      {/* Search results (always shown) */}
        <div id="answer-box">
          {error && <div className="notice error">{error}</div>}
          {!error && message && <div className="notice">{message}</div>}

          {!loading && !error && queryTopDims.length > 0 && results.length > 0 && (
            <div className="query-dims-section">
              <div className="query-dims-label">Semantic concepts activated by your query</div>
              <div className="query-dims-list">
                {queryTopDims.map((d) => (
                  <div key={d.dim} className="query-dim-row" title={`dim ${d.dim}`}>
                    <span className="query-dim-score">
                      {d.activation >= 0 ? '+' : ''}{d.activation.toFixed(3)}
                    </span>
                    <span className="query-dim-words">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && (
            <div className="loading-indicator visible" aria-live="polite">
              <span className="loading-dot" />
              <span className="loading-dot" />
              <span className="loading-dot" />
            </div>
          )}

          {!loading && !error && results.length === 0 && searchTerm.trim() !== '' && (
            <div className="notice">No matching problems found.</div>
          )}

          {results.map((problem) => {
            const acc = similarityAccent(problem.similarity_score)

            if (subject === 'math' && 'problem_raw' in problem) {
              const answerRevealed = revealedAnswers.has(problem.problem_id)

              return (
                <div
                  key={problem.problem_id}
                  className="problem-item"
                  style={{ borderLeftColor: acc.border }}
                >
                  <div className="problem-header">
                    <div className="problem-title">Problem #{problem.problem_id}</div>
                    <div
                      className="similarity-badge"
                      style={{ background: acc.badgeBg, color: acc.badgeFg, borderColor: acc.badgeFg }}
                    >
                      Similarity{' '}
                      {Number.isFinite(problem.similarity_score) ? problem.similarity_score.toFixed(2) : '—'}
                    </div>
                  </div>

                  {renderDimSection(problem.top_dims)}

                  <div className="problem-section">
                    <div className="problem-label">Problem</div>
                    <MathRenderer text={problem.problem_raw} />
                  </div>

                  <div className="problem-section">
                    <div className="problem-label">Answer</div>
                    <button
                      type="button"
                      className="answer-toggle"
                      onClick={() => toggleAnswer(problem.problem_id)}
                    >
                      {answerRevealed ? 'Hide answer' : 'Reveal answer'}
                    </button>
                    {answerRevealed && (
                      <div className="answer-content">
                        <MathRenderer text={problem.answer} />
                      </div>
                    )}
                  </div>
                </div>
              )
            }

            if (subject === 'cs' && 'title' in problem) {
              const cs = problem
              const companies = asStringArray(cs.companies)
              const relatedTopics = asStringArray(cs.related_topics)
              const similarQuestions = asStringArray(cs.similar_questions)

              const difficultyText = typeof cs.difficulty === 'number' ? String(cs.difficulty) : cs.difficulty
              const acceptanceText = typeof cs.acceptance_rate === 'number'
                ? cs.acceptance_rate <= 1
                  ? `${(cs.acceptance_rate * 100).toFixed(1)}%`
                  : `${cs.acceptance_rate.toFixed(1)}%`
                : String(cs.acceptance_rate)

              return (
                <div
                  key={cs.problem_id}
                  className="problem-item"
                  style={{ borderLeftColor: acc.border }}
                >
                  <div className="problem-header">
                    <div className="problem-title cs-title">{cs.title ?? `Problem #${cs.problem_id}`}</div>
                    <div
                      className="similarity-badge"
                      style={{ background: acc.badgeBg, color: acc.badgeFg, borderColor: acc.badgeFg }}
                    >
                      Similarity{' '}
                      {Number.isFinite(cs.similarity_score) ? cs.similarity_score.toFixed(2) : '—'}
                    </div>
                  </div>

                  {renderDimSection(cs.top_dims)}

                  <div className="cs-subtitle">LeetCode-style problem</div>

                  <div className="cs-meta">
                    <div className="cs-chip">Difficulty: {difficultyText}</div>
                    <div className="cs-chip">Acceptance: {acceptanceText}</div>
                    {companies.length > 0 && (
                      <div className="cs-chip">
                        Companies: {companies.slice(0, 3).join(', ')}
                      </div>
                    )}
                  </div>

                  <div className="problem-section">
                    <div className="problem-label">Description</div>
                    <TextRenderer text={cs.description ?? ''} />
                  </div>

                  <div className="cs-links">
                    {cs.url && (
                      <a className="cs-link" href={cs.url} target="_blank" rel="noreferrer">
                        View problem
                      </a>
                    )}
                    {cs.solution_link && (
                      <a className="cs-link" href={cs.solution_link} target="_blank" rel="noreferrer">
                        Solution link
                      </a>
                    )}
                  </div>

                  {relatedTopics.length > 0 && (
                    <div className="cs-row">
                      <div className="cs-row-label">Related topics</div>
                      <div className="cs-chips">
                        {relatedTopics.slice(0, 10).map((t) => (
                          <div key={t} className="cs-pill">
                            {t}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {similarQuestions.length > 0 && (
                    <div className="cs-row">
                      <div className="cs-row-label">Similar questions</div>
                      <div className="cs-similar">
                        {similarQuestions.slice(0, 5).map((q, idx) => (
                          <div key={`${q}-${idx}`} className="cs-similar-item">
                            {q}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            }

            return null
          })}
        </div>
      </div>

      {/* Chat (only when USE_LLM = True in routes.py) */}
      {useLlm && <Chat onSearchTerm={handleSearch} />}
    </div>
  )
}

export default App
