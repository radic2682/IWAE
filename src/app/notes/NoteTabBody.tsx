import type { ReactNode } from 'react'
import { MarkdownPane } from '../documents/MarkdownPane'

interface NoteTabBodyProps {
  readonly id: string
  readonly title: string
  readonly markdownSources: Readonly<Record<string, string>>
  readonly renderCanvas: () => ReactNode
}

export function NoteTabBody({ id, title, markdownSources, renderCanvas }: NoteTabBodyProps) {
  const markdown = markdownSources[id]
  if (markdown !== undefined) return <MarkdownPane title={title} source={markdown} />
  return renderCanvas()
}
