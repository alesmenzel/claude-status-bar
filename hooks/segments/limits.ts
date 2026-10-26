import type { SessionRateLimit } from 'claude-code'

import type { Run, Segment, SegmentContext, WallClock } from '../segment'
import {
  CLOCK_PLACEHOLDER,
  DAY_TIME_PLACEHOLDER,
  dayAndTime,
  label,
  METER_WIDTH,
  meter,
  parseTime,
  percentRun,
  runsWidth,
  systemLocalTime,
  timeOfDay,
  value,
} from '../segment'

// How a window's reset time reads: the time of day for the 5h window, the
// weekday and time for the 7d one. Each has a placeholder of its own width.
type ResetForm = { format: (clock: WallClock) => string; placeholder: string }
const TIME_OF_DAY: ResetForm = { format: timeOfDay, placeholder: CLOCK_PLACEHOLDER }
const DAY_AND_TIME: ResetForm = { format: dayAndTime, placeholder: DAY_TIME_PLACEHOLDER }

// The glyph before a reset time.
export const RESET_GLYPH = '↻'

// A duration, from the largest unit that is not zero down to seconds:
// `2h 34m 23s`, `6d 0h 5m 0s`; `0s` for a reset that is due or past.
export const durationText = (ms: number): string => {
  let rest = Math.max(0, Math.floor(ms / 1000))
  const parts: string[] = []
  for (const [unit, size] of [['d', 86_400], ['h', 3_600], ['m', 60]] as const) {
    const n = Math.floor(rest / size)
    rest -= n * size
    if (n > 0 || parts.length > 0) parts.push(`${n}${unit}`)
  }
  parts.push(`${rest}s`)

  return parts.join(' ')
}

// The hover view of a window: the time until it resets, in the first form
// that fits the segment's cells: `5h resets in 2h 34m 23s`, `5h ↻2h 34m 23s`,
// then the two largest units alone, `↻2h 34m`. None where the engine gives no
// reset time or no form fits.
export const resetHover = (name: string, resetsAt: number, now: number, width: number): Run[] | null => {
  const left = durationText(resetsAt - now)
  const short = left.split(' ').slice(0, 2).join(' ')
  const forms: Run[][] = [
    [label(`${name} resets in `), value(left)],
    [label(`${name} ${RESET_GLYPH}`), value(left)],
    [label(RESET_GLYPH), value(short)],
  ]

  return forms.find(runs => runsWidth(runs) <= width) ?? null
}

// A rate-limit window: `5h ━━────── 25% ↻12:20`, or `5h  25%` on a narrow
// bar, which drops the meter and the reset time; the reset time reads
// `--:--` when the engine gives none. A window draws nothing until an API
// response reports it, so an account with no such window (an Enterprise seat
// has no 5h or 7d window) never shows it. On hover, the time until it resets.
const limitSegment = (id: string, kind: SessionRateLimit['kind'], name: string, reset?: ResetForm): Segment => ({
  id,
  render: ({ data, isNarrow, localTime = systemLocalTime }: SegmentContext): Run[] | null => {
    const limit = data.rateLimits.find(r => r.kind === kind)
    if (limit === undefined) return null
    const runs: Run[] = [label(`${name} `)]
    if (!isNarrow) runs.push(...meter(limit.percentUsed / 100, METER_WIDTH), label(' '))
    runs.push(percentRun(limit.percentUsed / 100))
    if (reset !== undefined && !isNarrow) {
      const at = parseTime(limit.resetsAt)
      runs.push(label(` ${RESET_GLYPH}`), value(at === undefined ? reset.placeholder : reset.format(localTime(at))))
    }

    return runs
  },
  hover: ({ data, now }, width) => {
    const at = parseTime(data.rateLimits.find(r => r.kind === kind)?.resetsAt)

    return at === undefined ? null : resetHover(name, at, now, width)
  },
})

export const limit5h = limitSegment('limit5h', 'five_hour', '5h', TIME_OF_DAY)
export const limit7d = limitSegment('limit7d', 'seven_day', '7d', DAY_AND_TIME)
// The account's spend limit (an Enterprise seat's usage budget, a Claude
// gateway's spend limit): a percentage, as the engine gives no dollar figure.
export const limitSpend = limitSegment('limitSpend', 'spend_limit', 'spend')
