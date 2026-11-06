// Mermaid pie -> one stacked bar with a legend. Pure functions, no I/O.

import type { Art, Seg } from '../common'
import { PALETTE, DIM, TITLE, strWidth, srcLines, clean, unquote, pad, cut, toArt } from '../common'

export function renderPie(src: string, maxWidth: number): Art | null {
  const lines = srcLines(src)
  let title = /^pie\b(?:\s+showData)?(?:\s+title\s+(.+))?/.exec(lines[0].trim())?.[1] ?? ''
  const items: { label: string; value: number }[] = []
  for (const raw of lines.slice(1)) {
    const st = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /^title\s+(.+)$/.exec(st))) title = m[1]
    else if ((m = /^("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/.exec(st))) items.push({ label: clean(unquote(m[1])), value: Number(m[2]) })
  }
  if (!items.length) return null
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0) || 1
  const color = (k: number) => PALETTE[k % PALETTE.length]
  const labelW = Math.min(24, Math.max(...items.map(i => strWidth(i.label))))
  const barW = Math.max(20, Math.min(60, maxWidth - 2))

  // one bar for the whole, each slice a colored run, rounded so the runs fill the bar exactly
  const bar: Seg[] = []
  let acc = 0
  let drawn = 0
  items.forEach((it, k) => {
    acc += Math.max(0, it.value)
    const upto = Math.round((acc / total) * barW)
    const len = Math.max(it.value > 0 && upto === drawn ? 1 : 0, upto - drawn)
    bar.push({ text: '█'.repeat(len), color: color(k) })
    drawn += len
  })

  const out: Seg[][] = []
  if (title) out.push([{ text: clean(title), color: TITLE }])
  out.push(bar)
  items.forEach((it, k) => {
    out.push([
      { text: '■ ', color: color(k) },
      { text: pad(cut(it.label, labelW), labelW) },
      { text: ` ${((Math.max(0, it.value) / total) * 100).toFixed(1).padStart(5)}%  ` },
      { text: String(it.value), color: DIM },
    ])
  })
  return toArt(out)
}
