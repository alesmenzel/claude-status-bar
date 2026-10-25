import { describe, expect, test } from 'claude-code/testing'

import type { BarData, Run } from '../hooks/register'
import { contextWindow, fit, isOverLimit, widthOf } from '../hooks/register'
import { ctx } from '../hooks/segments'
import { BUILTINS, ctxOf, EMPTY, HOUR, join, LAYOUT, UTC } from './fixtures'
import { BAND, START, world } from './world'

const MILLION = 1_000_000

// A 1M window, as the engine reports it: its own percent against its own window.
const at = (tokens: number | undefined, split = true): BarData => ({
  rateLimits: [],
  context: {
    window: MILLION,
    ...(tokens === undefined ? {} : { tokens, percent: Math.round((tokens / MILLION) * 1000) / 10 }),
  },
  ...(split && tokens !== undefined ? { split: { sys: tokens / 4, tools: tokens / 4, mcp: tokens / 4, conv: tokens / 4 } } : {}),
})
const runsAt = (data: BarData, contextLimit?: number, form: 'wide' | 'narrow' = 'wide') =>
  ctx.render(ctxOf(data, form, contextLimit === undefined ? {} : { contextLimit }))!
const draw = (data: BarData, contextLimit?: number, form: 'wide' | 'narrow' = 'wide') =>
  join(runsAt(data, contextLimit, form))
const percentOf = (runs: readonly Run[]) => runs.find(r => r.text.endsWith('%') || r.text.endsWith('x'))!
const filled = (runs: readonly Run[]) => runs.filter(r => r.text.startsWith('█')).reduce((n, r) => n + r.text.length, 0)

describe('contextWindow', () => {
  test('lowers the window to the limit, never raises it', async () => {
    expect(contextWindow(MILLION)).toBe(MILLION)
    expect(contextWindow(MILLION, 0)).toBe(MILLION)
    expect(contextWindow(MILLION, 256_000)).toBe(256_000)
    expect(contextWindow(200_000, 256_000)).toBe(200_000)
    expect(contextWindow(200_000, 200_000)).toBe(200_000)
    expect(contextWindow(200_000, -5)).toBe(200_000)
  })

  test('goes back to the engine window once the tokens pass the limit', async () => {
    expect(contextWindow(MILLION, 256_000, 256_000)).toBe(256_000)
    expect(contextWindow(MILLION, 256_000, 256_001)).toBe(MILLION)
    expect(contextWindow(MILLION, 256_000, undefined)).toBe(256_000)
    expect(isOverLimit(MILLION, 256_000, 256_000)).toBe(false)
    expect(isOverLimit(MILLION, 256_000, 256_001)).toBe(true)
    expect(isOverLimit(MILLION, 0, 900_000)).toBe(false)
    expect(isOverLimit(200_000, 256_000, 300_000)).toBe(false)
    expect(isOverLimit(MILLION, 256_000)).toBe(false)
  })
})

