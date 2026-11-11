// Copies a drawn diagram to the clipboard as a PNG image. The drawing becomes grid cells (artToPicture),
// then each platform draws them with what it already has:
//   Windows and WSL: Windows PowerShell (clip_png.ps1)
//   macOS:           osascript with AppKit (clip_png_mac.js)
//   Linux:           an SVG from pictureToSvg, made PNG by rsvg-convert, ImageMagick, cairosvg or
//                    Inkscape, put on the clipboard by wl-copy (Wayland) or xclip (X11)
// Where none of these is found, the button is not shown.

import type { EngineInterface } from 'claude-code'

import type { Art } from './common'
import { strWidth } from './common'

const BG = '#1e1e2e'

// The terminal colors are pale, made for a dark background. The PNG is transparent and may be pasted
// on white, so each color is swapped for a mid tone that reads on both light and dark.
const MID: Record<string, string> = {
  '#89b4fa': '#4f86e8', // blue
  '#a6e3a1': '#3d9f4a', // green
  '#f9e2af': '#c99412', // yellow
  '#f5c2e7': '#cc5aa9', // pink
  '#94e2d5': '#1f9a8a', // teal
  '#fab387': '#e0702f', // orange
  '#cba6f7': '#8f5fdb', // purple
  '#f38ba8': '#db4166', // red
  '#6c7086': '#8a8fa3', // dim
}
const TEXT = '#808699'
const mid = (color: string | undefined) => (color && color.startsWith('#') ? (MID[color.toLowerCase()] ?? color) : TEXT)

// box-drawing characters as line segments: which sides of the cell they reach, and the line style
const U = 1
const D = 2
const L = 4
const R = 8
const BOX: Record<string, [number, number]> = {}
const put = (chars: string, bits: number, style: number) => {
  for (const ch of chars) BOX[ch] = [bits, style]
}
// style 0 = solid, 1 = dotted, 2 = thick
put('─', L | R, 0)
put('│', U | D, 0)
put('╴', L, 0)
put('╶', R, 0)
put('╵', U, 0)
put('╷', D, 0)
put('┌╭', D | R, 0)
put('┐╮', D | L, 0)
put('└╰', U | R, 0)
put('┘╯', U | L, 0)
put('├', U | D | R, 0)
put('┤', U | D | L, 0)
put('┬', D | L | R, 0)
put('┴', U | L | R, 0)
put('┼', U | D | L | R, 0)
put('┄┈╌', L | R, 1)
put('┆┊╎', U | D, 1)
put('═━', L | R, 2)
put('║┃', U | D, 2)
put('╔┏', D | R, 2)
put('╗┓', D | L, 2)
put('╚┗', U | R, 2)
put('╝┛', U | L, 2)
put('╠┣', U | D | R, 2)
put('╣┫', U | D | L, 2)
put('╦┳', D | L | R, 2)
put('╩┻', U | L | R, 2)
put('╬╋', U | D | L | R, 2)
const FILL: Record<string, number> = { '█': 1, '▓': 0.6, '▒': 0.45, '░': 0.25 }

/** One drawn cell: text `t` (w = 1 or 2 columns), a box piece `b` (bits) with style `s`, or a fill `f` (opacity). */
export type Cell = { x: number; y: number; c: string; t?: string; w?: number; b?: number; s?: number; f?: number }
export type Picture = { bg: string; cols: number; rows: number; cells: Cell[] }

/** Turns the art into cells placed on the character grid, as the terminal shows it. */
export function artToPicture(art: Art): Picture {
  const cells: Cell[] = []
  let cols = 0
  art.lines.forEach((line, y) => {
    let x = 0
    for (const seg of line) {
      const c = mid(seg.color)
      for (const ch of seg.text) {
        const w = strWidth(ch)
        if (w === 0) continue
        if (ch !== ' ') {
          const box = BOX[ch]
          if (box) cells.push({ x, y, c, b: box[0], s: box[1] })
          else if (FILL[ch] !== undefined) cells.push({ x, y, c, f: FILL[ch] })
          else cells.push({ x, y, c, t: ch, w })
        }
        x += w
      }
    }
    cols = Math.max(cols, x)
  })
  return { bg: BG, cols, rows: art.lines.length, cells }
}

