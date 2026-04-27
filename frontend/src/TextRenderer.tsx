import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

type TextRendererProps = {
  text: string
}

const components: Components = {
  code({ children, className }) {
    const isBlock = className?.startsWith('language-')
    return isBlock
      ? <pre className="code-block"><code>{children}</code></pre>
      : <code className="inline-code">{children}</code>
  },
  pre({ children }) {
    return <>{children}</>
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>
  },
}

export default function TextRenderer({ text }: TextRendererProps): JSX.Element {
  return (
    <div className="text-renderer">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
