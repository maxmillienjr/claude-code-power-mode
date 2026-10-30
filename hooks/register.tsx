import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isActive = atom({ plugin: 'power-mode', key: 'isActive' } as const, false)
const isEnabled = atom({ plugin: 'power-mode', key: 'isEnabled' } as const, true)
// The band grows for a big paste and for the bigger celebrations.
const isTall = atom({ plugin: 'power-mode', key: 'isTall' } as const, false)

const TICK_MS = 33
// Columns the prompt draws before the draft ("> "), so sparks leave the caret.
const PROMPT_INDENT = 2
const DEFAULT_COLOR = 0x01000000
const SPACE = 0x20
const BAR = 0x2501 // ━
const MILESTONE = 25
const EXCLAIM_MS = 1600
const SHAKE_MS = 110
const GRAVITY = 70 // braille dots per second squared
const BLAST_PASTE = 100 // a paste this many characters long is a blast
const BIG_PASTE = 1000 // and this many, or a collapsed paste, a big one
const BLAST_MS = 900
const BIG_BLAST_MS = 1300
const BIG_BLAST_ROWS = 6
const NUKE_MS = 2800 // the nuke is Claude's alone, level 5
const NUKE_ROWS = 10 // the band grows to this many spark rows for a nuke, room allowing
const CELEBRATE = 'celebrate'
const VOLLEY_MS = 350 // between rocket volleys at level 4
const STAR_MS = 220 // how long a firework fragment shows as a star
const LEVEL_SHOUTS = ['', 'Nice!', 'Boom!', 'Huge!', 'LEGENDARY!', 'KABOOM!']
// What a long paste becomes in the prompt box: the mod may see this, not the text.
const PASTE_PLACEHOLDER = /\[Pasted text #(\d+)/g

const EXCLAMATIONS = [
  'Super!', 'Radical!', 'Fantastic!', 'Great!', 'OMG!', 'Whoah!', 'Nice!',
  'Splendid!', 'Wild!', 'Grand!', 'Impressive!', 'Stupendous!', 'Extreme!', 'Awesome!',
]
const BLAST_WORDS = ['BLAM!', 'KAPOW!', 'WHAM!', 'KRAK!', 'BOOM!']
const BIG_BLAST_WORDS = ['KABOOM!', 'KA-BLAM!', 'MEGA PASTE!', 'BIG ONE!']

// Each tier changes how the sparks behave, not only their number.
type Tier = { at: number; name: string; sparks: number; speed: number; flames: number; fireworks: boolean }
const TIERS: readonly Tier[] = [
  { at: 0, name: '', sparks: 4, speed: 1, flames: 0, fireworks: false },
  { at: 25, name: 'HEATING UP', sparks: 6, speed: 1.15, flames: 0, fireworks: false },
  { at: 50, name: 'ON FIRE', sparks: 8, speed: 1.3, flames: 0.5, fireworks: false },
  { at: 100, name: 'UNSTOPPABLE', sparks: 10, speed: 1.4, flames: 0.75, fireworks: true },
  { at: 250, name: 'GODLIKE', sparks: 12, speed: 1.5, flames: 1, fireworks: true },
]

const FIRE = [0xffe066, 0xffb000, 0xff7a00, 0xff4500, 0xff2a2a]
const RAINBOW = [0xff4d4d, 0xffa64d, 0xffff4d, 0x4dff88, 0x4dd2ff, 0x9966ff, 0xff66cc]
const PALETTES: Record<string, readonly number[]> = {
  fire: FIRE,
  rainbow: RAINBOW,
  ice: [0xffffff, 0xc8f0ff, 0x8fdcff, 0x4fb8ff, 0x7f9cff],
  matrix: [0xd0ffd0, 0x7dff7d, 0x33ff33, 0x00cc44, 0x009933],
}

// Braille dot bits inside one cell (2 wide, 4 tall), indexed row * 2 + column.
const DOT = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80]
const FLAME_GLYPHS = [0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587] // ▁ to ▇
const SHADES = [0x2591, 0x2592, 0x2593, 0x2588] // ░ ▒ ▓ █
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// `h` is height above the bottom of the spark rows, in braille dots, so a
// particle stays put when the band grows for a nuke.
// A `star` is a fresh firework fragment, drawn as a full `*` before it fades to a dot.
type Particle = { x: number; h: number; vx: number; vh: number; age: number; life: number; color: number; fuse: number; star?: boolean }
type Geometry = { requestId: string; columns: number; rows: number }
// `ms` is how long it shows; a big celebration holds its shout for the whole show.
type Exclamation = { text: string; age: number; color: number; ms: number }
type Nuke = { age: number; column: number }
type Blast = { age: number; column: number; isBig: boolean }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(n)))
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T
const hash = (n: number) => {
  const s = Math.sin(n * 12.9898) * 43758.5453

  return s - Math.floor(s)
}

