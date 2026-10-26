import type { SessionUsage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import type { BarData } from '../hooks/register'
import { DELTA_PLACEHOLDER, deltaText, fit, widthOf } from '../hooks/register'
import { ctx } from '../hooks/segments'
import { BUILTINS, ctxOf, EMPTY, FULL, HOUR, join, LAYOUT, LIMITS_ONLY, UTC } from './fixtures'
import { BAND, END_CLEAR, START, TURN, world } from './world'

const usageAt = (tokens: number | undefined): SessionUsage => ({
  startedAt: 0,
  context: { ...(tokens === undefined ? {} : { tokens, percent: Math.round(tokens / 2000) }), window: 200_000 },
  rateLimits: [],
})
const SUBAGENT_TURN = { ...(TURN as object), agentId: 'a1' } as never

// The delta the band draws: the 5 cells after the ctx percentage.
const deltaOn = async (ui: { findAll: (q: { type: string; text: RegExp }) => Promise<{ text: string }[]> }) => {
  const found = await ui.findAll({ type: 'Text', text: /^ctx / })
  return found[0]!.text.match(/%\s(.{5})(?=  ■|$)/)?.[1]
}

describe('deltaText', () => {
  test('signs and shortens the token count', async () => {
    expect([0, 5, 950, 999].map(deltaText)).toEqual(['   +0', '   +5', ' +950', ' +999'])
    expect([1000, 4100, 9949].map(deltaText)).toEqual(['+1.0k', '+4.1k', '+9.9k'])
    expect([9950, 12_000, 62_400, 999_499].map(deltaText)).toEqual([' +10k', ' +12k', ' +62k', '+999k'])
    expect([999_500, 1_200_000, 9_960_000].map(deltaText)).toEqual(['+1.0M', '+1.2M', ' +10M'])
  })

  test('reads a shrinking context (a compaction) as negative', async () => {
    expect([-5, -950, -4100, -12_000, -150_000, -1_200_000].map(deltaText)).toEqual([
      '   -5',
      ' -950',
      '-4.1k',
      ' -12k',
      '-150k',
      '-1.2M',
    ])
  })

  test('always takes 5 cells, as the placeholder does', async () => {
    expect(DELTA_PLACEHOLDER).toBe('  +--')
    for (const n of [0, 1, 99, 999, 999.5, 1000, 9949, 9950, 99_999, 999_499, 999_500, 9.95e6, 1e8, 1e12]) {
      expect(deltaText(n), String(n)).toHaveLength(5)
      expect(deltaText(-n), String(-n)).toHaveLength(5)
    }
  })
})

describe('the ctx delta', () => {
  const withDelta = (ctxDelta: number): BarData => ({ ...FULL, ctxDelta })

  test('follows the percentage in the wide and crowded forms', async () => {
    expect(join(ctx.render(ctxOf(withDelta(4100))))).toMatch(/  62k\/200k  31% \+4\.1k$/)
    expect(join(ctx.render(ctxOf(withDelta(-12_000), 'crowded')))).toMatch(/  31%  -12k$/)
  })

  test('is dropped on a narrow bar', async () => {
    expect(join(ctx.render(ctxOf(withDelta(4100), 'narrow')))).toMatch(/  62k\/200k  31%$/)
  })

  test('is a dim value with no threshold color', async () => {
    const runs = ctx.render(ctxOf(withDelta(150_000)))!
    expect(runs.at(-1)).toEqual({ text: '+150k', tone: 'value' })
    expect(runs.at(-2)).toEqual({ text: ' ', tone: 'label' })
  })

  test('keeps the bar its width from the placeholder to any delta', async () => {
    const base = { now: HOUR / 4, budgetUsd: 10, ttlMs: HOUR, localTime: UTC }
    for (const columns of [80, 120, 160, 200, 240]) {
      const width = widthOf(fit(LAYOUT, BUILTINS, { ...base, data: LIMITS_ONLY, columns }))
      for (const ctxDelta of [0, 5, -5, 950, 4100, -12_000, 999_999, -2e6]) {
        const groups = fit(LAYOUT, BUILTINS, { ...base, data: withDelta(ctxDelta), columns })
        expect(widthOf(groups), `${columns} columns, ${ctxDelta}`).toBe(width)
        expect(widthOf(groups)).toBeLessThanOrEqual(columns)
      }
    }
  })
})

describe('the ctx delta across turns', () => {
  test('counts each main-loop turn against the end of the last one', async ($, on) => {
    const w = world(on)
    w.usage = usageAt(20_000)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(220))
    expect(await deltaOn(ui)).toBe('  +--')
    w.usage = usageAt(24_100)
    await $.turn.complete(TURN)
    expect(await deltaOn(ui)).toBe('+4.1k')
    w.usage = usageAt(25_050)
    await $.turn.complete(TURN)
    expect(await deltaOn(ui)).toBe(' +950')
    await ui.unmount()
  })

  test('starts counting at the first turn when the start has no figure', async ($, on) => {
    const w = world(on)
    w.usage = usageAt(undefined)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(220))
    w.usage = usageAt(30_000)
    await $.turn.complete(TURN)
    expect(await deltaOn(ui)).toBe('  +--')
    w.usage = usageAt(42_000)
    await $.turn.complete(TURN)
    expect(await deltaOn(ui)).toBe(' +12k')
    await ui.unmount()
  })

  test('ignores subagent turns: their tokens count toward the next main turn', async ($, on) => {
    const w = world(on)
    w.usage = usageAt(20_000)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(220))
    w.usage = usageAt(21_000)
    await $.turn.complete(TURN)
    expect(await deltaOn(ui)).toBe('+1.0k')
    w.usage = usageAt(90_000)
    await $.turn.complete(SUBAGENT_TURN)
    expect(await deltaOn(ui)).toBe('+1.0k')
    w.usage = usageAt(23_000)
    await $.turn.complete(TURN)
    expect(await deltaOn(ui)).toBe('+2.0k')
    await ui.unmount()
  })

  test('reads a compaction as a negative delta', async ($, on) => {
    const w = world(on)
    w.usage = usageAt(150_000)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(220))
    w.usage = usageAt(160_000)
    await $.turn.complete(TURN)
    w.usage = usageAt(40_000)
    await $.turn.complete(TURN)
    expect(await deltaOn(ui)).toBe('-120k')
    await ui.unmount()
  })

  test('goes back to the placeholder on /clear and counts from the cleared context', async ($, on) => {
    const w = world(on)
    w.usage = usageAt(20_000)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(220))
    w.usage = usageAt(30_000)
    await $.turn.complete(TURN)
    const before = (await ui.findAll({ type: 'Text', text: /^ctx / }))[0]!.text.length
    expect(await deltaOn(ui)).toBe(' +10k')
    w.usage = usageAt(15_000)
    await $.session.end(END_CLEAR)
    expect(await deltaOn(ui)).toBe('  +--')
    expect((await ui.findAll({ type: 'Text', text: /^ctx / }))[0]!.text.length).toBe(before)
    w.usage = usageAt(18_000)
    await $.turn.complete(TURN)
    expect(await deltaOn(ui)).toBe('+3.0k')
    await ui.unmount()
  })
})
