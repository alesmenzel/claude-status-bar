import type { Segment } from '../segment'
import { CLOCK_PLACEHOLDER, clockText, label, levelColor, value } from '../segment'

// The prompt cache countdown: `cache 04:32`, always mm:ss so its width never
// changes; `cache --:--` before the first response and `cache 00:00` once the
// cache has gone cold. Colored by the elapsed part of the TTL, as the meters
// are by use: blue past 50%, orange past 75%, magenta past 90%.
export const cache: Segment = {
  id: 'cache',
  render: ({ data, now, ttlMs }) => {
    if (data.lastResponseAt === undefined) return [label('cache '), value(CLOCK_PLACEHOLDER)]
    const left = Math.max(0, Math.min(ttlMs - 1000, data.lastResponseAt + ttlMs - now))
    const elapsed = ttlMs > 0 ? (ttlMs - left) / ttlMs : 1

    return [label('cache '), value(clockText(left), levelColor(elapsed))]
  },
}
