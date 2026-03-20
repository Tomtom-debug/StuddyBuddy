import { useEffect, useRef } from 'react'
import 'katex/dist/katex.min.css'
import renderMathInElement from 'katex/contrib/auto-render'

type MathRendererProps = {
  text: string
}

function normalizeLatex(input: string): string {
  return input
    .replace(/\\begin\{align\*\}/g, '$$\\begin{aligned}')
    .replace(/\\end\{align\*\}/g, '\\end{aligned}$$')
    .replace(/\\begin\{align\}/g, '$$\\begin{aligned}')
    .replace(/\\end\{align\}/g, '\\end{aligned}$$')
}

/**
 * Renders LaTeX found in a plain-text string using KaTeX's auto-render.
 * Backend returns strings containing delimiters like `$...$` and `$$...$$`.
 */
export default function MathRenderer({ text }: MathRendererProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const normalizedText = normalizeLatex(text)

  useEffect(() => {
    if (!ref.current) return

    // Ensure auto-render can find math delimiters by starting from plain text.
    // KaTeX will replace delimiters with generated HTML inside this element.
    try {
      renderMathInElement(ref.current, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
        ],
        throwOnError: false,
      })
    } catch {
      // If auto-render fails, fall back to showing the raw text.
    }
  }, [text])

  return (
    <div ref={ref} className="latex-text">
      {normalizedText}
    </div>
  )
}
