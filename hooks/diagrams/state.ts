// Mermaid stateDiagram -> flowchart source, drawn by the flowchart layout. Pure functions, no I/O.

import type { Art } from '../common'
import { srcLines, clean } from '../common'
import { renderFlowchart } from './flowchart'

/** Rewrites a stateDiagram as flowchart source, so the flowchart renderer draws it. */
export function stateToFlowchart(src: string): string | null {
  const lines = srcLines(src)
  if (!/^stateDiagram(-v2)?\b/.test(lines[0]?.trim() ?? '')) return null
  let dir = 'TD'
  const out: string[] = []
  const labels = new Map<string, string>()
  const shapes = new Map<string, string>()
  let inNote = false
  let starts = 0
  let ends = 0
  const id = (raw: string, side: 'from' | 'to') => {
    const t = raw.trim()
    if (t === '[*]') {
      if (side === 'from') {
        starts++
        return '__start'
      }
      ends++
      return '__end'
    }
    return t.replace(/[^\p{L}\p{N}_]/gu, '_')
  }
  for (const raw of lines.slice(1)) {
    const st = raw.trim()
    if (inNote) {
      if (/^end\s+note\b/.test(st)) inNote = false
      continue
    }
    let m: RegExpExecArray | null
    if ((m = /^direction\s+(LR|RL|TB|TD|BT)\b/.exec(st))) {
      dir = m[1] === 'LR' || m[1] === 'RL' ? 'LR' : 'TD'
      continue
    }
    if (/^note\b/.test(st)) {
      if (!st.includes(':')) inNote = true
      continue
    }
    if (/^(classDef|class|style|accTitle|accDescr|\{|\}|--)/.test(st) || st === '}') continue
    if ((m = /^state\s+"([^"]+)"\s+as\s+([\p{L}\p{N}_]+)/u.exec(st))) {
      labels.set(m[2], clean(m[1]))
      continue
    }
    if ((m = /^state\s+([\p{L}\p{N}_]+)\s*<<(choice|fork|join)>>/u.exec(st))) {
      shapes.set(m[1], m[2])
      continue
    }
    if (/^state\s+/.test(st)) continue
    if ((m = /^(\[\*\]|[\p{L}\p{N}_]+)\s*-->\s*(\[\*\]|[\p{L}\p{N}_]+)\s*(?::\s*(.*))?$/u.exec(st))) {
      const a = id(m[1], 'from')
      const b = id(m[2], 'to')
      const lab = m[3] ? clean(m[3]).replace(/\|/g, '/') : ''
      out.push(lab ? `${a} -->|${lab}| ${b}` : `${a} --> ${b}`)
      continue
    }
    if ((m = /^([\p{L}\p{N}_]+)\s*:\s*(.+)$/u.exec(st))) {
      labels.set(m[1], clean(m[2]))
      continue
    }
  }
  if (!out.length) return null
  const decl: string[] = []
  if (starts) decl.push('__start((●))')
  if (ends) decl.push('__end((◉))')
  for (const [k, v] of labels) decl.push(`${k}(${v.replace(/[()[\]{}]/g, ' ')})`)
  for (const [k, v] of shapes) decl.push(v === 'choice' ? `${k}{${labels.get(k) ?? '?'}}` : `${k}[${v}]`)
  return [`flowchart ${dir}`, ...decl, ...out].join('\n')
}

/** Draws a stateDiagram through the flowchart layout; null when it does not parse. */
export function renderState(src: string, maxWidth: number): Art | null {
  const fc = stateToFlowchart(src)
  return fc ? renderFlowchart(fc, maxWidth) : null
}
