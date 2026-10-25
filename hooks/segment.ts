import type { Color, ContextCategory, SessionContextUsage, SessionCost, SessionRateLimit } from 'claude-code'

import type { StatusBarRun } from '../types'

// A run of text in one tone: `label` is the dimmest, `value` (the default)
// a step brighter, and `color` (a theme key or hex) wins over both.
//
// The composer tags the runs of a segment that has a hover view with `area`
// (the segment's id); the first run of the area carries `hoverRuns`, drawn in
// the same cells while the pointer is over the area. Both views are padded to
// one width, so nothing moves on hover.
export type Run = StatusBarRun & { area?: string; hoverRuns?: readonly Run[] }

export type Split = { sys: number; mcp: number; tools: number; conv: number }

// What the bar knows about the session. Every field can be missing: an empty
// session (a new one, or right after /clear) has no figures yet.
export type BarData = {
  rateLimits: readonly SessionRateLimit[]
  context?: SessionContextUsage
  split?: Split
  cost?: SessionCost
  // When the main loop last got a response, in ms since the epoch.
  lastResponseAt?: number
  // Context tokens the last main-loop turn added (negative after a compaction):
  // the tokens at its end minus those at the end of the turn before it.
  ctxDelta?: number
}

// What a segment draws from.
export type SegmentContext = {
  data: BarData
  // Milliseconds since the epoch.
  now: number
  // The cells the bar is laid out in.
  columns: number
  // True below WIDE_COLUMNS, or when the wide bar does not fit: segments
  // draw short meters and drop extras.
  isNarrow: boolean
  // True when the bar has no room for extras (the context legend) even
  // though it is not narrow; always true when narrow.
  isCrowded: boolean
  // Cells for the context meter: the composer shrinks it so the bar fits.
  ctxCells: number
  // The session budget in USD; 0 means no budget.
  budgetUsd: number
  // A context ceiling of the person's own, in tokens; 0 or left out means
  // the engine's window. It only ever lowers the window, and only until the
  // tokens pass it (contextWindow).
  contextLimit?: number
  // The prompt cache lifetime in ms.
  ttlMs: number
  // Reads a time (ms since the epoch) as the local wall clock; left out, the
  // system's local time zone. Tests pass a fixed zone.
  localTime?: LocalTime
}

// A wall-clock reading: the weekday (0 is Sunday), hours (0-23) and minutes.
export type WallClock = { weekday: number; hours: number; minutes: number }
export type LocalTime = (ms: number) => WallClock

// The system's local time zone, as Date reads it.
export const systemLocalTime: LocalTime = ms => {
  const d = new Date(ms)

  return { weekday: d.getDay(), hours: d.getHours(), minutes: d.getMinutes() }
}

// A fixed offset from UTC, in minutes: deterministic wherever it runs.
export const fixedLocalTime =
  (offsetMinutes: number): LocalTime =>
  ms => {
    const d = new Date(ms + offsetMinutes * 60_000)

    return { weekday: d.getUTCDay(), hours: d.getUTCHours(), minutes: d.getUTCMinutes() }
  }

// One piece of the bar. `render` returns the runs to draw, or null to draw
// nothing. A segment with no data draws a placeholder of the same width, so
// the bar does not change shape when data arrives or goes.
export type Segment = {
  id: string
  render: (ctx: SegmentContext) => readonly Run[] | null
  // What the segment's cells show instead while the pointer is over them
  // (above or below the prompt; the status line has no pointer). `width` is
  // what `render` drew; a hover wider than that widens both views.
  hover?: (ctx: SegmentContext, width: number) => readonly Run[] | null
}

// Below this width the bar shortens the meters and drops the legend.
export const WIDE_COLUMNS = 110

// Cells a list of runs takes.
export const runsWidth = (runs: readonly Run[]): number => runs.reduce((n, r) => n + r.text.length, 0)

export const label = (text: string): Run => ({ text, tone: 'label' })
export const value = (text: string, color?: Color): Run =>
  color === undefined ? { text, tone: 'value' } : { text, tone: 'value', color }

// Tokens as a short number, padded to 4 cells: ' 950', ' 62k', '1.2M', ' 12M'.
// Each unit hands over to the next where rounding would take a fifth cell.
export const kTokens = (n: number): string => {
  const units = Math.round(n)
  if (units < 1000) return String(units).padStart(4)
  const k = Math.round(n / 1000)
  if (k < 1000) return `${k}k`.padStart(4)
  const m = n / 1_000_000

  return (m < 9.95 ? `${m.toFixed(1)}M` : `${Math.min(999, Math.round(m))}M`).padStart(4)
}

// A signed token count, padded to 5 cells: ' +950', '+4.1k', ' +62k', '-1.2M'.
// Each unit hands over to the next where rounding would take a sixth cell.
export const deltaText = (n: number): string => {
  const sign = n < 0 ? '-' : '+'
  const abs = Math.abs(n)
  const units = Math.round(abs)
  let text: string
  if (units < 1000) text = String(units)
  else if (abs < 9950) text = `${(abs / 1000).toFixed(1)}k`
  else if (Math.round(abs / 1000) < 1000) text = `${Math.round(abs / 1000)}k`
  else if (abs < 9_950_000) text = `${(abs / 1_000_000).toFixed(1)}M`
  else text = `${Math.min(99, Math.round(abs / 1_000_000))}M`

  return `${sign}${text}`.padStart(5)
}
export const DELTA_PLACEHOLDER = '  +--'

