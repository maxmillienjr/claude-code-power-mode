// Renders the README demo: runs the mod's own hooks under Node with a fake
// engine, drives keystrokes and pastes, and draws every frame the mod would
// paint to a PNG (ImageMagick + Pango), then each scene to a GIF (ffmpeg).
//
//   node tools/demo/capture.mjs            (from the repo root)
//
// Needs esbuild (fetched by npx), ImageMagick with Pango, ffmpeg, and the
// DejaVu Sans Mono font. Output: docs/demo/<scene>.gif and <scene>.png.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, 'docs/demo')
const WORK = mkdtempSync(join(tmpdir(), 'power-mode-demo-'))
const COLUMNS = 72
const BG = '#181818'
const FG = '#d8d8d8'
const DIM = '#6b6b6b'
const FONT = 'DejaVu Sans Mono 13'
const LINE_HEIGHT = 17 * 1024

const bundle = join(WORK, 'register.mjs')
execFileSync('npx', [
  '-y', 'esbuild@0.24.0', join(ROOT, 'hooks/register.tsx'),
  '--bundle', '--format=esm', '--platform=neutral', '--jsx-factory=h', '--jsx-fragment=Fragment',
  `--alias:claude-code=${join(ROOT, 'tools/demo/shim.mjs')}`, `--outfile=${bundle}`, '--log-level=warning',
], { stdio: 'inherit' })

globalThis.h = (type, props, ...children) => ({ type, props: props ?? {}, children })
globalThis.Fragment = 'Fragment'
const { register } = await import(pathToFileURL(bundle).href)

// One session of the mod: its hooks, a fake $, and the draft in the prompt.
function session(options = {}) {
  const hooks = {}
  const on = (event, a, b) => {
    ;(hooks[event] ??= []).push(b ?? a)
    return { catch() {} }
  }
  register(on, { sparkRows: 3, comboTimeout: 8, palette: 'fire', ...options })

  const state = new Map()
  const timers = []
  const element = name => (props, ...children) => ({ type: name, props: props ?? {}, children })
  const $ = {
    state: { peek: r => state.get(r.key), put: (r, v) => state.set(r.key, v) },
    store: { get: async () => undefined, set: async () => {} },
    clock: {
      every: (ms, fn) => {
        const t = { fn, live: true, cancel() { this.live = false } }
        timers.push(t)
        return t
      },
    },
    ui: { blit: async () => ({}), resolve: () => ({ Box: element('Box'), Raster: element('Raster') }) },
    command: { register: async () => ({}) },
    tool: { register: async () => ({}) },
  }
  const fire = async (event, e) => {
    for (const hook of hooks[event] ?? []) await hook($, e, async x => x)
  }

  let draft = ''
  const s = {
    get draft() { return draft },
    set draft(v) { draft = v },
    async start() { await fire('session.start', { cwd: '/' }) },
    async key(ch) {
      const e = { origin: { kind: 'composer' }, key: { input: ch }, text: draft, cursor: draft.length, start: draft.length, end: draft.length, inputText: ch }
      draft += ch
      await fire('prompt.edit', e)
    },
    async paste(text, shown) {
      const e = { origin: { kind: 'composer' }, text: draft, cursor: draft.length, start: draft.length, end: draft.length, inputText: text }
      draft += shown
      await fire('prompt.edit', e)
    },
    async celebrate(level, shout) {
      await fire('tool.call', { tool: 'mcp__power-mode__celebrate', level, ...(shout ? { shout } : {}) })
    },
    tick() {
      for (const t of timers) if (t.live) t.fn()
    },
    // The band as the engine would draw it now: the Raster's props, or null.
    async band() {
      const hook = hooks['ui.render'][0]
      const tree = await hook($, {
        component: 'AbovePrompt', surface: 'terminal', requestId: 'band',
        props: { hasSurvey: false, isWorking: false, maxRows: 24, bodyColumns: COLUMNS, scroll: { offset: 0, bodyRows: 24 }, view: {} },
      }, async () => null)
      const raster = tree?.children?.find(c => c?.props?.key === 'sparks')
      return raster ? raster.props : null
    },
  }

  return s
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const hex = n => '#' + n.toString(16).padStart(6, '0')

// A frame as Pango markup: the band (padded on top to `bandRows`), then the prompt.
function markup(raster, draft, bandRows) {
  const lines = []
  const rows = raster ? raster.rows : 0
  for (let i = rows; i < bandRows; i++) lines.push(' '.repeat(COLUMNS))
  if (raster) {
    const words = new Uint32Array(Buffer.from(raster.cells, 'base64').buffer.slice(0))
    for (let r = 0; r < rows; r++) {
      let line = ''
      for (let c = 0; c < COLUMNS; c++) {
        const i = (r * COLUMNS + c) * 3
        const ch = String.fromCodePoint(words[i])
        const fg = words[i + 1]
        line += fg === 0x01000000 ? esc(ch) : `<span foreground="${hex(fg)}">${esc(ch)}</span>`
      }
      lines.push(line)
    }
  }
  const rule = `<span foreground="${DIM}">${'─'.repeat(COLUMNS)}</span>`
  const shown = draft.length > COLUMNS - 4 ? '…' + draft.slice(-(COLUMNS - 5)) : draft
  lines.push(rule)
  lines.push(`<span foreground="${DIM}">&gt;</span> ${esc(shown)}<span background="${FG}"> </span>`.padEnd(COLUMNS))
  lines.push(rule)

  // A fixed line height (Pango units, 1/1024 pt): a fallback glyph would
  // otherwise make its line taller and the frames differ in size.
  return `<span font="${FONT}" foreground="${FG}" line_height="${LINE_HEIGHT}">${lines.join('\n')}</span>`
}

let frameNo = 0
async function capture(dir, s, bandRows) {
  const file = join(dir, `f${String(frameNo++).padStart(4, '0')}`)
  // Inline, not pango:@file: ImageMagick's default policy refuses @ paths.
  const text = markup(await s.band(), s.draft, bandRows)
  // Every frame of a scene on one fixed canvas: ffmpeg stops at a size change.
  const height = (bandRows + 3) * 17 + 6
  execFileSync('convert', [
    '-background', BG, `pango:${text}`, '-gravity', 'northwest', '-extent', `${COLUMNS * 10 + 4}x${height}`,
    '-bordercolor', BG, '-border', '18x14', file + '.png',
  ])
}

// Runs a scene and writes docs/demo/<name>.gif plus the still at `still`.
async function scene(name, bandRows, script, still) {
  const dir = join(WORK, name)
  mkdirSync(dir, { recursive: true })
  frameNo = 0
  const frames = []
  const snap = async s => {
    await capture(dir, s, bandRows)
    frames.push(frameNo - 1)
  }
  await script(snap)
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', '30', '-i', join(dir, 'f%04d.png'),
    // 15 fps, a small palette and only the changed rectangle per frame keep a
    // README GIF to a few hundred KB.
    '-vf', 'fps=15,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle',
    join(OUT, `${name}.gif`),
  ])
  const pick = Math.min(still, frames.length - 1)
  execFileSync('cp', [join(dir, `f${String(pick).padStart(4, '0')}.png`), join(OUT, `${name}.png`)])
  console.log(`${name}: ${frames.length} frames`)
}