describe('the ctx segment with a contextLimit', () => {
  test('off (0 or left out): the engine window and its own percent', async () => {
    expect(draw(at(62_000))).toBe(`ctx ${'█'.repeat(2)}${'░'.repeat(38)}  62k/1.0M   6%   +--`)
    expect(draw(at(62_000), 0)).toBe(draw(at(62_000)))
  })

  test('lower than the window: the figure, percent and meter count against the limit', async () => {
    const runs = runsAt(at(64_000), 256_000)
    expect(join(runs)).toBe(`ctx ${'█'.repeat(10)}${'░'.repeat(30)}  64k/256k  25%   +--`)
    expect(filled(runs)).toBe(10)
    expect(percentOf(runs).color).toBeUndefined()
    expect(draw(at(128_000), 256_000)).toMatch(/ 128k\/256k  50%/)
    expect(filled(runsAt(at(192_000), 256_000))).toBe(30)
  })

  test('higher than the window: ignored', async () => {
    expect(draw(at(62_000), 2 * MILLION)).toBe(draw(at(62_000)))
    expect(draw(at(62_000), MILLION)).toBe(draw(at(62_000)))
  })

  test('colors the percentage against the limit at 50%, 75% and 90%', async () => {
    const color = (tokens: number) => percentOf(runsAt(at(tokens), 200_000)).color
    expect([100_000, 100_200, 150_000, 150_200, 180_000, 180_200].map(color)).toEqual([
      undefined,
      'blue',
      'blue',
      '#ff8700',
      '#ff8700',
      'magenta',
    ])
  })

  test('at the limit: still against the limit, 100%, window figure dim', async () => {
    const runs = runsAt(at(256_000), 256_000)
    expect(join(runs)).toBe(`ctx ${'█'.repeat(40)} 256k/256k 100%   +--`)
    expect(percentOf(runs)).toMatchObject({ text: '100%', color: 'magenta' })
    expect(runs.find(r => r.text === '/256k')!.color).toBeUndefined()
  })

  test('just over the limit: the engine window, its percent and meter, the window figure magenta', async () => {
    const runs = runsAt(at(256_001), 256_000)
    expect(join(runs)).toBe(`ctx ${'█'.repeat(10)}${'░'.repeat(30)} 256k/1.0M  26%   +--`)
    expect(runs.find(r => r.text === '/1.0M')).toMatchObject({ tone: 'label', color: 'magenta' })
    expect(percentOf(runs).color).toBeUndefined()
  })

  test('far over the limit: still against the engine window, colored by it', async () => {
    const runs = runsAt(at(320_000), 256_000)
    expect(join(runs)).toBe(`ctx ${'█'.repeat(13)}${'░'.repeat(27)} 320k/1.0M  32%   +--`)
    expect(filled(runs)).toBe(13)
    expect(runs.find(r => r.text === '/1.0M')!.color).toBe('magenta')
    const color = (tokens: number) => percentOf(runsAt(at(tokens), 256_000)).color
    expect([500_000, 501_000, 750_000, 751_000, 900_000, 901_000].map(color)).toEqual([
      undefined,
      'blue',
      'blue',
      '#ff8700',
      '#ff8700',
      'magenta',
    ])
    expect(percentOf(runsAt(at(900_000), 64_000))).toMatchObject({ text: ' 90%' })
  })

  test('colors the window figure only while the limit is passed', async () => {
    const windowRun = (tokens: number, limit?: number) => runsAt(at(tokens), limit).find(r => r.text.startsWith('/'))!
    expect(windowRun(62_000, 256_000).color).toBeUndefined()
    expect(windowRun(300_000, 256_000).color).toBe('magenta')
    expect(windowRun(300_000).color).toBeUndefined()
    expect(windowRun(300_000, 2 * MILLION).color).toBeUndefined()
  })

  test('keeps its width from no figure to far past the limit', async () => {
    for (const form of ['wide', 'narrow'] as const) {
      const width = draw(EMPTY, 256_000, form).length
      expect(draw(at(undefined), 256_000, form).length).toBe(width)
      for (const tokens of [0, 5, 950, 62_000, 255_999, 256_000, 256_001, 999_999, MILLION]) {
        expect(draw(at(tokens), 256_000, form).length, `${form} ${tokens}`).toBe(width)
        expect(draw(at(tokens), 1000, form).length, `${form} ${tokens} vs 1000`).toBe(width)
      }
    }
  })

  test('draws placeholders with no figure', async () => {
    expect(draw(EMPTY, 256_000)).toBe(`ctx ${'░'.repeat(40)}   --/  --  --%   +--`)
    expect(draw(at(undefined), 256_000)).toBe(`ctx ${'░'.repeat(40)}   --/256k  --%   +--`)
  })

  test('leaves the hover legend in absolute tokens', async () => {
    const hover = ctx.hover!(ctxOf(at(320_000), 'wide', { contextLimit: 256_000 }), 65)!
    expect(join(hover)).toBe('■ sys  80k  ■ tools  80k  ■ mcp  80k  ■ conv  80k')
  })

  test('keeps the bar within its columns', async () => {
    for (let columns = 0; columns <= 260; columns += 7) {
      const base = { now: 0, columns, budgetUsd: 0, ttlMs: HOUR, localTime: UTC, contextLimit: 256_000 }
      expect(widthOf(fit(LAYOUT, BUILTINS, { ...base, data: at(320_000) }))).toBeLessThanOrEqual(columns)
    }
  })
})

describe('contextLimit in a session', () => {
  test('the band counts against the limit', { options: { contextLimit: 256_000 } }, async ($, on) => {
    const w = world(on)
    w.usage = { startedAt: 0, context: { tokens: 64_000, window: MILLION, percent: 6.4 }, rateLimits: [] }
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(160))
    expect(await ui.find({ type: 'Text', text: / 64k\/256k  25%/ })).toBeDefined()
    await ui.unmount()
  })

  test('the band uses the engine window with the limit off', async ($, on) => {
    const w = world(on)
    w.usage = { startedAt: 0, context: { tokens: 64_000, window: MILLION, percent: 6.4 }, rateLimits: [] }
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(160))
    expect(await ui.find({ type: 'Text', text: / 64k\/1\.0M   6%/ })).toBeDefined()
    await ui.unmount()
  })
})
