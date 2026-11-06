import { expect, test } from 'claude-code/testing'

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
