import type { SessionRateLimit } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import type { BarData } from '../hooks/register'
import { dayAndTime, fixedLocalTime, parseTime, systemLocalTime, timeOfDay } from '../hooks/register'
import { limit5h, limit7d, limitSpend } from '../hooks/segments'
import { colorOf, ctxOf, drawOf, EMPTY, FULL, join, limits, limitsResetting, RESET_5H, RESET_7D } from './fixtures'

const at = (percent: number, form: 'wide' | 'narrow' = 'wide') =>
  limit5h.render(ctxOf({ rateLimits: limits(percent) }, form))
const resetting = (rateLimits: SessionRateLimit[]): BarData => ({ rateLimits })

describe('limit segments', () => {
  test('draw a meter, the percentage and the reset time on a wide bar', async () => {
    expect(drawOf('limit5h', ctxOf(FULL))).toBe('5h ━━──────  25% ↻12:20')
    expect(drawOf('limit7d', ctxOf(FULL))).toBe('7d ━━━━────  50% ↻Mon 09:00')
    // The spend limit has no reset time.
    expect(drawOf('limitSpend', ctxOf(FULL))).toBe('spend ━───────  10%')
  })

  test('draw the percentage alone on a narrow bar', async () => {
    expect(drawOf('limit5h', ctxOf(FULL, 'narrow'))).toBe('5h  25%')
    expect(drawOf('limit7d', ctxOf(FULL, 'narrow'))).toBe('7d  50%')
    expect(drawOf('limitSpend', ctxOf(FULL, 'narrow'))).toBe('spend  10%')
  })

  test('keep the meter and reset time on a crowded (not narrow) bar', async () => {
    expect(drawOf('limit5h', ctxOf(FULL, 'crowded'))).toBe('5h ━━──────  25% ↻12:20')
    expect(drawOf('limit7d', ctxOf(FULL, 'crowded'))).toBe('7d ━━━━────  50% ↻Mon 09:00')
  })

  test('draw an empty meter, --% and --:-- before the window has a figure', async () => {
    expect(drawOf('limit5h', ctxOf(EMPTY))).toBe('5h ────────  --% ↻--:--')
    expect(drawOf('limit7d', ctxOf(EMPTY))).toBe('7d ────────  --% ↻--- --:--')
    expect(drawOf('limit7d', ctxOf(EMPTY, 'narrow'))).toBe('7d  --%')
    // Only the 5h window has a reading: the 7d segment still has a placeholder.
    expect(drawOf('limit7d', ctxOf({ rateLimits: limits(40) }))).toBe('7d ────────  --% ↻--- --:--')
  })

  test('take the same width with and without data, in every form', async () => {
    for (const segment of [limit5h, limit7d, limitSpend]) {
      for (const form of ['wide', 'crowded', 'narrow'] as const) {
        const empty = join(segment.render(ctxOf(EMPTY, form)))
        for (const percent of [0, 5, 50, 99, 100]) {
          for (const data of [
            resetting(limits(percent, percent, percent)),
            resetting([...limitsResetting(percent, percent), { kind: 'spend_limit', percentUsed: percent }]),
          ]) {
            expect(join(segment.render(ctxOf(data, form))).length, `${segment.id} ${form} ${percent}%`).toBe(empty.length)
          }
        }
      }
    }
  })

  test('fill the meter by the percentage used', async () => {
    expect(join(at(0))).toBe('5h ────────   0% ↻--:--')
    expect(join(at(100))).toBe('5h ━━━━━━━━ 100% ↻--:--')
    // Over 100% the meter stays full and keeps its width.
    expect(join(at(130))).toBe('5h ━━━━━━━━ 130% ↻--:--')
  })

  test('color the meter and percentage just above 50%, 75% and 90%', async () => {
    const color = (percent: number) => colorOf(at(percent), /%$/)
    const meterColor = (percent: number) => colorOf(at(percent), /━/)
    expect([49, 50, 51].map(color)).toEqual([undefined, undefined, 'blue'])
    expect([74, 75, 76].map(color)).toEqual(['blue', 'blue', '#ff8700'])
    expect([89, 90, 91].map(color)).toEqual(['#ff8700', '#ff8700', 'magenta'])
    expect([50, 51, 76, 91].map(meterColor)).toEqual([undefined, 'blue', '#ff8700', 'magenta'])
    // The narrow form colors the percentage the same way.
    expect(colorOf(at(91, 'narrow'), /%$/)).toBe('magenta')
  })

  test('draw the placeholder uncolored', async () => {
    expect(limit5h.render(ctxOf(EMPTY))!.every(r => r.color === undefined)).toBe(true)
    expect(limit7d.render(ctxOf(EMPTY))!.every(r => r.color === undefined)).toBe(true)
  })
})

