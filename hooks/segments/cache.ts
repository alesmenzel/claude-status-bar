import type { Run, Segment } from '../segment'
import { CLOCK_PLACEHOLDER, clockText, label, levelColor, runsWidth, systemLocalTime, timeOfDay, value } from '../segment'

// The hover view: the local time of the last response, in the first form
// that fits the segment's cells: `cached at 14:32`, `cached 14:32`, then
// `since 14:32`.
export const cachedHover = (at: string, width: number): Run[] => {
  const forms: Run[][] = [
    [label('cached at '), value(at)],
    [label('cached '), value(at)],
    [label('since '), value(at)],
  ]

  return forms.find(runs => runsWidth(runs) <= width) ?? forms[forms.length - 1]!
}

// The prompt cache countdown: `cache 04:32`, always mm:ss so its width never
// changes; `cache --:--` before the first response and `cache 00:00` once the
// cache has gone cold. Colored by the elapsed part of the TTL, as the meters
// are by use: blue past 50%, orange past 75%, magenta past 90%. On hover, the
// time of the response that wrote the cache.
export const cache: Segment = {
  id: 'cache',
  render: ({ data, now, ttlMs }) => {
    if (data.lastResponseAt === undefined) return [label('cache '), value(CLOCK_PLACEHOLDER)]
    const left = Math.max(0, Math.min(ttlMs - 1000, data.lastResponseAt + ttlMs - now))
    const elapsed = ttlMs > 0 ? (ttlMs - left) / ttlMs : 1

    return [label('cache '), value(clockText(left), levelColor(elapsed))]
  },
  hover: ({ data, localTime = systemLocalTime }, width) =>
    data.lastResponseAt === undefined ? null : cachedHover(timeOfDay(localTime(data.lastResponseAt)), width),
}
