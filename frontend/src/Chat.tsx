import { useState, useRef, useEffect } from 'react'
import SearchIcon from './assets/mag.png'
import MathRenderer from './MathRenderer'
import type { SearchResult, Subject } from './types'

interface UserMessage {
  isUser: true
  text: string
}

interface AssistantMessage {
  isUser: false
  irQuery: string
  irResults: SearchResult[]
  answerText: string
}

type Message = UserMessage | AssistantMessage

interface ChatProps {
  subject: Subject
}

function Chat({ subject }: ChatProps): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const text = input.trim()
    if (!text || loading) return

    setMessages(prev => [...prev, { isUser: true, text }])
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, subject }),
      })

      if (!response.ok) {
        const data = await response.json()
        setMessages(prev => [
          ...prev,
          { isUser: false, irQuery: '', irResults: [], answerText: 'Error: ' + (data.error || response.status) },
        ])
        setLoading(false)
        return
      }

      setLoading(false)
      setMessages(prev => [...prev, { isUser: false, irQuery: '', irResults: [], answerText: '' }])

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
            const data = JSON.parse(line.slice(6))
            setMessages(prev => {
              const last = prev[prev.length - 1] as AssistantMessage
              if (data.ir_query !== undefined) return [...prev.slice(0, -1), { ...last, irQuery: data.ir_query }]
              if (data.ir_results !== undefined) return [...prev.slice(0, -1), { ...last, irResults: data.ir_results }]
              if (data.content !== undefined) return [...prev.slice(0, -1), { ...last, answerText: last.answerText + data.content }]
              if (data.error) return [...prev.slice(0, -1), { ...last, answerText: 'Error: ' + data.error }]
              return prev
            })
          } catch { /* ignore malformed lines */ }
        }
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { isUser: false, irQuery: '', irResults: [], answerText: 'Something went wrong. Check the console.' },
      ])
      setLoading(false)
    }
  }

  const renderContextCard = (result: SearchResult) => {
    const score = result.similarity_score
    const accent = score >= 0.75 ? '#16a34a' : score >= 0.55 ? '#2563eb' : '#7c3aed'

    if ('problem_raw' in result) {
      const preview = result.problem_raw.length > 180
        ? result.problem_raw.slice(0, 180) + '…'
        : result.problem_raw
      return (
        <div key={result.problem_id} className="chat-context-card" style={{ borderLeftColor: accent }}>
          <div className="chat-context-card-header">
            <span className="chat-context-label">Problem #{result.problem_id}</span>
            <span className="chat-similarity-badge" style={{ color: accent }}>
              {score.toFixed(2)}
            </span>
          </div>
          <div className="chat-context-text">
            <MathRenderer text={preview} />
          </div>
        </div>
      )
    }

    return (
      <div key={result.problem_id} className="chat-context-card" style={{ borderLeftColor: accent }}>
        <div className="chat-context-card-header">
          <span className="chat-context-label">{result.title}</span>
          <span className="chat-similarity-badge" style={{ color: accent }}>
            {score.toFixed(2)}
          </span>
        </div>
        <div className="chat-context-text">
          {result.difficulty} · {
            typeof result.acceptance_rate === 'number'
              ? `${(result.acceptance_rate <= 1 ? result.acceptance_rate * 100 : result.acceptance_rate).toFixed(1)}% acceptance`
              : result.acceptance_rate
          }
        </div>
      </div>
    )
  }

  return (
    <>
      <div id="messages">
        {messages.map((msg, i) => {
          if (msg.isUser) {
            return (
              <div key={i} className="message user">
                <p>{msg.text}</p>
              </div>
            )
          }

          return (
            <div key={i} className="message assistant">
              {msg.irQuery && (
                <div className="chat-ir-pill">
                  Searched for: <em>{msg.irQuery}</em>
                </div>
              )}

              {msg.irResults.length > 0 && (
                <details className="chat-context-section">
                  <summary>
                    Context used ({msg.irResults.length} problem{msg.irResults.length !== 1 ? 's' : ''})
                  </summary>
                  <div className="chat-context-cards">
                    {msg.irResults.map(r => renderContextCard(r))}
                  </div>
                </details>
              )}

              {msg.irQuery && msg.irResults.length === 0 && (
                <div className="chat-no-results">
                  No problems matched closely enough to use as context.
                </div>
              )}

              {msg.answerText && (
                <p className="chat-answer">{msg.answerText}</p>
              )}
            </div>
          )
        })}

        {loading && (
          <div className="loading-indicator visible">
            <span className="loading-dot" />
            <span className="loading-dot" />
            <span className="loading-dot" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-bar">
        <form className="input-row" onSubmit={sendMessage}>
          <img src={SearchIcon} alt="" />
          <input
            type="text"
            placeholder="Ask about a concept or problem type…"
            value={input}
            onChange={e => setInput(e.target.value)}
            disabled={loading}
            autoComplete="off"
          />
          <button type="submit" disabled={loading}>Send</button>
        </form>
      </div>
    </>
  )
}

export default Chat
