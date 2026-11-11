// Reads a diagram picture as JSON on stdin (from png.ts), draws it as a transparent PNG with AppKit
// and puts it on the macOS clipboard, as PNG and as TIFF for apps that only read that one.
// Run with: osascript -l JavaScript clip_png_mac.js < picture.json
// Cells sit on a character grid: text, box-drawing pieces drawn as real lines, or filled blocks.

ObjC.import('AppKit')

const input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile
const pic = JSON.parse($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding).js)

// the same grid as clip_png.ps1 and pictureToSvg: twice the size, so the picture stays sharp
const S = 2
const CW = 8.4 * S
const LH = 18 * S
const PAD = 12 * S
const W = Math.ceil(PAD * 2 + pic.cols * CW)
const H = Math.ceil(PAD * 2 + pic.rows * LH)

const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
  null, W, H, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0)
$.NSGraphicsContext.saveGraphicsState
$.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))

// AppKit puts y = 0 at the bottom: flip every y of the grid
const fy = y => H - y

const colors = {}
function color(hex, alpha) {
  const key = hex + '/' + alpha
  if (!colors[key]) {
    const n = parseInt(hex.slice(1), 16)
    colors[key] = $.NSColor.colorWithSRGBRedGreenBlueAlpha(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha)
  }
  return colors[key]
}

function font(name, size) {
  const f = $.NSFont.fontWithNameSize(name, size)
  return f.isNil() ? $.NSFont.monospacedSystemFontOfSizeWeight(size, 0) : f
}
const MONO = font('Menlo', 13.5 * S)
const WIDE = font('PingFang TC', 13 * S)

function line(x1, y1, x2, y2, hex, style) {
  color(hex, 1).setStroke
  const width = style === 2 ? 2.4 * S : 1.2 * S
  if (style === 1) {
    // dotted: short dashes along the segment
    const len = Math.hypot(x2 - x1, y2 - y1)
    const on = S
    const step = S * 2.5
    for (let t = 0; t < len; t += step) {
      const a = t / len
      const b = Math.min(len, t + on) / len
      const p = $.NSBezierPath.bezierPath
      p.moveToPoint($.NSMakePoint(x1 + (x2 - x1) * a, fy(y1 + (y2 - y1) * a)))
      p.lineToPoint($.NSMakePoint(x1 + (x2 - x1) * b, fy(y1 + (y2 - y1) * b)))
      p.setLineWidth(width)
      p.stroke
    }
    return
  }
  const p = $.NSBezierPath.bezierPath
  p.moveToPoint($.NSMakePoint(x1, fy(y1)))
  p.lineToPoint($.NSMakePoint(x2, fy(y2)))
  p.setLineWidth(width)
  p.stroke
}

for (const c of pic.cells) {
  const x0 = PAD + c.x * CW
  const y0 = PAD + c.y * LH
  if (c.b !== undefined) {
    // box piece: a line from the cell centre to each side it reaches (1 up, 2 down, 4 left, 8 right)
    const cx = x0 + CW / 2
    const cy = y0 + LH / 2
    if (c.b & 1) line(cx, y0, cx, cy, c.c, c.s)
    if (c.b & 2) line(cx, cy, cx, y0 + LH, c.c, c.s)
    if (c.b & 4) line(x0, cy, cx, cy, c.c, c.s)
    if (c.b & 8) line(cx, cy, x0 + CW, cy, c.c, c.s)
  } else if (c.f !== undefined) {
    color(c.c, c.f).setFill
    $.NSBezierPath.fillRect($.NSMakeRect(x0, fy(y0 + LH - 3 * S), CW + 0.5, LH - 6 * S))
  } else if (c.t) {
    const f = c.w === 2 ? WIDE : MONO
    const attrs = $.NSDictionary.dictionaryWithObjectsForKeys(
      $([f, color(c.c, 1)]),
      $([$.NSFontAttributeName, $.NSForegroundColorAttributeName]))
    // drawAtPoint takes the bottom-left corner of the text line
    const height = f.ascender - f.descender
    $(c.t).drawAtPointWithAttributes($.NSMakePoint(x0, fy(y0 + 1.5 * S + height)), attrs)
  }
}

$.NSGraphicsContext.restoreGraphicsState

const PNG_TYPE = 4 // NSBitmapImageFileTypePNG
const png = rep.representationUsingTypeProperties(PNG_TYPE, $.NSDictionary.dictionary)
const board = $.NSPasteboard.generalPasteboard
board.clearContents
board.setDataForType(png, $.NSPasteboardTypePNG)
board.setDataForType(rep.TIFFRepresentation, $.NSPasteboardTypeTIFF)
