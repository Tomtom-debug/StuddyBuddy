import { useState, useRef, useEffect } from 'react'
import { SendHorizontal, Lightbulb, ListChecks, Target, BookOpen } from 'lucide-react'
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
  context: SearchResult[]
  onClose: () => void
}

function Chat({ subject, context, onClose }: ChatProps): JSX.Element {
  const initialMessage = (): AssistantMessage => ({
    isUser: false,
    irQuery: '',
    irResults: [],
    answerText: subject === 'math'
      ? "Hi! I'm Sprout. Ask me anything about the retrieved problems, or any math concept you want to understand better!"
      : "Hi! I'm Sprout. Ask me anything about the retrieved problems, or any LeetCode concept or pattern you want to explore!",
  })

  const [messages, setMessages] = useState<Message[]>([initialMessage()])
  const [input, setInput] = useState<string>('')
  const [loading, setLoading] = useState<boolean>(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, loading])

  useEffect(() => {
    setMessages([initialMessage()])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject])

  const quickPrompts = ["Explain the key technique here", "Which problem should I start with?", "Compare these problems"]

  const quickActions = [
    { icon: <Lightbulb size={13} />, label: 'Give me a hint',      prompt: 'Give me a hint' },
    { icon: <ListChecks size={13} />, label: 'Walk me through #1', prompt: 'Walk me through #1' },
    { icon: <Target size={13} />,    label: 'Quiz me',             prompt: 'Quiz me' },
    { icon: <BookOpen size={13} />,  label: subject === 'math' ? 'Related topic' : 'Time complexity',
                                     prompt: subject === 'math' ? 'Related topic' : 'Time complexity' },
  ]

  const sendMessage = async (text?: string): Promise<void> => {
    const t = (text ?? input).trim()
    if (!t || loading) return

    setMessages(prev => [...prev, { isUser: true, text: t }])
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: t,
          subject,
          provided_context: context.length > 0 ? context : undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json() as Record<string, unknown>
        setMessages(prev => [
          ...prev,
          { isUser: false, irQuery: '', irResults: [], answerText: 'Error: ' + String(data.error ?? response.status) },
        ])
        setLoading(false)
        return
      }

      setLoading(false)
      setMessages(prev => [
        ...prev,
        { isUser: false, irQuery: '', irResults: [], answerText: '' },
      ])

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
            const data = JSON.parse(line.slice(6)) as Record<string, unknown>
            setMessages(prev => {
              const last = prev[prev.length - 1] as AssistantMessage
              if (data.ir_query !== undefined) return [...prev.slice(0, -1), { ...last, irQuery: String(data.ir_query) }]
              if (data.ir_results !== undefined) return [...prev.slice(0, -1), { ...last, irResults: data.ir_results as SearchResult[] }]
              if (typeof data.content === 'string') return [...prev.slice(0, -1), { ...last, answerText: last.answerText + data.content }]
              if (typeof data.error === 'string') return [...prev.slice(0, -1), { ...last, answerText: 'Error: ' + data.error }]
              return prev
            })
          } catch { /* ignore malformed */ }
        }
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { isUser: false, irQuery: '', irResults: [], answerText: 'Something went wrong. Please try again.' },
      ])
      setLoading(false)
    }
  }

  const renderResult = (result: SearchResult): JSX.Element => {
    const score = result.similarity_score
    const accentColor = score >= 0.75 ? '#059669' : score >= 0.55 ? '#f59e0b' : '#a78bfa'

    if ('problem_raw' in result) {
      return (
        <div key={result.problem_id} className="chat-context-card" style={{ borderLeftColor: accentColor }}>
          <span className="chat-context-label">Problem #{result.problem_id}</span>
          <span className="chat-context-score">{score.toFixed(2)}</span>
          <div className="chat-context-text">
            {result.problem_raw.slice(0, 120)}{result.problem_raw.length > 120 ? '…' : ''}
          </div>
        </div>
      )
    }

    return (
      <div key={result.problem_id} className="chat-context-card" style={{ borderLeftColor: accentColor }}>
        <span className="chat-context-label">{result.title ?? `Problem #${result.problem_id}`}</span>
        <span className="chat-context-score">{score.toFixed(2)}</span>
        <div className="chat-context-text">
          {result.difficulty}
          {typeof result.acceptance_rate === 'number'
            ? ` · ${(result.acceptance_rate <= 1 ? result.acceptance_rate * 100 : result.acceptance_rate).toFixed(1)}% acceptance`
            : ''}
        </div>
      </div>
    )
  }

  const isOnlyInitial = messages.length === 1 && !messages[0].isUser

  return (
    <aside className="chat">
      <div className="chat-head">
        <div className="chat-title">
          <span>Sprout</span>
          <button className="chat-close" onClick={onClose} aria-label="Close Sprout">×</button>
        </div>
        <div className="chat-sub">Your study buddy · knows what you're looking at</div>
        <div className="chat-status">
          <span className="pulse" />
          Watching {context.length > 0 ? `${context.length} problems` : subject === 'math' ? 'math' : 'CS'}
        </div>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {messages.map((msg, i) => {
          if (msg.isUser) {
            return (
              <div key={i} className="msg user">
                {msg.text}
              </div>
            )
          }

          return (
            <div key={i} className="msg assistant">
              {msg.irResults.length > 0 && (
                <details className="chat-context-section">
                  <summary>
                    Context used ({msg.irResults.length} problem{msg.irResults.length !== 1 ? 's' : ''})
                  </summary>
                  <div className="chat-context-cards">
                    {msg.irResults.map(r => renderResult(r))}
                  </div>
                </details>
              )}
              {msg.answerText && (
                <p className="chat-answer">{msg.answerText}</p>
              )}
              {isOnlyInitial && i === 0 && (
                <div className="suggest-chips">
                  {quickPrompts.map(q => (
                    <button key={q} className="suggest-chip" onClick={() => void sendMessage(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {loading && (
          <div className="msg assistant">
            <div className="msg-thinking">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>

      <div className="chat-foot">
        <div className="chat-quickrow">
          {quickActions.map(q => (
            <button key={q.label} className="quick-chip" onClick={() => void sendMessage(q.prompt)}>
              {q.icon}{q.label}
            </button>
          ))}
        </div>
        <div className="chat-input-row">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) void sendMessage() }}
            placeholder="Ask Sprout a follow-up…"
            disabled={loading}
          />
          <button
            className="chat-send"
            onClick={() => void sendMessage()}
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}

export default Chat
