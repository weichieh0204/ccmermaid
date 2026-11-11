import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Art } from './common'
import { copyPng, findCopier } from './png'
import { renderMermaid, splitMermaid } from './render'

async function copy($: EngineInterface, surface: RenderSurface, text: string, what: string) {
  const res = await $.ui.copy({ text, surface })
  $.ui.toast(res.isCopied ? `Copied ${what}` : `Copy failed (${res.reason})`)
}

// The PNG button needs a way to draw and copy an image on this machine. Looked up once per load, in the background.
let copier: Awaited<ReturnType<typeof findCopier>> = null

async function copyImage($: EngineInterface, art: Art) {
  if (!copier) return
  $.ui.toast('Copying diagram image…')
  try {
    const error = await copyPng($, copier, art)
    $.ui.toast(error ? `Image copy failed (${error})` : 'Copied diagram image')
  } catch (err) {
    $.ui.toast(`Image copy failed (${err instanceof Error ? err.message : String(err)})`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    void findCopier($).then(found => {
      copier = found
      if (found) $.ui.invalidate('ui.render')
    })
    return started
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    if (!/(`{3,}|~{3,})[ \t]*mermaid/.test(text)) return next(e)
    const parts = splitMermaid(text)
    if (!parts.some(p => p.kind === 'mermaid')) return next(e)

    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const maxWidth = Math.max(30, (e.viewport?.columns ?? 120) - 4)

    const children = []
    let usedNext = false
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (p.kind === 'md') {
        if (!p.text.trim()) continue
        if (!usedNext && children.length === 0) {
          usedNext = true
          children.push(await next({ ...e, props: { ...e.props, text: p.text.trimEnd() } }))
        } else {
          children.push(<Markdown key={`md-${i}`} text={p.text.trim()} />)
        }
        continue
      }

      const source = p.source
      const art = renderMermaid(source, maxWidth)
      children.push(
        <Box flexDirection="column" marginY={1} paddingLeft={2}>
          <Box
            flexDirection="row"
            justifyContent="flex-end"
            gap={2}
            width={Math.min(maxWidth, Math.max(art ? art.width : 0, 20))}
          >
            <Button
              key={`src-${i}`}
              plain
              dimColor
              label="⧉ source"
              onPress={press => copy($, press.surface, source, 'mermaid source')}
            />
            {art ? (
              <Button
                key={`art-${i}`}
                plain
                dimColor
                label="⧉ art"
                onPress={press => copy($, press.surface, art.plain, 'diagram art')}
              />
            ) : null}
            {art && copier && e.surface === 'terminal' ? (
              <Button key={`png-${i}`} plain dimColor label="⧉ png" onPress={() => copyImage($, art)} />
            ) : null}
          </Box>
          {art ? (
            <Box flexDirection="column">
              {art.lines.map(line => (
                <Text wrap="truncate-end">
                  {line.length === 0 ? ' ' : line.map(s => (s.color ? <Text color={s.color}>{s.text}</Text> : s.text))}
                </Text>
              ))}
            </Box>
          ) : (
            <Markdown key={`raw-${i}`} text={'```mermaid\n' + source + '\n```'} />
          )}
        </Box>,
      )
    }
    return <Box flexDirection="column">{children}</Box>
  })
}
