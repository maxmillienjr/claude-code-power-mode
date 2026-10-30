import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'power-mode',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 60,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// The engine beneath the plugin: it draws its own band as one Text, applies
// edits, and takes every blit.
function engine(on: On) {
  const clock = mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'power-mode' } }))
  on('tool.register', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  return clock
}

async function type($: Parameters<Parameters<typeof test>[1]>[0], text: string) {
  let draft = ''
  for (const ch of text) {
    await $.prompt.edit({
      origin: { kind: 'composer' },
      text: draft,
      cursor: draft.length,
      start: draft.length,
      end: draft.length,
      inputText: ch,
      key: { input: ch },
    } as never)
    draft += ch
  }
}

test('the band is the engine own until a key is typed', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ key: 'sparks' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /engine band/ }))?.text).toBe('engine band')
  await ui.unmount()
})

test('typing draws sparks above the engine band, then it goes quiet', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  await type($, 'hello')
  await clock.settle()

  const raster = await ui.find({ key: 'sparks' })
  expect(raster).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()

  // Past the combo timeout and every spark's life, the band is the engine's again.
  await clock.advance(10_000)
  expect(await ui.find({ key: 'sparks' })).toBeUndefined()
  await ui.unmount()
})

test('/power-mode turns it off, and typing then draws nothing', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ran = await $.command.run({ command: 'power-mode', args: '' } as never)
  expect(JSON.stringify(ran)).toContain('Power Mode off')

  const ui = await $.ui.mount(BAND)
  await type($, 'hello')
  await clock.settle()
  expect(await ui.find({ key: 'sparks' })).toBeUndefined()
  await ui.unmount()
})

// The text a Raster's cells spell, row by row.
function spell(props: Record<string, unknown>): string {
  const bytes = Uint8Array.from(atob(String(props.cells)), c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const columns = Number(props.columns)
  let out = ''
  for (let i = 0; i < words.length / 3; i++) {
    out += String.fromCharCode(words[i * 3] ?? 32) + ((i + 1) % columns === 0 ? '\n' : '')
  }

  return out
}

test('reaching a tier shouts its name on the right; the bottom row is only the bar', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  await type($, 'x'.repeat(26))
  await clock.advance(33)

  const lines = spell((await ui.find({ key: 'sparks' }))!.props).split('\n')
  expect(lines.join('\n')).toContain('HEATING UP!')
  expect(lines[3]).not.toContain('HEATING UP')
  expect(lines[3]).not.toContain('26')
  expect(lines[3]).toContain('\u2501')
  await ui.unmount()
})

// A paste of `text` at the start of an empty prompt.
async function paste($: Parameters<Parameters<typeof test>[1]>[0], text: string) {
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: text } as never)
}

test('a paste is a blast in the usual band, not a nuke', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  await paste($, 'y'.repeat(300))
  await clock.advance(132)
  const raster = await ui.find({ key: 'sparks' })
  expect(raster?.props.rows).toBe(4)
  // The fireball is shaded blocks on the ground row, under the tier row.
  expect(spell(raster!.props).split('\n')[2]).toMatch(/[\u2591-\u2593\u2588]/)
  await ui.unmount()
})

test('a paste of 1,000 characters is a big blast: the band grows, then shrinks back', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  await paste($, 'y'.repeat(1500))
  await clock.advance(33)
  expect((await ui.find({ key: 'sparks' }))?.props.rows).toBe(7)

  await clock.advance(2000)
  expect((await ui.find({ key: 'sparks' }))?.props.rows).toBe(4)
  await ui.unmount()
})

test('a collapsed paste placeholder is a big blast too', async ($, on) => {
  const clock = engine(on)
  on('prompt.change', () => ({}))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  await paste($, '[Pasted text #1 +19 lines]')
  await clock.advance(33)
  expect((await ui.find({ key: 'sparks' }))?.props.rows).toBe(7)
  await ui.unmount()
})

test('Claude celebrates a big win with its shout in the sky', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  const ran = await $.tool.call({ tool: 'mcp__power-mode__celebrate', level: 3, shout: 'ALL GREEN!' } as never)
  expect(JSON.stringify(ran)).toContain('level 3')
  await clock.advance(33)

  const raster = await ui.find({ key: 'sparks' })
  expect(spell(raster!.props)).toContain('ALL GREEN!')
  await ui.unmount()
})

test('level 5 is the nuke, the only one', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  await $.tool.call({ tool: 'mcp__power-mode__celebrate', level: 5 } as never)
  await clock.advance(33)
  expect((await ui.find({ key: 'sparks' }))?.props.rows).toBe(11)
  await ui.unmount()
})

test('levels 2 and 3 grow the band for the fireworks, then it shrinks back', async ($, on) => {
  const clock = engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount(BAND)
  await $.tool.call({ tool: 'mcp__power-mode__celebrate', level: 2 } as never)
  await clock.advance(33)
  expect((await ui.find({ key: 'sparks' }))?.props.rows).toBe(7)

  await $.tool.call({ tool: 'mcp__power-mode__celebrate', level: 3, shout: 'BIG' } as never)
  await clock.advance(33)
  expect((await ui.find({ key: 'sparks' }))?.props.rows).toBe(11)

  await clock.advance(6000)
  expect(await ui.find({ key: 'sparks' })).toBeUndefined()
  await ui.unmount()
})