// Types `text` at about 15 keys a second, snapping every frame.
async function typeOut(s, snap, text) {
  for (const ch of text) {
    await s.key(ch)
    for (let f = 0; f < 2; f++) {
      s.tick()
      await snap(s)
    }
  }
}

// Builds the combo up to `n` off camera, then lets the effects settle.
async function warm(s, n) {
  for (let i = 0; i < n; i++) {
    await s.key('x')
    s.tick()
  }
  for (let f = 0; f < 60; f++) s.tick()
  s.draft = ''
}

const tail = async (s, snap, frames) => {
  for (let f = 0; f < frames; f++) {
    s.tick()
    await snap(s)
  }
}

mkdirSync(OUT, { recursive: true })

await scene('typing', 4, async snap => {
  const s = session()
  await s.start()
  await typeOut(s, snap, 'refactor the parser so it streams tokens instead of ')
  await tail(s, snap, 30)
}, 75)

await scene('on-fire', 4, async snap => {
  const s = session()
  await s.start()
  await warm(s, 44)
  await typeOut(s, snap, 'add retries with exponential backoff')
  await tail(s, snap, 20)
}, 40)

await scene('unstoppable', 4, async snap => {
  const s = session()
  await s.start()
  await warm(s, 92)
  await typeOut(s, snap, 'write the migration and the rollback')
  await tail(s, snap, 20)
}, 30)

await scene('godlike', 4, async snap => {
  const s = session()
  await s.start()
  await warm(s, 244)
  await typeOut(s, snap, 'ship it, then tell me what broke')
  await tail(s, snap, 20)
}, 26)

await scene('nuke', 11, async snap => {
  const s = session()
  await s.start()
  await typeOut(s, snap, 'explain this stack trace: ')
  await s.paste('x'.repeat(1800), '[Pasted text #1 +42 lines]')
  await tail(s, snap, 100)
}, 78)

// Claude's celebrations, one per level, after a reply that earned it.
const CELEBRATIONS = [
  [1, '', 'fixed the off-by-one in the pager', 4, 4],
  [2, '', 'tests pass locally and in CI', 24, 7],
  [3, 'ALL GREEN!', 'the flaky suite is green 50 runs in a row', 30, 11],
  [4, 'V1.0 IS LIVE!', 'released 1.0 to npm and tagged it', 44, 11],
  [5, 'SHIPPED!', 'the migration is done: 0 errors', 48, 11],
]
for (const [level, shout, draft, still, bandRows] of CELEBRATIONS) {
  await scene(`celebrate-${level}`, bandRows, async snap => {
    const s = session()
    await s.start()
    s.draft = draft
    await snap(s)
    await s.celebrate(level, shout)
    await tail(s, snap, level === 4 ? 110 : level === 5 ? 100 : 60)
  }, still)
}

if (!process.env.KEEP) rmSync(WORK, { recursive: true, force: true })
else console.log('frames kept in', WORK)
