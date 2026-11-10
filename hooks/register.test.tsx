import { expect, test } from 'claude-code/testing'
import { renderMermaid } from './render'

const TEXT = '說明如下：\n\n```mermaid\ngraph LR\n  input --> parse[parse] --> D{valid?}\n  D -- yes --> out\n```\n\n結束。'

const MSG = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'ccmermaid',
    component: 'AssistantMessage',
    requestId: 'm1',
    surface,
    props: { text: TEXT, isFirstOfReply: true },
  }) as const

test('draws the diagram and copies source and art', async ($, on) => {
  const copied: string[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))

  for (const surface of ['terminal', 'desktop'] as const) {
    copied.length = 0
    const ui = await $.ui.mount(MSG(surface))
    expect((await ui.find({ type: 'Text', text: /input/ }))?.text).toContain('input')
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeTruthy()
    await ui.press({ key: 'src-1' })
    await ui.press({ key: 'art-1' })
    expect(copied[0]).toContain('graph LR')
    expect(copied[1]).toContain('┌')
    expect(copied[1]).toContain('valid?')
    await ui.unmount()
  }
})

test('a reply without mermaid is left to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...MSG('terminal'), props: { text: 'hello', isFirstOfReply: true } })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('draws a gitGraph with art copy', async ($, on) => {
  const copied: string[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  const src = [
    "%%{init: { 'gitGraph': { 'mainBranchName': 'trunk' } } }%%",
    'gitGraph',
    '  commit id: "a1b2c3d init"',
    '  branch unused-branch',
    '  checkout trunk',
    '  commit id: "crash 修正（先釋放記憶體）" type: HIGHLIGHT',
    '  branch feature',
    '  checkout feature',
    '  commit id: "add tracing"',
    '  commit id: "網頁與腳本"',
    '  checkout trunk',
    '  merge feature tag: "v1"',
  ].join('\n')
  const ui = await $.ui.mount({ ...MSG('terminal'), props: { text: '圖：\n\n```mermaid\n' + src + '\n```\n', isFirstOfReply: true } })
  await ui.press({ key: 'art-1' })
  expect(copied[0]).toMatch(/◆ +crash/)
  expect(copied[0]).toContain('trunk')
  expect(copied[0]).toContain('╯')
  await ui.unmount()
})

const EXTRA: [string, string, RegExp][] = [
  ['sequence', 'sequenceDiagram\n  Client->>Server: 送出\n  Server-->>Client: 回傳', /▶/],
  ['state', 'stateDiagram-v2\n  [*] --> 追蹤中\n  追蹤中 --> 跟丟: 太低\n  跟丟 --> [*]', /跟丟/],
  ['gantt', 'gantt\n  dateFormat X\n  section CPU\n  pre :0, 3\n  post :3, 5', /█/],
  ['pie', 'pie title 空間\n  "模型" : 60\n  "系統" : 40', /60\.0%/],
  ['mindmap', 'mindmap\n  root((project))\n    backend\n      API', /└─ API/],
  ['timeline', 'timeline\n  10月 : 相機點亮\n  11月 : 上線', /◆ 11月/],
]

for (const [name, src, want] of EXTRA) {
  test(`draws a ${name} diagram`, async ($, on) => {
    const copied: string[] = []
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    on('ui.toast', () => ({ value: undefined }))
    const ui = await $.ui.mount({ ...MSG('terminal'), props: { text: '圖：\n\n```mermaid\n' + src + '\n```\n', isFirstOfReply: true } })
    await ui.press({ key: 'art-1' })
    expect(copied[0]).toMatch(want)
    await ui.unmount()
  })
}

test('a block named after an Object builtin is left as code', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const ui = await $.ui.mount({ ...MSG('terminal'), props: { text: '```mermaid\n' + name + '\n  a --> b\n```\n', isFirstOfReply: true } })
    expect(await ui.find({ type: 'Button', key: 'art-0' })).toBeFalsy()
    await ui.unmount()
  }
})

const BACK = (dir: string) => `flowchart ${dir}
  A[lock] --> T[track]
  T --> R{same?}
  R -- yes --> S[show]
  R -- no --> H[hide]
  H -- too long --> A`

test('a back edge keeps its label and the forward label', () => {
  for (const dir of ['LR', 'TD']) {
    const art = renderMermaid(BACK(dir), 400)!.plain
    expect(art).toContain('yes')
    expect(art).toContain('no')
    expect(art).toContain('too long')
  }
})

test('a left-to-right back edge enters its target from below', () => {
  const rows = renderMermaid(BACK('LR'), 400)!.plain.split('\n')
  const lock = rows.findIndex(r => r.includes('lock'))
  // box text row, its bottom border, then the arrow
  expect(rows[lock + 2]).toContain('▲')
  expect(rows[rows.length - 1]).toContain('too long')
})

test('a top-down back edge enters its target from the right', () => {
  const rows = renderMermaid(BACK('TD'), 400)!.plain.split('\n')
  expect(rows.find(r => r.includes('lock'))).toContain('◄')
})

test('a top-down label sits beside its line', () => {
  const art = renderMermaid('flowchart TD\n  B{x} -- 否 --> C[aaa]\n  B -- 是 --> E[bbb]', 400)!.plain
  expect(art).toMatch(/│ 否/)
  expect(art).toMatch(/│ 是/)
})

test('a two-way pair stays one double-headed line', () => {
  const art = renderMermaid('flowchart LR\n  A[a] --> B[b]\n  B --> A', 400)!.plain
  expect(art).toContain('◄')
  expect(art).toContain('►')
  expect(art).not.toContain('▲')
})

test('a line break in an edge label keeps the drawing on its rows', async ($, on) => {
  const copied: string[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  for (const dir of ['LR', 'TD']) {
    copied.length = 0
    const src = `flowchart ${dir}\n  A[cam<br/>CPU 1.0] -->|960x540<br/>1.5MB| B[crop]\n  B --> C[post]`
    const ui = await $.ui.mount({ ...MSG('terminal'), props: { text: '```mermaid\n' + src + '\n```\n', isFirstOfReply: true } })
    await ui.press({ key: 'art-0' })
    expect(copied[0]).toContain('960x540 / 1.5MB')
    const rows = copied[0].split('\n')
    const widths = rows.filter(r => r.includes('│')).map(r => r.indexOf('│'))
    expect(widths.length).toBeGreaterThan(0)
    await ui.unmount()
  }
})
