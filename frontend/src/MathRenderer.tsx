import { useEffect, useRef } from 'react'
import 'katex/dist/katex.min.css'
import renderMathInElement from 'katex/contrib/auto-render'

type MathRendererProps = {
  text: string
}

const KATEX_OPTS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '\\(', right: '\\)', display: false },
    { left: '$', right: '$', display: false },
    { left: '\\[', right: '\\]', display: true },
  ],
  throwOnError: false,
}

function normalizeLatex(input: string): string {
  return input
    .replace(/\\begin\{align\*\}/g, '$$\\begin{aligned}')
    .replace(/\\end\{align\*\}/g, '\\end{aligned}$$')
    .replace(/\\begin\{align\}/g, '$$\\begin{aligned}')
    .replace(/\\end\{align\}/g, '\\end{aligned}$$')
}

function TabularBlock({ src }: { src: string }): JSX.Element {
  const match = /\\begin\{tabular\}(?:\{[^}]*\})?([\s\S]*?)\\end\{tabular\}/.exec(src)
  if (!match) return <pre className="latex-pre">{src}</pre>

  const rows = match[1]
    .trim()
    .split(/\\\\/)
    .map(r => r.replace(/\\hline/g, '').trim())
    .filter(Boolean)
    .map(r => r.split('&').map(c => c.trim()))

  return (
    <div className="latex-table-wrap">
      <table className="latex-table">
        <tbody>
          {rows.map((cells, ri) => (
            <tr key={ri}>
              {cells.map((cell, ci) => (
                <td key={ci}><KaTeXSpan text={cell} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KaTeXSpan({ text }: { text: string }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!ref.current) return
    try { renderMathInElement(ref.current, KATEX_OPTS) } catch { /* ignore */ }
  }, [text])
  return <span ref={ref}>{normalizeLatex(text)}</span>
}

type Segment =
  | { type: 'text'; content: string }
  | { type: 'tabular'; src: string }

function splitSegments(text: string): Segment[] {
  const segments: Segment[] = []
  const re = /\\begin\{tabular\}(?:\{[^}]*\})?[\s\S]*?\\end\{tabular\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', content: text.slice(last, m.index) })
    segments.push({ type: 'tabular', src: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ type: 'text', content: text.slice(last) })
  return segments
}

function MathSegment({ content }: { content: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    try { renderMathInElement(ref.current, KATEX_OPTS) } catch { /* ignore */ }
  }, [content])
  return <div ref={ref}>{normalizeLatex(content)}</div>
}

export default function MathRenderer({ text }: MathRendererProps): JSX.Element {
  const segments = splitSegments(text)

  if (segments.length === 1 && segments[0].type === 'text') {
    return <MathSegment content={segments[0].content} />
  }

  return (
    <div className="latex-text">
      {segments.map((seg, i) =>
        seg.type === 'tabular'
          ? <TabularBlock key={i} src={seg.src} />
          : <MathSegment key={i} content={seg.content} />
      )}
    </div>
  )
}