describe('reset times', () => {
  test('draw the glyph as a label and the time as a dim value, never colored', async () => {
    const runs = limit5h.render(ctxOf({ rateLimits: limitsResetting(95, 95) }))!
    expect(runs.slice(-2)).toEqual([
      { text: ' ↻', tone: 'label' },
      { text: '12:20', tone: 'value' },
    ])
  })

  test('read the reset in the local zone the bar is given', async () => {
    const draw = (id: string, offset: number) => drawOf(id, ctxOf(FULL, 'wide', { localTime: fixedLocalTime(offset) }))
    expect(draw('limit5h', 60)).toBe('5h ━━──────  25% ↻13:20')
    expect(draw('limit5h', -5 * 60)).toBe('5h ━━──────  25% ↻07:20')
    expect(draw('limit5h', 12 * 60)).toBe('5h ━━──────  25% ↻00:20')
    // Across midnight the weekday moves with the time.
    expect(draw('limit7d', -10 * 60)).toBe('7d ━━━━────  50% ↻Sun 23:00')
    expect(draw('limit7d', 15 * 60)).toBe('7d ━━━━────  50% ↻Tue 00:00')
  })

  test('draw every weekday in three letters and a 24h clock', async () => {
    const days: string[] = []
    for (let d = 0; d < 7; d++) {
      const iso = new Date(Date.parse('2026-10-25T21:05:00Z') + d * 86_400_000).toISOString()
      days.push(drawOf('limit7d', ctxOf(resetting(limitsResetting(10, 10, [RESET_5H, iso])))).slice(-10))
    }
    expect(days).toEqual(['↻Sun 21:05', '↻Mon 21:05', '↻Tue 21:05', '↻Wed 21:05', '↻Thu 21:05', '↻Fri 21:05', '↻Sat 21:05'])
  })

  test('take the same width as the placeholder at every hour', async () => {
    const width5h = drawOf('limit5h', ctxOf(EMPTY)).length
    const width7d = drawOf('limit7d', ctxOf(EMPTY)).length
    for (let h = 0; h < 24 * 7; h += 5) {
      const iso = new Date(Date.parse('2026-10-25T00:07:00Z') + h * 3_600_000).toISOString()
      const data = resetting(limitsResetting(42, 42, [iso, iso]))
      expect(drawOf('limit5h', ctxOf(data)).length).toBe(width5h)
      expect(drawOf('limit7d', ctxOf(data)).length).toBe(width7d)
    }
  })

  test('draw the placeholder when the engine gives no reset time or an unreadable one', async () => {
    expect(drawOf('limit5h', ctxOf(resetting(limitsResetting(25, 50, [undefined, undefined]))))).toBe('5h ━━──────  25% ↻--:--')
    expect(drawOf('limit7d', ctxOf(resetting(limitsResetting(25, 50, ['', 'not a date']))))).toBe('7d ━━━━────  50% ↻--- --:--')
  })

  test('read a reset with a zone offset in the timestamp', async () => {
    const data = resetting(limitsResetting(25, 50, ['2026-10-25T14:20:00+02:00', RESET_7D]))
    expect(drawOf('limit5h', ctxOf(data))).toBe('5h ━━──────  25% ↻12:20')
  })
})

describe('time helpers', () => {
  test('timeOfDay and dayAndTime pad to fixed widths', async () => {
    expect(timeOfDay({ weekday: 1, hours: 9, minutes: 5 })).toBe('09:05')
    expect(timeOfDay({ weekday: 1, hours: 23, minutes: 59 })).toBe('23:59')
    expect(dayAndTime({ weekday: 1, hours: 9, minutes: 0 })).toBe('Mon 09:00')
    expect(dayAndTime({ weekday: 0, hours: 0, minutes: 0 })).toBe('Sun 00:00')
    expect(dayAndTime({ weekday: 9, hours: 0, minutes: 0 })).toBe('--- 00:00')
  })

  test('parseTime reads ISO 8601 and nothing else', async () => {
    expect(parseTime(RESET_5H)).toBe(Date.UTC(2026, 9, 25, 12, 20))
    expect(parseTime(undefined)).toBeUndefined()
    expect(parseTime('')).toBeUndefined()
    expect(parseTime('soon')).toBeUndefined()
  })

  test('fixedLocalTime reads a fixed offset from UTC', async () => {
    const ms = Date.UTC(2026, 9, 25, 23, 30)
    expect(fixedLocalTime(0)(ms)).toEqual({ weekday: 0, hours: 23, minutes: 30 })
    expect(fixedLocalTime(60)(ms)).toEqual({ weekday: 1, hours: 0, minutes: 30 })
    expect(fixedLocalTime(-90)(ms)).toEqual({ weekday: 0, hours: 22, minutes: 0 })
  })

  test('systemLocalTime reads the zone the process runs in, as Date does', async () => {
    const ms = Date.parse(RESET_7D)
    const d = new Date(ms)
    expect(systemLocalTime(ms)).toEqual({ weekday: d.getDay(), hours: d.getHours(), minutes: d.getMinutes() })
  })
})