/** JSON with every non-ASCII character escaped, so it passes through stdin unchanged on any code page. */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
}

// ---------------------------------------------------------------- SVG (Linux)

// the same grid as clip_png.ps1 and clip_png_mac.js: twice the size, so the picture stays sharp
const SCALE = 2
const CW = 8.4 * SCALE
const LH = 18 * SCALE
const PAD = 12 * SCALE

const CJK = "'Noto Sans CJK TC','Noto Sans CJK SC','Noto Sans CJK JP','Noto Sans CJK KR','Source Han Sans TW','WenQuanYi Micro Hei','Droid Sans Fallback','AR PL UMing TW',sans-serif"

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The picture as a transparent SVG: box pieces as lines, fills as rectangles, text placed per cell. */
export function pictureToSvg(pic: Picture): string {
  const W = Math.ceil(PAD * 2 + pic.cols * CW)
  const H = Math.ceil(PAD * 2 + pic.rows * LH)
  const out: string[] = []
  for (const c of pic.cells) {
    const x0 = PAD + c.x * CW
    const y0 = PAD + c.y * LH
    if (c.b !== undefined) {
      const cx = x0 + CW / 2
      const cy = y0 + LH / 2
      const width = c.s === 2 ? 2.4 * SCALE : 1.2 * SCALE
      const dash = c.s === 1 ? ` stroke-dasharray="${SCALE} ${SCALE * 1.5}"` : ''
      const seg = (x1: number, y1: number, x2: number, y2: number) =>
        out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c.c}" stroke-width="${width}"${dash}/>`)
      if (c.b & U) seg(cx, y0, cx, cy)
      if (c.b & D) seg(cx, cy, cx, y0 + LH)
      if (c.b & L) seg(x0, cy, cx, cy)
      if (c.b & R) seg(cx, cy, x0 + CW, cy)
    } else if (c.f !== undefined) {
      out.push(`<rect x="${x0.toFixed(1)}" y="${(y0 + 3 * SCALE).toFixed(1)}" width="${(CW + 0.5).toFixed(1)}" height="${LH - 6 * SCALE}" fill="${c.c}" fill-opacity="${c.f}"/>`)
    } else if (c.t) {
      const w = (c.w ?? 1) * CW
      // a wide character gets a CJK font by name: renderers do not fall back per character
      const family = c.w === 2 ? ` font-family="${CJK}"` : ''
      out.push(`<text x="${x0.toFixed(1)}" y="${(y0 + LH * 0.72).toFixed(1)}" textLength="${w.toFixed(1)}" lengthAdjust="spacingAndGlyphs" fill="${c.c}"${family}>${esc(c.t)}</text>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<g font-family="'DejaVu Sans Mono','Noto Sans Mono','Noto Sans Mono CJK TC','Noto Sans CJK TC',monospace" font-size="${13.5 * SCALE}" xml:space="preserve">
${out.join('\n')}
</g></svg>
`
}

// ---------------------------------------------------------------- platforms

export type Copier =
  | { kind: 'powershell'; exe: string; script: string }
  | { kind: 'mac'; script: string }
  | { kind: 'linux'; convert: string; clip: 'wl-copy' | 'xclip' }

const POWERSHELL = ['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', 'powershell.exe']
const CONVERTERS = ['rsvg-convert', 'magick', 'convert', 'cairosvg', 'inkscape']

async function ok($: EngineInterface, argv: string[], timeoutMs = 20000): Promise<string | null> {
  try {
    const r = await $.process.run(argv, { timeoutMs })
    return r.exitCode === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

/** Finds a way to put a PNG on this machine's clipboard: Windows PowerShell first (also from WSL), then macOS, then Linux tools. */
export async function findCopier($: EngineInterface): Promise<Copier | null> {
  const root = $.plugin.root
  for (const exe of POWERSHELL) {
    if ((await ok($, [exe, '-NoProfile', '-NonInteractive', '-Command', 'exit 0'])) === null) continue
    const local = `${root}/hooks/clip_png.ps1`
    if (!local.startsWith('/')) return { kind: 'powershell', exe, script: local }
    const win = await ok($, ['wslpath', '-w', local])
    if (win) return { kind: 'powershell', exe, script: win }
  }
  const os = await ok($, ['uname', '-s'])
  if (os === 'Darwin') {
    if ((await ok($, ['sh', '-c', 'command -v osascript'])) !== null) return { kind: 'mac', script: `${root}/hooks/clip_png_mac.js` }
    return null
  }
  if (os !== 'Linux') return null
  const has = async (tool: string) => (await ok($, ['sh', '-c', `command -v ${tool}`])) !== null
  let convert: string | undefined
  for (const c of CONVERTERS)
    if (await has(c)) {
      convert = c
      break
    }
  if (!convert) return null
  const wayland = await ok($, ['sh', '-c', 'printf %s "$WAYLAND_DISPLAY"'])
  if (wayland && (await has('wl-copy'))) return { kind: 'linux', convert, clip: 'wl-copy' }
  if (await has('xclip')) return { kind: 'linux', convert, clip: 'xclip' }
  if (await has('wl-copy')) return { kind: 'linux', convert, clip: 'wl-copy' }
  return null
}

/** The command that turns the SVG file into a transparent PNG file. */
function convertArgv(tool: string, svg: string, png: string): string[] {
  switch (tool) {
    case 'rsvg-convert':
      return ['rsvg-convert', '-o', png, svg]
    case 'magick':
      return ['magick', '-background', 'none', svg, png]
    case 'convert':
      return ['convert', '-background', 'none', svg, png]
    case 'cairosvg':
      return ['cairosvg', svg, '-o', png]
    default:
      return ['inkscape', svg, `--export-filename=${png}`]
  }
}

function firstLine(r: { exitCode: number; stdout: string; stderr: string }): string {
  return (r.stderr || r.stdout).trim().split('\n')[0] || `exit ${r.exitCode}`
}

/** Draws the art as a PNG and puts it on the clipboard. Resolves null when done, else why not. */
export async function copyPng($: EngineInterface, copier: Copier, art: Art): Promise<string | null> {
  const pic = artToPicture(art)
  if (copier.kind === 'powershell') {
    const r = await $.process.run(
      [copier.exe, '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', copier.script],
      { stdin: asciiJson(pic), timeoutMs: 60000 },
    )
    return r.exitCode === 0 ? null : firstLine(r)
  }
  if (copier.kind === 'mac') {
    const r = await $.process.run(['osascript', '-l', 'JavaScript', copier.script], { stdin: asciiJson(pic), timeoutMs: 60000 })
    return r.exitCode === 0 ? null : firstLine(r)
  }
  const base = `/tmp/ccmermaid-${Date.now()}`
  const svg = `${base}.svg`
  const png = `${base}.png`
  await $.fs.write(svg, pictureToSvg(pic))
  try {
    const conv = await $.process.run(convertArgv(copier.convert, svg, png), { timeoutMs: 60000 })
    if (conv.exitCode !== 0) return firstLine(conv)
    // both tools read the whole file, then keep serving the clipboard from a background process,
    // so their output goes nowhere and the call returns at once
    const clip =
      copier.clip === 'wl-copy'
        ? 'wl-copy --type image/png < "$1" >/dev/null 2>&1'
        : 'xclip -selection clipboard -t image/png -i "$1" >/dev/null 2>&1'
    const r = await $.process.run(['sh', '-c', clip, 'sh', png], { timeoutMs: 20000 })
    return r.exitCode === 0 ? null : `${copier.clip} exit ${r.exitCode}`
  } finally {
    await ok($, ['rm', '-f', svg, png])
  }
}