function tierOf(combo: number): number {
  let tier = 0
  TIERS.forEach((t, i) => {
    if (combo >= t.at) tier = i
  })

  return tier
}

function scale(rgb: number, k: number): number {
  const r = Math.round(((rgb >> 16) & 0xff) * k)
  const g = Math.round(((rgb >> 8) & 0xff) * k)
  const b = Math.round((rgb & 0xff) * k)

  return (r << 16) | (g << 8) | b
}

function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += BASE64.charAt(n >> 18) + BASE64.charAt((n >> 12) & 63)
    out += i + 1 < bytes.length ? BASE64.charAt((n >> 6) & 63) : '='
    out += i + 2 < bytes.length ? BASE64.charAt(n & 63) : '='
  }

  return out
}

export const register: Register = (on, options) => {
  const sparkRows = clamp(Number(options.sparkRows ?? 3), 1, 8)
  const timeoutMs = Math.max(1, Number(options.comboTimeout ?? 8)) * 1000
  const palette = PALETTES[String(options.palette ?? 'fire')] ?? FIRE

  // Animation lives in module variables: it is gone in a second anyway, so a
  // reload losing it costs nothing. Only what the drawing branches on is state.
  let timer: { cancel: () => void } | undefined
  let geometry: Geometry | undefined
  let particles: Particle[] = []
  let exclamation: Exclamation | undefined
  let nuke: Nuke | undefined
  let blast: Blast | undefined
  let combo = 0
  let best = 0
  let t = 0
  let lastHitAt = 0
  let shakeUntil = 0
  // Rocket volleys still to launch for a level-4 celebration, by frame time.
  let volleys: number[] = []
  // While `tall`, the band is `tallRows` spark rows (room allowing) until `tallUntil`.
  let tall = false
  let tallRows = NUKE_ROWS
  let tallUntil = 0
  let maxRowsSeen = 24

  function grow(rows: number, ms: number) {
    tall = true
    tallRows = Math.max(rows, nuke !== undefined ? NUKE_ROWS : 0)
    tallUntil = Math.max(tallUntil, t + ms)
  }

  // Spark rows the band has, or is about to have: what rockets aim for.
  const bandRows = () => (tall ? clamp(Math.min(tallRows, maxRowsSeen - 2), sparkRows, NUKE_ROWS) : sparkRows)
  const seenPastes = new Set<string>()

  // Placeholder ids in `text` not seen before: each one is a long paste.
  function newPastes(text: string): number {
    let found = 0
    for (const m of text.matchAll(PASTE_PLACEHOLDER)) {
      const id = m[1] ?? ''
      if (!seenPastes.has(id)) {
        seenPastes.add(id)
        found += 1
      }
    }

    return found
  }

  // One animation frame from a timer: what the hook that owns the timer must do.
  function tick(): { saveBest: boolean; shrink: boolean; stop: boolean; cells?: string } {
    const { expired, shrink, idle } = step()

    return { saveBest: expired, shrink, stop: idle, cells: !idle && geometry !== undefined ? frame() : undefined }
  }

  const colorsNow = () => (tierOf(combo) === TIERS.length - 1 ? RAINBOW : palette)

  function burst(column: number, count: number, spread: number, speed: number, fireworks = false, star = false) {
    for (let i = 0; i < count; i++) {
      particles.push({
        x: column * 2 + 1 + (Math.random() - 0.5) * spread,
        h: 0.5,
        vx: (Math.random() - 0.5) * 50 * speed,
        vh: (25 + Math.random() * 30) * speed,
        age: 0,
        life: 450 + Math.random() * 500,
        color: pick(colorsNow()),
        fuse: fireworks && Math.random() < 0.15 ? 250 + Math.random() * 200 : 0,
        star,
      })
    }
    if (particles.length > 600) particles = particles.slice(-600)
  }

  // Debris thrown low and wide to both sides of a blast.
  function debris(column: number, count: number, isBig: boolean) {
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1
      particles.push({
        x: column * 2 + 1,
        h: 0.5,
        vx: side * (30 + Math.random() * (isBig ? 90 : 60)),
        vh: 12 + Math.random() * (isBig ? 34 : 22),
        age: 0,
        life: 500 + Math.random() * 500,
        color: pick(colorsNow()),
        fuse: 0,
        star: isBig,
      })
    }
    if (particles.length > 600) particles = particles.slice(-600)
  }

  function drawNuke(n: Nuke, columns: number, spark: number, glyph: Uint32Array, fg: Uint32Array) {
    const k = n.age / NUKE_MS
    const cell = (y: number, c: number) => (spark - 1 - y) * columns + c

    // The flash: every spark cell white, then a hot yellow.
    if (n.age < 160) {
      for (let i = 0; i < spark * columns; i++) {
        glyph[i] = n.age < 80 ? 0x2588 : 0x2593
        fg[i] = n.age < 80 ? 0xffffff : 0xffee88
      }
      return
    }

    const rise = 1 - Math.pow(1 - Math.min(1, n.age / 1200), 3)
    const capY = 1 + rise * Math.max(0, spark - 2.5)
    const capW = 2 + rise * Math.min(spark * 2.4, columns / 4)
    const capH = 0.6 + rise * spark * 0.22
    const stemW = 0.6 + rise * 0.9
    const fade = k > 0.75 ? (1 - k) / 0.25 : 1
    const boil = Math.floor(n.age / 90)

    for (let y = 0; y < spark; y++) {
      for (let c = 0; c < columns; c++) {
        const dx = c - n.column
        let d = 0

        const inCap = (dx / capW) ** 2 + ((y - capY) / capH) ** 2
        if (inCap <= 1) d = Math.max(d, 1 - inCap)

        const flare = stemW * (1 + 1.5 * Math.max(0, 1 - y / Math.max(capY, 1)))
        if (y < capY && Math.abs(dx) <= flare) d = Math.max(d, 0.85 - (0.5 * Math.abs(dx)) / flare)

        // The dust skirt along the ground.
        const skirt = capW * 1.4 * rise
        if (y === 0 && Math.abs(dx) < skirt) d = Math.max(d, 0.35 * (1 - Math.abs(dx) / skirt))

        if (d <= 0) continue
        d = (d + (hash(c * 7.1 + y * 13.7 + boil) - 0.5) * 0.35) * fade
        if (d < 0.1) continue

        const heat = d * 1.2 - k * 1.1 + 0.4
        glyph[cell(y, c)] = SHADES[d > 0.75 ? 3 : d > 0.5 ? 2 : d > 0.28 ? 1 : 0] ?? SPACE
        fg[cell(y, c)] =
          heat > 0.8 ? 0xfff2b0 : heat > 0.6 ? 0xffb000 : heat > 0.4 ? 0xff5a00 : heat > 0.2 ? 0xb03020 : scale(0x9a9a9a, Math.max(0.3, 1 - k))
      }
    }

    // The shockwave runs out along the ground both ways.
    const radius = (n.age / 1000) * 70
    if (radius < columns) {
      for (const c of [n.column - radius, n.column + radius]) {
        for (let w = 0; w < 2; w++) {
          const at = Math.round(c) + (c < n.column ? w : -w)
          if (at < 0 || at >= columns) continue
          glyph[cell(0, at)] = SHADES[1 - w] ?? SPACE
          fg[cell(0, at)] = scale(0xff9a3a, Math.max(0.3, 1 - radius / columns))
        }
      }
    }
  }

  // A paste: a fireball on the ground at the paste, then a shockwave both ways.
  function drawBlast(b: Blast, columns: number, spark: number, glyph: Uint32Array, fg: Uint32Array) {
    const ms = b.isBig ? BIG_BLAST_MS : BLAST_MS
    const k = b.age / ms
    const cell = (y: number, c: number) => (spark - 1 - y) * columns + c
    const swell = 1 - Math.pow(1 - Math.min(1, b.age / 220), 2)
    const ry = (b.isBig ? 3.2 : 1.8) * swell
    const rx = ry * 2.4
    const fade = b.age < 180 ? 1 : Math.max(0, 1 - (b.age - 180) / (ms * 0.45))
    const boil = Math.floor(b.age / 70)

    if (fade > 0) {
      for (let y = 0; y < Math.min(spark, Math.ceil(ry)); y++) {
        for (let c = Math.max(0, Math.floor(b.column - rx)); c <= Math.min(columns - 1, b.column + rx); c++) {
          const inBall = ((c - b.column) / rx) ** 2 + (y / ry) ** 2
          if (inBall > 1) continue
          const d = (1 - inBall + (hash(c * 5.3 + y * 11.1 + boil) - 0.5) * 0.4) * fade
          if (d < 0.12) continue
          glyph[cell(y, c)] = b.age < 70 ? 0x2588 : (SHADES[d > 0.7 ? 3 : d > 0.45 ? 2 : d > 0.25 ? 1 : 0] ?? SPACE)
          fg[cell(y, c)] = b.age < 70 ? 0xffffff : d > 0.7 ? 0xfff2b0 : d > 0.45 ? 0xffb000 : d > 0.25 ? 0xff5a00 : 0xb03020
        }
      }
    }

    // The shockwave runs out along the ground both ways.
    const radius = rx + (b.age / 1000) * (b.isBig ? 80 : 55)
    if (k < 0.8) {
      for (const c of [b.column - radius, b.column + radius]) {
        for (let w = 0; w < 2; w++) {
          const at = Math.round(c) + (c < b.column ? w : -w)
          if (at < 0 || at >= columns) continue
          glyph[cell(0, at)] = SHADES[1 - w] ?? SPACE
          fg[cell(0, at)] = scale(0xff9a3a, Math.max(0.3, 1 - k / 0.8))
        }
      }
    }
  }

  function frame(): string {
    const columns = geometry?.columns ?? 1
    const rows = geometry?.rows ?? sparkRows + 1
    const spark = rows - 1
    const height = spark * 4
    const glyph = new Uint32Array(columns * rows).fill(SPACE)
    const fg = new Uint32Array(columns * rows).fill(DEFAULT_COLOR)
    const freshest = new Float64Array(columns * rows).fill(Infinity)
    const tier = TIERS[tierOf(combo)] ?? TIERS[0]!
    const left = combo > 0 ? Math.max(0, 1 - (t - lastHitAt) / timeoutMs) : 0

    // Flames along the bottom spark row from ON FIRE up, dying with the timer.
    if (tier.flames > 0 && left > 0) {
      const base = (spark - 1) * columns
      for (let c = 0; c < columns; c++) {
        const wave = 0.5 + 0.5 * Math.sin(c * 0.9 + t * 0.011) * Math.sin(c * 0.37 - t * 0.017 + hash(c) * 6)
        const level = wave * tier.flames * left
        if (level < 0.15) continue
        glyph[base + c] = FLAME_GLYPHS[Math.min(6, Math.floor(level * 7))] ?? SPACE
        fg[base + c] = level > 0.7 ? 0xffd040 : level > 0.4 ? 0xff7a00 : 0xd02a10
      }
    }

    if (nuke !== undefined) drawNuke(nuke, columns, spark, glyph, fg)
    if (blast !== undefined) drawBlast(blast, columns, spark, glyph, fg)

    for (const p of particles) {
      const dx = Math.floor(p.x)
      const dy = height - 1 - Math.floor(p.h)
      if (dx < 0 || dy < 0 || dx >= columns * 2 || dy >= height) continue
      const i = Math.floor(dy / 4) * columns + Math.floor(dx / 2)
      const held = glyph[i] ?? SPACE
      if (p.star && p.age < STAR_MS) {
        if (held === SPACE || (held >= 0x2800 && held <= 0x28ff)) {
          glyph[i] = 0x2a // *
          fg[i] = p.color
          freshest[i] = -1
        }
        continue
      }
      // Sparks draw over empty cells and other sparks, never over cloud, flame or a star.
      if (held !== SPACE && (held < 0x2800 || held > 0x28ff)) continue
      glyph[i] = (held === SPACE ? 0x2800 : held) | (DOT[(dy % 4) * 2 + (dx % 2)] ?? 0)
      if (p.age < (freshest[i] ?? Infinity)) {
        freshest[i] = p.age
        fg[i] = scale(p.color, Math.max(0.25, 1 - p.age / p.life))
      }
    }

    // The exclamation floats up the right side of the spark rows.
    if (exclamation !== undefined) {
      const k = exclamation.age / exclamation.ms
      const row = clamp((spark - 1) * (1 - k), 0, spark - 1)
      const jitter = exclamation.age < 300 ? Math.round((Math.random() - 0.5) * 2) : 0
      const start = clamp(columns - exclamation.text.length - 2 + jitter, 0, columns)
      const color = scale(exclamation.color, Math.max(0.35, 1 - k * 0.8))
      for (let c = 0; c < exclamation.text.length && start + c < columns; c++) {
        glyph[row * columns + start + c] = exclamation.text.charCodeAt(c)
        fg[row * columns + start + c] = color
      }
    }

    // The last row: the timer bar, jolted on a hit. The tier's name is shouted
    // on the right as it is reached, so this row carries no words.
    if (combo > 0) {
      const base = spark * columns
      const shake = t < shakeUntil ? Math.round(Math.random() * 2) : 0
      const colors = colorsNow()
      const level =
        colors === RAINBOW
          ? (RAINBOW[Math.floor(t / 100) % RAINBOW.length] ?? 0xffffff)
          : (colors[Math.min(tierOf(combo), colors.length - 1)] ?? 0xffffff)
      const barStart = clamp(1 + shake, 0, columns)
      const barLength = Math.round(Math.max(0, columns - barStart - 1) * left)
      for (let c = 0; c < barLength; c++) {
        glyph[base + barStart + c] = BAR
        fg[base + barStart + c] = scale(level, 0.35 + 0.65 * left)
      }
    }

    const words = new Uint32Array(columns * rows * 3)
    for (let i = 0; i < columns * rows; i++) {
      words[i * 3] = glyph[i] ?? SPACE
      words[i * 3 + 1] = fg[i] ?? DEFAULT_COLOR
      words[i * 3 + 2] = DEFAULT_COLOR
    }

    return toBase64(new Uint8Array(words.buffer))
  }

  // Advances one frame. `expired` says the combo just ran out, `shrink` that
  // the band can go back to its size, `idle` that the timer should stop.
  function step(): { expired: boolean; shrink: boolean; idle: boolean } {
    t += TICK_MS
    const dt = TICK_MS / 1000
    const born: Particle[] = []

    for (const p of particles) {
      p.age += TICK_MS
      p.vh -= GRAVITY * dt
      p.x += p.vx * dt
      p.h += p.vh * dt
      // A firework bursts into a ring when its fuse runs out.
      if (p.fuse > 0 && p.age >= p.fuse) {
        p.life = 0
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2
          const v = 18 + Math.random() * 8
          born.push({ x: p.x, h: p.h, vx: Math.cos(a) * v * 2, vh: Math.sin(a) * v, age: 0, life: 520, color: p.color, fuse: 0, star: true })
        }
      }
    }
    particles = particles.filter(p => p.age < p.life).concat(born)

    if (exclamation !== undefined) {
      exclamation.age += TICK_MS
      if (exclamation.age > exclamation.ms) exclamation = undefined
    }

    if (nuke !== undefined) {
      nuke.age += TICK_MS
      if (nuke.age > NUKE_MS) nuke = undefined
    }

    if (blast !== undefined) {
      blast.age += TICK_MS
      if (blast.age > (blast.isBig ? BIG_BLAST_MS : BLAST_MS)) blast = undefined
    }

    let shrink = false
    if (tall && nuke === undefined && volleys.length === 0 && t >= tallUntil) {
      tall = false
      shrink = true
    }

    while (volleys.length > 0 && (volleys[0] ?? Infinity) <= t) {
      volleys.shift()
      launchRockets(4, true)
    }

    const expired = combo > 0 && t - lastHitAt > timeoutMs
    if (expired) endCombo()

    return {
      expired,
      shrink,
      idle:
        combo === 0 &&
        particles.length === 0 &&
        exclamation === undefined &&
        nuke === undefined &&
        blast === undefined &&
        volleys.length === 0,
    }
  }

  function endCombo() {
    best = Math.max(best, combo)
    combo = 0
  }

  function exclaim(text: string, colors: readonly number[] = colorsNow(), ms = EXCLAIM_MS) {
    exclamation = { text, age: 0, color: pick(colors), ms }
  }

  // Rockets from random columns that climb to between half and nine tenths of
  // the band and burst into rings at the top of their arc, so they burst in
  // view however tall the band is.
  function launchRockets(count: number, rainbow: boolean) {
    const width = geometry?.columns ?? 80
    const height = bandRows() * 4
    for (let i = 0; i < count; i++) {
      const vh = Math.sqrt(2 * GRAVITY * height * (0.5 + Math.random() * 0.4))
      particles.push({
        x: (4 + Math.random() * (width - 8)) * 2,
        h: 0.5,
        vx: (Math.random() - 0.5) * 10,
        vh,
        age: 0,
        life: 4000,
        color: pick(rainbow ? RAINBOW : palette),
        fuse: (vh / GRAVITY) * 1000,
      })
    }
  }

  // Claude's own celebration: 1 a few sparks, 2 fireworks, 3 a finale with a
  // shout, 4 volleys of rainbow fireworks, 5 the nuke. Returns whether the band grows.
  function celebrate(level: number, shout: string): boolean {
    const width = geometry?.columns ?? 80
    const words = shout.trim().slice(0, 28) || (LEVEL_SHOUTS[level] ?? '')

    if (level >= 5) {
      nuke = { age: 0, column: Math.floor(width / 2) }
      grow(NUKE_ROWS, NUKE_MS)
      burst(nuke.column, 120, 30, 1.8, true)
      exclaim(words, RAINBOW)
      return true
    }
    if (level === 1) {
      for (let i = 0; i < 3; i++) burst(4 + Math.floor(Math.random() * (width - 8)), 6, 2, 1, false, true)
    }
    if (level >= 2) grow(level === 2 ? 6 : NUKE_ROWS, level === 4 ? 5 * VOLLEY_MS + 2200 : 2400)
    if (level === 2) launchRockets(4, false)
    if (level === 3) {
      launchRockets(8, true)
      exclaim(words, RAINBOW, 2400)
    }
    if (level === 4) {
      launchRockets(6, true)
      volleys = [1, 2, 3, 4, 5].map(n => t + n * VOLLEY_MS)
      exclaim(words, RAINBOW, 5 * VOLLEY_MS + 1800)
    }
    if (level === 2 && shout.trim()) exclaim(words)

    return level >= 2
  }

  // A hit of `chars` characters at `column`. Returns whether the band grows,
  // as it does for a big paste (`isBig`: 1,000 characters or a collapsed one).
  function hit(column: number, chars: number, isPaste: boolean, isBig = false): boolean {
    const before = combo
    combo += isPaste ? chars : 1
    lastHitAt = t
    shakeUntil = t + SHAKE_MS
    const tier = tierOf(combo)
    const spec = TIERS[tier] ?? TIERS[0]!
    const width = geometry?.columns ?? 80

    if (isPaste && (isBig || chars >= BLAST_PASTE)) {
      const big = isBig || chars >= BIG_PASTE
      blast = { age: 0, column: clamp(column, 4, Math.max(4, width - 5)), isBig: big }
      debris(blast.column, big ? 70 : 36, big)
      exclaim(pick(big ? BIG_BLAST_WORDS : BLAST_WORDS))
      if (big) grow(BIG_BLAST_ROWS, BIG_BLAST_MS + 300)
      return big
    }

    if (isPaste) burst(column, 40, 16, 1.4, spec.fireworks)
    else burst(column, spec.sparks, 1, spec.speed, spec.fireworks)

    if (tier > tierOf(before)) {
      exclaim(`${spec.name}!`)
      for (let c = 2; c < width; c += 5) burst(c, 3, 4, spec.speed, spec.fireworks)
    } else if (Math.floor(combo / MILESTONE) > Math.floor(before / MILESTONE)) {
      exclaim(pick(EXCLAMATIONS))
      burst(column, 30, 20, spec.speed, spec.fireworks)
    }

    return false
  }

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: CELEBRATE,
      description:
        'Throws a celebration animation above the prompt (Power Mode). Call it only for a real win the ' +
        'person would cheer: tests green after a fight, a hard bug found, a deploy or release landing, a ' +
        'big refactor done. Never for routine answers, and at most once a turn. Pick the level by how big ' +
        'the moment is: 1 a small win (a few sparks), 2 a solid one (fireworks), 3 a big one (a fireworks ' +
        'finale with your shout), 4 a milestone (volleys of rainbow fireworks), 5 rare, a once-a-project ' +
        'moment (a mushroom cloud). Most wins are 1 or 2.',
      inputSchema: {
        type: 'object',
        properties: {
          level: { type: 'integer', minimum: 1, maximum: 5, description: 'How big the moment is, 1 to 5.' },
          shout: { type: 'string', maxLength: 28, description: 'A few words shown in the sky, e.g. "ALL GREEN!". Optional.' },
        },
        required: ['level'],
      },
      isDeferred: false,
    })
    best = Number((await $.store.get('best')) ?? 0)
    const stored = await $.store.get('isEnabled')
    if (stored === false) await update($, isEnabled, () => false)
    await $.command.register({
      name: 'power-mode',
      description: 'Toggles Power Mode (sparks and a combo counter as you type).',
    })

    return next(e)
  })

  on('command.run', { command: 'power-mode' }, async $ => {
    const now = !(await read($, isEnabled))
    await update($, isEnabled, () => now)
    await $.store.set('isEnabled', now)
    if (!now) {
      particles = []
      exclamation = undefined
      nuke = undefined
      blast = undefined
      volleys = []
      tall = false
      endCombo()
      await $.store.set('best', best)
      await update($, isTall, () => false)
      await update($, isActive, () => false)
    }

    return { text: now ? `Power Mode on. Best combo so far: ${best}.` : 'Power Mode off.' }
  })

  on('prompt.edit', async ($, e, next) => {
    const isMove = e.inputText === '' && e.end === e.start
    if (!isMove && (await read($, isEnabled))) {
      const draft = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
      const caret = e.start + e.inputText.length
      const lineStart = draft.lastIndexOf('\n', caret - 1) + 1
      const width = geometry?.columns ?? 80
      const isPaste = e.key === undefined && e.inputText.length > 1
      const column = isPaste ? (PROMPT_INDENT + e.start - lineStart) % width : (PROMPT_INDENT + caret - lineStart) % width
      const isCollapsed = newPastes(e.inputText) > 0
      const chars = isCollapsed ? Math.max(BLAST_PASTE, e.inputText.length) : Math.max(1, e.inputText.length)

      const isGrown = hit(column, chars, isPaste, isCollapsed)
      if (timer === undefined) {
        timer = $.clock.every(TICK_MS, () => {
          const r = tick()
          if (r.saveBest) void $.store.set('best', best)
          if (r.shrink) void update($, isTall, () => false)
          if (r.stop) {
            timer?.cancel()
            timer = undefined
            void update($, isActive, () => false)
          } else if (r.cells !== undefined && geometry !== undefined) {
            $.ui.blit({ requestId: geometry.requestId, key: 'sparks', cells: r.cells }).catch(() => {})
          }
        })
      }
      if (isGrown) await update($, isTall, () => true)
      await update($, isActive, () => true)
    }

    return next(e)
  })

  // A long paste can land as a placeholder the engine writes, outside any edit.
  on('prompt.change', async ($, e, next) => {
    if (newPastes(e.text) > 0 && (await read($, isEnabled))) {
      const width = geometry?.columns ?? 80
      const lineStart = e.text.lastIndexOf('\n', e.cursor - 1) + 1
      hit((PROMPT_INDENT + e.cursor - lineStart) % width, BLAST_PASTE, true, true)
      if (timer === undefined) {
        timer = $.clock.every(TICK_MS, () => {
          const r = tick()
          if (r.saveBest) void $.store.set('best', best)
          if (r.shrink) void update($, isTall, () => false)
          if (r.stop) {
            timer?.cancel()
            timer = undefined
            void update($, isActive, () => false)
          } else if (r.cells !== undefined && geometry !== undefined) {
            $.ui.blit({ requestId: geometry.requestId, key: 'sparks', cells: r.cells }).catch(() => {})
          }
        })
      }
      await update($, isTall, () => true)
      await update($, isActive, () => true)
    }

    return next(e)
  })

  // The tool only draws, so it never needs the person's permission.
  on('tool.check', { tool: 'mcp__power-mode__celebrate' }, () => ({ decision: 'allow', reason: 'Power Mode only draws.' }))

  on('tool.call', { tool: 'mcp__power-mode__celebrate' }, async ($, e) => {
    const input = e as unknown as { level?: unknown; shout?: unknown }
    const level = clamp(Number(input.level ?? 1), 1, 5)
    const shout = typeof input.shout === 'string' ? input.shout : ''

    if (!(await read($, isEnabled))) return { result: 'Power Mode is off; nothing was drawn.' }

    const isTallNow = celebrate(level, shout)
    if (timer === undefined) {
      timer = $.clock.every(TICK_MS, () => {
        const r = tick()
        if (r.saveBest) void $.store.set('best', best)
        if (r.shrink) void update($, isTall, () => false)
        if (r.stop) {
          timer?.cancel()
          timer = undefined
          void update($, isActive, () => false)
        } else if (r.cells !== undefined && geometry !== undefined) {
          $.ui.blit({ requestId: geometry.requestId, key: 'sparks', cells: r.cells }).catch(() => {})
        }
      })
    }
    if (isTallNow) await update($, isTall, () => true)
    await update($, isActive, () => true)

    return { result: `Celebrated at level ${level}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    if (combo > 0 && geometry !== undefined) {
      const spec = TIERS[tierOf(combo)] ?? TIERS[0]!
      for (let c = 0; c < geometry.columns; c += 6) burst(c, 3, 4, spec.speed, spec.fireworks)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const isShown =
      e.surface === 'terminal' &&
      !e.props.hasSurvey &&
      (await read($, isEnabled)) &&
      (await read($, isActive))
    maxRowsSeen = e.props.maxRows
    let rows = ((await read($, isTall)) ? bandRows() : sparkRows) + 1
    if (rows + 1 > e.props.maxRows) rows = sparkRows + 1

    if (!isShown || e.surface !== 'terminal' || rows + 1 > e.props.maxRows) {
      geometry = undefined
      return below
    }

    geometry = { requestId: e.requestId, columns: clamp(e.props.bodyColumns, 1, 512), rows }
    const { Box, Raster } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Raster key="sparks" columns={geometry.columns} rows={rows} cells={frame()} />
        {below}
      </Box>
    )
  })
}
