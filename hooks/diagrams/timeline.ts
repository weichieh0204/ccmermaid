// Mermaid timeline -> periods with their events. Pure functions, no I/O.

import type { Art, Seg } from '../common'
import { PALETTE, DIM, LINE, TITLE, srcLines, clean, toArt } from '../common'

export function renderTimeline(src: string): Art | null {
  const lines = srcLines(src).slice(1)
  let title = ''
  type Period = { section: string; name: string; events: string[] }
  const periods: Period[] = []
  let section = ''
  for (const raw of lines) {
    const st = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /^title\s+(.+)$/.exec(st))) title = clean(m[1])
    else if ((m = /^section\s+(.+)$/.exec(st))) section = clean(m[1])
    else if (st.startsWith(':')) {
      const p = periods[periods.length - 1]
      if (p) p.events.push(...st.split(':').map(clean).filter(Boolean))
    } else if (/^(accTitle|accDescr|direction)\b/.test(st)) continue
    else {
      const [name, ...evs] = st.split(':')
      periods.push({ section, name: clean(name), events: evs.map(clean).filter(Boolean) })
    }
  }
  if (!periods.length) return null
  const out: Seg[][] = []
  if (title) out.push([{ text: title, color: TITLE }])
  let lastSection = ''
  let si = -1
  periods.forEach((p, i) => {
    if (p.section && p.section !== lastSection) {
      lastSection = p.section
      si++
      out.push([{ text: `┈┈ ${p.section} ┈┈`, color: DIM }])
    }
    const c = PALETTE[(si >= 0 ? si : i) % PALETTE.length]
    const last = i === periods.length - 1
    out.push([{ text: '◆ ', color: c }, { text: p.name, color: c }])
    p.events.forEach(ev => out.push([{ text: last ? '  ' : '│ ', color: LINE }, { text: '  • ' + ev }]))
    if (!last) out.push([{ text: '│', color: LINE }])
  })
  return toArt(out)
}
