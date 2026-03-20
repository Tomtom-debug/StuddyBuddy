type TextRendererProps = {
  text: string
}

export default function TextRenderer({ text }: TextRendererProps): JSX.Element {
  return <div className="text-renderer">{text}</div>
}

