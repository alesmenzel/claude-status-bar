// Shared data and helpers for the status-bar tests. Not a test file itself.
import type { SessionRateLimit } from 'claude-code'

import type { BarData, Run, Segment, SegmentContext } from '../hooks/register'
import { BUILTIN_SEGMENTS, DEFAULT_SEGMENTS, fixedLocalTime, parseLayout } from '../hooks/register'

export const HOUR = 3_600_000
export const FIVE_MIN = 300_000

export const BUILTINS: ReadonlyMap<string, Segment> = new Map(BUILTIN_SEGMENTS.map(s => [s.id, s]))
export const LAYOUT = parseLayout(DEFAULT_SEGMENTS)

// When FULL's windows reset: 12:20 UTC on Sunday 2026-10-25, and 09:00 UTC
// on Monday 2026-10-26.
export const RESET_5H = '2026-10-25T12:20:00Z'
export const RESET_7D = '2026-10-26T09:00:00Z'

// The tests read times in UTC, whatever zone they run in.
export const UTC = fixedLocalTime(0)

export const limits = (fiveHour?: number, sevenDay?: number, spend?: number): SessionRateLimit[] => [
  ...(fiveHour === undefined ? [] : [{ kind: 'five_hour' as const, percentUsed: fiveHour }]),
  ...(sevenDay === undefined ? [] : [{ kind: 'seven_day' as const, percentUsed: sevenDay }]),
  ...(spend === undefined ? [] : [{ kind: 'spend_limit' as const, percentUsed: spend }]),
]

// The same windows with reset times.
export const limitsResetting = (fiveHour: number, sevenDay: number, resets: [string?, string?] = [RESET_5H, RESET_7D]) => [
  { kind: 'five_hour' as const, percentUsed: fiveHour, ...(resets[0] === undefined ? {} : { resetsAt: resets[0] }) },
  { kind: 'seven_day' as const, percentUsed: sevenDay, ...(resets[1] === undefined ? {} : { resetsAt: resets[1] }) },
]

// A session with every figure.
export const FULL: BarData = {
  rateLimits: [...limitsResetting(25, 50), { kind: 'spend_limit', percentUsed: 10 }],
  context: { tokens: 62_000, window: 200_000, percent: 31 },
  split: { sys: 10_000, mcp: 10_000, tools: 20_000, conv: 20_000 },
  cost: { usd: 1.237 },
  lastResponseAt: 0,
}

// A new session, or one right after /clear: no figures at all.
export const EMPTY: BarData = { rateLimits: [] }

export type Form = 'wide' | 'crowded' | 'narrow'

// A segment context in one of the bar's three forms.
export const ctxOf = (data: BarData, form: Form = 'wide', over: Partial<SegmentContext> = {}): SegmentContext => ({
  data,
  now: 0,
  columns: form === 'narrow' ? 80 : 160,
  isNarrow: form === 'narrow',
  isCrowded: form !== 'wide',
  ctxCells: form === 'narrow' ? 20 : 40,
  budgetUsd: 10,
  ttlMs: HOUR,
  localTime: UTC,
  ...over,
})

export const join = (runs: readonly Run[] | null): string => (runs === null ? '' : runs.map(r => r.text).join(''))

// What one segment draws, as text.
export const drawOf = (id: string, ctx: SegmentContext): string => join(BUILTINS.get(id)!.render(ctx))

// The color of the first run whose text matches.
export const colorOf = (runs: readonly Run[] | null, match: RegExp): string | undefined =>
  runs?.find(r => match.test(r.text))?.color
