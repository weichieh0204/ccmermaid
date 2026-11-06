// Mermaid mindmap -> indented tree. Pure functions, no I/O.

import type { Art, Seg } from '../common'
import { PALETTE, TITLE, srcLines, clean, unquote, toArt } from '../common'

function mindText(raw: string): string {
  let s = raw.trim().replace(/:::.*$/, '').trim()
  const shapes: [RegExp, number][] = [
    [/^[^\s([{)]*\(\((.*)\)\)$/, 1],
    [/^[^\s([{)]*\)\)(.*)\(\($/, 1],
    [/^[^\s([{)]*\{\{(.*)\}\}$/, 1],
    [/^[^\s([{)]*\[(.*)\]$/, 1],
    [/^[^\s([{)]*\)(.*)\($/, 1],
    [/^[^\s([{)]*\((.*)\)$/, 1],
  ]
  for (const [re, g] of shapes) {
    const m = re.exec(s)
    if (m) {
      s = m[g]
      break
    }
  }
  return clean(unquote(s).replace(/`/g, '').replace(/\*\*/g, ''))
}

export function renderMindmap(src: string): Art | null {
  const lines = srcLines(src).slice(1)
  type Node = { text: string; indent: number; kids: Node[] }
  const root: Node = { text: '', indent: -1, kids: [] }
  const stack: Node[] = [root]
  for (const raw of lines) {
    if (/^\s*::icon\(/.test(raw)) continue
    const indent = raw.length - raw.trimStart().length
    const node: Node = { text: mindText(raw), indent, kids: [] }
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    stack[stack.length - 1].kids.push(node)
    stack.push(node)
  }
  if (!root.kids.length) return null
  const out: Seg[][] = []
  const walk = (n: Node, prefix: Seg[], color: string | undefined, isLast: boolean, top: boolean, branch: number) => {
    const c = top ? PALETTE[branch % PALETTE.length] : color
    if (prefix.length || !top) {
      out.push([...prefix, { text: isLast ? '└─ ' : '├─ ', color: c }, { text: n.text, color: c }])
    }
    const childPrefix = [...prefix, { text: isLast ? '   ' : '│  ', color: c }]
    n.kids.forEach((k, i) => walk(k, childPrefix, c, i === n.kids.length - 1, false, branch))
  }
  for (const r of root.kids) {
    out.push([{ text: `◉ ${r.text}`, color: TITLE }])
    r.kids.forEach((k, i) => {
      const c = PALETTE[i % PALETTE.length]
      const last = i === r.kids.length - 1
      out.push([{ text: last ? '└─ ' : '├─ ', color: c }, { text: k.text, color: c }])
      const pre: Seg[] = [{ text: last ? '   ' : '│  ', color: c }]
      k.kids.forEach((g, j) => walk(g, pre, c, j === k.kids.length - 1, false, i))
    })
  }
  return toArt(out)
}
