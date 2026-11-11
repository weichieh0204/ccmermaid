// Copies a drawn diagram to the clipboard as a PNG image, through Windows PowerShell
// (Windows, or WSL with Windows interop). Elsewhere the button is not shown.

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

type PowerShell = { exe: string; script: string }

const CANDIDATES = ['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', 'powershell.exe']

/** Finds a PowerShell that can reach the Windows clipboard, and the script's path as Windows sees it. */
export async function findPowerShell($: EngineInterface): Promise<PowerShell | null> {
  const local = `${$.plugin.root}/hooks/clip_png.ps1`
  for (const exe of CANDIDATES) {
    try {
      const probe = await $.process.run([exe, '-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { timeoutMs: 20000 })
      if (probe.exitCode !== 0) continue
    } catch {
      continue
    }
    if (!local.startsWith('/')) return { exe, script: local }
    try {
      const win = await $.process.run(['wslpath', '-w', local])
      if (win.exitCode === 0 && win.stdout.trim()) return { exe, script: win.stdout.trim() }
    } catch {
      // no wslpath: a Linux PowerShell, which has no Windows clipboard
    }
  }
  return null
}

/** Draws the art as a PNG and puts it on the Windows clipboard. */
export async function copyPng($: EngineInterface, ps: PowerShell, art: Art): Promise<string | null> {
  const run = await $.process.run(
    [ps.exe, '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', ps.script],
    { stdin: asciiJson(artToPicture(art)), timeoutMs: 60000 },
  )
  if (run.exitCode === 0) return null
  return (run.stderr || run.stdout).trim().split('\n')[0] || `exit ${run.exitCode}`
}
