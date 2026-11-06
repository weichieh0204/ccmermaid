// Finds the mermaid blocks in a reply and sends each one to the drawer for its diagram type. Pure functions, no I/O.

import type { Art } from './common'
import { diagramKind } from './common'
import { renderFlowchart } from './diagrams/flowchart'
import { renderGantt } from './diagrams/gantt'
import { renderGitGraph } from './diagrams/gitgraph'
import { renderMindmap } from './diagrams/mindmap'
import { renderPie } from './diagrams/pie'
import { renderSequence } from './diagrams/sequence'
import { renderState } from './diagrams/state'
import { renderTimeline } from './diagrams/timeline'

export type Part = { kind: 'md'; text: string } | { kind: 'mermaid'; source: string }

// ---------------------------------------------------------------- split

const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*$/gm

export function splitMermaid(text: string): Part[] {
  const parts: Part[] = []
  let last = 0
  FENCE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FENCE.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: 'md', text: text.slice(last, m.index) })
    parts.push({ kind: 'mermaid', source: m[2] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ kind: 'md', text: text.slice(last) })
  return parts
}

// ---------------------------------------------------------------- dispatch

/** One drawer per diagram keyword. To add a type: write diagrams/<type>.ts and add a line here. */
const DRAWERS: Record<string, (src: string, maxWidth: number) => Art | null> = {
  flowchart: renderFlowchart,
  graph: renderFlowchart,
  stateDiagram: renderState,
  'stateDiagram-v2': renderState,
  sequenceDiagram: renderSequence,
  gantt: renderGantt,
  gitGraph: src => renderGitGraph(src),
  pie: renderPie,
  mindmap: src => renderMindmap(src),
  timeline: src => renderTimeline(src),
}

/** Draws one mermaid block; null when the type is not supported or the source does not parse. */
export function renderMermaid(src: string, maxWidth = 120): Art | null {
  const draw = DRAWERS[diagramKind(src)]
  if (!draw) return null
  try {
    return draw(src, maxWidth)
  } catch {
    return null
  }
}