// A fraction as a percentage padded to 4 cells: '  5%', ' 25%', '100%'.
// From 1000% (a budget spent ten times over) it reads as a multiple: ' 12x'.
export const percentText = (fraction: number): string => {
  const percent = Math.round(fraction * 100)

  return (percent < 1000 ? `${percent}%` : `${Math.min(999, Math.round(fraction))}x`).padStart(4)
}
export const PERCENT_PLACEHOLDER = ' --%'

// Zero-padded mm:ss of the whole seconds in `ms`: '00:34', '04:32', '59:59'.
export const clockText = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))

  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
export const CLOCK_PLACEHOLDER = '--:--'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const two = (n: number): string => String(n).padStart(2, '0')

// A 24h wall-clock time, 5 cells: '09:00', '12:20'.
export const timeOfDay = ({ hours, minutes }: WallClock): string => `${two(hours)}:${two(minutes)}`
// A weekday and a 24h time, 9 cells: 'Mon 09:00'.
export const dayAndTime = (clock: WallClock): string => `${WEEKDAYS[clock.weekday] ?? '---'} ${timeOfDay(clock)}`
export const DAY_TIME_PLACEHOLDER = '--- --:--'

// An ISO 8601 timestamp in ms since the epoch; undefined when absent or unreadable.
export const parseTime = (iso: string | undefined): number | undefined => {
  if (typeof iso !== 'string' || iso.length === 0) return undefined
  const ms = Date.parse(iso)

  return Number.isFinite(ms) ? ms : undefined
}

// The color of a meter: none up to 50%, then blue, orange, magenta.
export const levelColor = (fraction: number): Color | undefined =>
  fraction > 0.9 ? 'magenta' : fraction > 0.75 ? '#ff8700' : fraction > 0.5 ? 'blue' : undefined

export const percentRun = (fraction: number): Run => value(percentText(fraction), levelColor(fraction))

const cells = (fraction: number, width: number): number =>
  Math.max(0, Math.min(width, Math.round(fraction * width)))

export const METER_WIDTH = 8

// A thin meter: the filled part in the level color, the rest dim.
export const meter = (fraction: number, width: number): Run[] => {
  const full = cells(fraction, width)
  const color = levelColor(fraction)

  return [
    { text: '━'.repeat(full), tone: 'value', ...(color === undefined ? {} : { color }) },
    label('─'.repeat(width - full)),
  ]
}

export const GROUPS = ['sys', 'tools', 'mcp', 'conv'] as const

// One theme color per context group, so the colors follow the person's theme.
export const GROUP_COLORS: Record<keyof Split, Color> = {
  sys: 'inactive',
  tools: 'suggestion',
  mcp: 'merged',
  conv: 'claude',
}
const FILLED = '█'
const EMPTY = '░'

// A fixed-width bar: each cell is 1/width of the window, colored by the group
// that fills it. With no split, every cell is empty.
export const stackedMeter = (split: Split | undefined, window: number, width: number): Run[] => {
  const runs: Run[] = []
  // Round the running total, not each group, so the cells add up to the fill.
  let total = 0
  let used = 0
  if (split !== undefined && window > 0) {
    for (const key of GROUPS) {
      total += split[key]
      const n = cells(total / window, width) - used
      used += n
      if (n > 0) runs.push({ text: FILLED.repeat(n), tone: 'value', color: GROUP_COLORS[key] })
    }
  }
  runs.push(label(EMPTY.repeat(width - used)))

  return runs
}

// Whether the tokens have gone past the person's own `contextLimit` (one
// lower than the engine's window); false with the limit off or no figure.
export const isOverLimit = (engineWindow: number, contextLimit = 0, tokens?: number): boolean =>
  contextLimit > 0 && contextLimit < engineWindow && tokens !== undefined && tokens > contextLimit

// The window the context fills against: the person's `contextLimit` where
// that is lower than the engine's window and the tokens have not gone past
// it; else the engine's own. Never above the engine's.
export const contextWindow = (engineWindow: number, contextLimit = 0, tokens?: number): number =>
  contextLimit > 0 && contextLimit < engineWindow && !isOverLimit(engineWindow, contextLimit, tokens)
    ? contextLimit
    : engineWindow

// Group the /context rows into the four buckets the bar shows.
export const splitContext = (categories: readonly ContextCategory[]): Split => {
  const split: Split = { sys: 0, mcp: 0, tools: 0, conv: 0 }

  for (const c of categories) {
    if (c.kind !== 'used') continue
    const name = c.name.toLowerCase()
    if (name.includes('mcp')) split.mcp += c.tokens
    else if (name.includes('message')) split.conv += c.tokens
    else if (name.includes('tool')) split.tools += c.tokens
    else split.sys += c.tokens
  }

  return split
}
