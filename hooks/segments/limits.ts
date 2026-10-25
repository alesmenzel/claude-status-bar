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
  PERCENT_PLACEHOLDER,
  percentRun,
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

// A rate-limit window: `5h ━━────── 25% ↻12:20`, or `5h  25%` on a narrow
// bar, which drops the meter and the reset time. Before the session has the
// window's figure, the meter is empty, the percentage reads ` --%` and the
// reset time `--:--` (also when the engine gives no reset time).
const limitSegment = (id: string, kind: SessionRateLimit['kind'], name: string, reset?: ResetForm): Segment => ({
  id,
  render: ({ data, isNarrow, localTime = systemLocalTime }: SegmentContext): Run[] => {
    const limit = data.rateLimits.find(r => r.kind === kind)
    const fraction = limit === undefined ? undefined : limit.percentUsed / 100
    const runs: Run[] = [label(`${name} `)]
    if (!isNarrow) runs.push(...meter(fraction ?? 0, METER_WIDTH), label(' '))
    runs.push(fraction === undefined ? value(PERCENT_PLACEHOLDER) : percentRun(fraction))
    if (reset !== undefined && !isNarrow) {
      const at = parseTime(limit?.resetsAt)
      runs.push(label(` ${RESET_GLYPH}`), value(at === undefined ? reset.placeholder : reset.format(localTime(at))))
    }

    return runs
  },
})

export const limit5h = limitSegment('limit5h', 'five_hour', '5h', TIME_OF_DAY)
export const limit7d = limitSegment('limit7d', 'seven_day', '7d', DAY_AND_TIME)
// A Claude gateway's spend limit; not in the default bar.
export const limitSpend = limitSegment('limitSpend', 'spend_limit', 'spend')
