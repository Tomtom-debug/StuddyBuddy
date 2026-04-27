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
  strict: 'ignore',
  preProcess: (math: string) => math.replace(/\\text-/g, '\\text{-}'),
}

function removeLastUnescapedDollar(input: string): string {
  for (let i = input.length - 1; i >= 0; i -= 1) {
    if (input[i] === '$' && input[i - 1] !== '\\') {
      return input.slice(0, i) + input.slice(i + 1)
    }
  }
  return input
}

function normalizeDanglingDelimiters(input: string): string {
  let out = input
  const unescapedDollars = (out.match(/(?<!\\)\$/g) ?? []).length
  if (unescapedDollars % 2 === 1) {
    out = removeLastUnescapedDollar(out)
  }
  return out
}

function simplifyArrayAlignment(input: string): string {
  return input.replace(/\\begin\{array\}\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_match, spec: string) => {
    const simplified = spec
      .replace(/@\{[^{}]*\}/g, '')
      .replace(/\s+/g, '')
      .replace(/[^clr|]/g, '')

    return `\\begin{array}{${simplified || 'c'}}`
  })
}

function normalizeLatex(input: string): string {
  return simplifyArrayAlignment(normalizeDanglingDelimiters(
    input
      // Currency amounts written as $$43$ instead of $43
      .replace(/\$\$([0-9][0-9,]*(?:\.[0-9]+)?)\$(?!\$)/g, '\\$$1')
      // align / align* → aligned (KaTeX doesn't have standalone align)
      .replace(/\\begin\{align\*?\}/g, '$$\\begin{aligned}')
      .replace(/\\end\{align\*?\}/g, '\\end{aligned}$$')
      // eqnarray → aligned
      .replace(/\\begin\{eqnarray\*?\}/g, '$$\\begin{aligned}')
      .replace(/\\end\{eqnarray\*?\}/g, '\\end{aligned}$$')
      // dots variants KaTeX doesn't know
      .replace(/\\dotsc\b/g, '\\ldots')
      .replace(/\\dotsb\b/g, '\\cdots')
      .replace(/\\dotsi\b/g, '\\cdots')
      .replace(/\\dotsm\b/g, '\\cdots')
      // \emph → \textit
      .replace(/\\emph\{/g, '\\textit{')
      // \textup → \text
      .replace(/\\textup\{/g, '\\text{')
      // spacing commands KaTeX ignores or errors on — strip them
      .replace(/\\(vspace|hspace\*?)\{[^}]*\}/g, '')
      .replace(/\\(medskip|bigskip|smallskip|noindent|hfill|newline)\b/g, ' ')
      // \text- fix
      .replace(/\\text-/g, '\\text{-}')
      // \left. and \right. (invisible fence — keep, KaTeX handles it)
      // \operatorname already supported by KaTeX
      // strip environments that appear outside math mode and confuse the renderer
      .replace(/\\begin\{(itemize|enumerate|description)\}/g, '')
      .replace(/\\end\{(itemize|enumerate|description)\}/g, '')
      .replace(/\\item\b\s*/g, '\n• ')
  ))
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

function AsyBlock(): JSX.Element {
  return (
    <div className="asy-fallback">
      <div className="asy-status">Diagrams coming soon.</div>
    </div>
  )
}

type Segment =
  | { type: 'text'; content: string }
  | { type: 'tabular'; src: string }
  | { type: 'asy'; src: string }

// Matches both [asy]...[/asy] and \begin{asy}...\end{asy}
const ASY_RE = /\[asy\][\s\S]*?\[\/asy\]|\\begin\{asy\}[\s\S]*?\\end\{asy\}/gi
const TABULAR_RE = /\\begin\{tabular\}(?:\{[^}]*\})?[\s\S]*?\\end\{tabular\}/g

function splitSegments(text: string): Segment[] {
  // Collect all special blocks with their positions
  type RawMatch = { index: number; end: number; seg: Segment }
  const matches: RawMatch[] = []

  let m: RegExpExecArray | null
  const asyRe = new RegExp(ASY_RE.source, 'gi')
  while ((m = asyRe.exec(text)) !== null)
    matches.push({ index: m.index, end: m.index + m[0].length, seg: { type: 'asy', src: m[0] } })

  const tabRe = new RegExp(TABULAR_RE.source, 'g')
  while ((m = tabRe.exec(text)) !== null)
    matches.push({ index: m.index, end: m.index + m[0].length, seg: { type: 'tabular', src: m[0] } })

  matches.sort((a, b) => a.index - b.index)

  const segments: Segment[] = []
  let last = 0
  for (const hit of matches) {
    if (hit.index > last) segments.push({ type: 'text', content: text.slice(last, hit.index) })
    segments.push(hit.seg)
    last = hit.end
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
      {segments.map((seg, i) => {
        if (seg.type === 'tabular') return <TabularBlock key={i} src={seg.src} />
        if (seg.type === 'asy') return <AsyBlock key={i} />
        return <MathSegment key={i} content={seg.content} />
      })}
    </div>
  )
}
