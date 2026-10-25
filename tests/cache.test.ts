import { describe, expect, test } from 'claude-code/testing'

import type { BarData } from '../hooks/register'
import { cache } from '../hooks/segments'
import { ctxOf, EMPTY, FIVE_MIN, HOUR, join } from './fixtures'

const answered = (at: number): BarData => ({ rateLimits: [], lastResponseAt: at })
const runs = (now: number, ttlMs = HOUR, data: BarData = answered(0)) => cache.render(ctxOf(data, 'wide', { now, ttlMs }))!
const draw = (now: number, ttlMs = HOUR) => join(runs(now, ttlMs))
const color = (now: number, ttlMs = HOUR) => runs(now, ttlMs).at(-1)!.color

describe('cache segment', () => {
  test('counts down in zero-padded mm:ss', async () => {
    expect(draw(HOUR - 34_000)).toBe('cache 00:34')
    expect(draw(HOUR - 272_000)).toBe('cache 04:32')
    expect(draw(HOUR - 600_000)).toBe('cache 10:00')
    // Part seconds round down.
    expect(draw(HOUR - 34_999)).toBe('cache 00:34')
  })

  test('reads 59:59 on a fresh 1h cache, never 60:00', async () => {
    expect(draw(0)).toBe('cache 59:59')
    expect(draw(500)).toBe('cache 59:59')
    expect(draw(1000)).toBe('cache 59:59')
    expect(draw(2000)).toBe('cache 59:58')
  })

  test('reads 00:00 once the cache has gone cold', async () => {
    expect(draw(HOUR)).toBe('cache 00:00')
    expect(draw(HOUR - 999)).toBe('cache 00:00')
    expect(draw(10 * HOUR)).toBe('cache 00:00')
  })

  test('reads --:-- before the first response', async () => {
    const placeholder = cache.render(ctxOf(EMPTY))!
    expect(join(placeholder)).toBe('cache --:--')
    expect(placeholder.every(r => r.color === undefined)).toBe(true)
  })

  test('counts down from 5 minutes with the 5m TTL', async () => {
    expect(draw(0, FIVE_MIN)).toBe('cache 04:59')
    expect(draw(FIVE_MIN - 34_000, FIVE_MIN)).toBe('cache 00:34')
    expect(draw(FIVE_MIN, FIVE_MIN)).toBe('cache 00:00')
  })

  test('takes the same width cold, warm and before any response', async () => {
    const width = join(cache.render(ctxOf(EMPTY))).length
    for (const now of [0, 1000, HOUR - 34_000, HOUR - 272_000, HOUR, 5 * HOUR]) {
      expect(draw(now).length).toBe(width)
      expect(draw(now, FIVE_MIN).length).toBe(width)
    }
  })

  test('counts from the last response, not from zero', async () => {
    const at = 1_000_000
    expect(join(runs(at + 26_000, HOUR, answered(at)))).toBe('cache 59:34')
    // A response time ahead of the clock reads as a fresh cache.
    expect(join(runs(at - 5000, HOUR, answered(at)))).toBe('cache 59:59')
  })

  test('colors the clock by the elapsed part of the 1h TTL', async () => {
    expect([0, HOUR / 2].map(n => color(n))).toEqual([undefined, undefined])
    expect([HOUR / 2 + 1, HOUR * 0.75].map(n => color(n))).toEqual(['blue', 'blue'])
    expect([HOUR * 0.75 + 1, HOUR * 0.9].map(n => color(n))).toEqual(['#ff8700', '#ff8700'])
    expect([HOUR * 0.9 + 1, HOUR, 2 * HOUR].map(n => color(n))).toEqual(['magenta', 'magenta', 'magenta'])
  })

  test('colors the clock by the elapsed part of the 5m TTL', async () => {
    const at = (fraction: number, delta = 0) => color(FIVE_MIN * fraction + delta, FIVE_MIN)
    expect([at(0.5), at(0.5, 1)]).toEqual([undefined, 'blue'])
    expect([at(0.75), at(0.75, 1)]).toEqual(['blue', '#ff8700'])
    expect([at(0.9), at(0.9, 1)]).toEqual(['#ff8700', 'magenta'])
    expect(at(1)).toBe('magenta')
  })

  test('leaves the label uncolored', async () => {
    expect(runs(HOUR)[0]).toEqual({ text: 'cache ', tone: 'label' })
  })
})
