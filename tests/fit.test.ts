import { describe, expect, test } from 'claude-code/testing'

import type { BarData, Run } from '../hooks/register'
import { compose, CTX_CELLS, fit, parseLayout, plainText, WIDE_COLUMNS, widthOf } from '../hooks/register'
import { BUILTINS, ctxOf, EMPTY, ENTERPRISE, FULL, HOUR, join, LAYOUT, limits, LIMITS_ONLY, UTC } from './fixtures'

const base = (data: BarData, columns: number, budgetUsd = 10) => ({ data, now: HOUR / 4, columns, budgetUsd, ttlMs: HOUR, localTime: UTC })
const fitAt = (columns: number, data: BarData = FULL, layout = LAYOUT, budgetUsd = 10) =>
  fit(layout, BUILTINS, base(data, columns, budgetUsd))
const texts = (groups: readonly (readonly Run[])[]) => groups.map(join)
const ctxCellsOf = (groups: readonly (readonly Run[])[]) =>
  (texts(groups).join('').match(/[█░]/g) ?? []).length

// Data with only some figures: limits and context, no split, cost or cache.
const PARTIAL: BarData = { rateLimits: limits(80, 40), context: { tokens: 150_000, window: 200_000, percent: 75 } }

describe('compose', () => {
  test('joins segments of a group with two spaces', async () => {
    expect(texts(compose(parseLayout('limit5h+cache'), BUILTINS, ctxOf(FULL, 'narrow', { now: HOUR / 4 })))).toEqual([
      '5h  25%  cache 45:00',
    ])
  })

  test('skips unknown ids and drops groups left empty', async () => {
    const groups = compose(parseLayout('nope,nope+cache,also-nope'), BUILTINS, ctxOf(FULL, 'narrow', { now: HOUR / 4 }))
    expect(texts(groups)).toEqual(['cache 45:00'])
  })

  test('skips a segment that draws nothing, with no stray gap', async () => {
    const groups = compose(parseLayout('legend+cache,legend'), BUILTINS, ctxOf(FULL, 'crowded', { now: HOUR / 4 }))
    expect(texts(groups)).toEqual(['cache 45:00'])
  })

  test('answers no groups for an empty layout', async () => {
    expect(compose([], BUILTINS, ctxOf(FULL))).toEqual([])
    expect(widthOf([])).toBe(0)
  })
})

describe('widthOf', () => {
  test('counts every run and two cells between groups', async () => {
    expect(widthOf([[{ text: 'abc' }], [{ text: 'de' }, { text: 'f' }]])).toBe(3 + 3 + 2)
    expect(widthOf([[{ text: 'abc' }]])).toBe(3)
  })
})

describe('fit', () => {
  // The bar with the legend beside the meter, for a terminal with no pointer.
  const LEGEND = parseLayout('limit5h+limit7d,ctx+legend,cost,cache')

  test('draws the default bar wide, meters and reset times, from 138 columns', async () => {
    const groups = fitAt(260)
    expect(texts(groups)[0]).toBe('5h ━━──────  25% ↻12:20  7d ━━━━────  50% ↻Mon 09:00')
    expect(texts(groups)[1]).toBe(`ctx ${'█'.repeat(12)}${'░'.repeat(28)}  62k/200k  31%   +--`)
    expect(ctxCellsOf(groups)).toBe(CTX_CELLS.wide)
    expect(widthOf(groups)).toBe(162)
    expect(ctxCellsOf(fitAt(150))).toBe(28)
    expect(ctxCellsOf(fitAt(138))).toBe(16)
    expect(texts(fitAt(138))[0]).toContain('↻Mon 09:00')
  })

  test('draws the legend beside the meter where the layout names it and it fits', async () => {
    const groups = fitAt(260, FULL, LEGEND)
    expect(texts(groups)[1]).toContain('■ conv  20k')
    expect(widthOf(groups)).toBe(213)
    expect(ctxCellsOf(fitAt(196, FULL, LEGEND))).toBe(23)
    // 16 cells is as far as the wide form shrinks; then the legend goes.
    expect(ctxCellsOf(fitAt(189, FULL, LEGEND))).toBe(16)
    expect(texts(fitAt(189, FULL, LEGEND))[1]).toContain('■')
    expect(texts(fitAt(188, FULL, LEGEND)).join('')).not.toContain('■')
    expect(ctxCellsOf(fitAt(188, FULL, LEGEND))).toBe(CTX_CELLS.wide)
  })

  test('goes narrow, without meters, reset times or delta, below 138 columns', async () => {
    const groups = fitAt(137)
    expect(texts(groups)[0]).toBe('5h  25%  7d  50%')
    expect(texts(groups)[1]).toBe(`ctx ${'█'.repeat(6)}${'░'.repeat(14)}  62k/200k  31%`)
    expect(texts(groups)[2]).toBe('   $1.24 / $10  12%')
    expect(ctxCellsOf(fitAt(80))).toBe(9)
    expect(ctxCellsOf(fitAt(77))).toBe(6)
  })

  test('draws the spend limit in place of the 5h and 7d windows on an Enterprise seat', async () => {
    expect(texts(fitAt(260, ENTERPRISE))[0]).toBe('spend ━───────  10%')
    expect(texts(fitAt(100, ENTERPRISE))[0]).toBe('spend  10%')
  })

  test('is always narrow below 110 columns, even where the wide form fits', async () => {
    expect(WIDE_COLUMNS).toBe(110)
    const one = parseLayout('limit5h')
    expect(texts(fitAt(109, FULL, one))).toEqual(['5h  25%'])
    expect(texts(fitAt(110, FULL, one))).toEqual(['5h ━━──────  25% ↻12:20'])
    const ctxOnly = parseLayout('ctx')
    expect(ctxCellsOf(fitAt(109, FULL, ctxOnly))).toBe(CTX_CELLS.narrow)
    expect(ctxCellsOf(fitAt(110, FULL, ctxOnly))).toBe(CTX_CELLS.wide)
  })

  test('drops groups from the right where even the narrow form is too wide', async () => {
    expect(texts(fitAt(76)).length).toBe(3)
    expect(texts(fitAt(76)).at(-1)).toBe('   $1.24 / $10  12%')
    expect(texts(fitAt(60))).toEqual(['5h  25%  7d  50%', `ctx ${'█'.repeat(2)}${'░'.repeat(4)}  62k/200k  31%`])
    expect(texts(fitAt(20))).toEqual(['5h  25%  7d  50%'])
    // The one group left is cut to the width.
    expect(texts(fitAt(10))).toEqual(['5h  25%  7'])
    expect(fitAt(0)).toEqual([])
  })

  test('never exceeds its columns', async () => {
    for (const data of [FULL, EMPTY, PARTIAL]) {
      for (const layout of [LAYOUT, parseLayout('ctx+legend+cost+cache+limit5h+limit7d+limitSpend'), parseLayout('cache')]) {
        for (const budgetUsd of [0, 10]) {
          for (let columns = 0; columns <= 260; columns++) {
            const width = widthOf(fitAt(columns, data, layout, budgetUsd))
            expect(width <= columns, `${columns} columns drew ${width}`).toBe(true)
          }
        }
      }
    }
  })

  test('fills the bar exactly as far as the meter can shrink', async () => {
    for (let columns = 138; columns <= 162; columns++) expect(widthOf(fitAt(columns))).toBe(columns)
    for (let columns = 77; columns <= 91; columns++) expect(widthOf(fitAt(columns))).toBe(columns)
    const legend = parseLayout('limit5h+limit7d,ctx+legend,cost,cache')
    for (let columns = 189; columns <= 213; columns++) expect(widthOf(fitAt(columns, FULL, legend))).toBe(columns)
    for (let columns = 138; columns <= 162; columns++) expect(widthOf(fitAt(columns, FULL, legend))).toBe(columns)
  })
})

describe('no layout shift', () => {
  test('the bar has the same groups and widths with no data as with data, at every width', async () => {
    for (let columns = 0; columns <= 260; columns++) {
      for (const budgetUsd of [0, 10]) {
        const widths = (data: BarData) => fitAt(columns, data, LAYOUT, budgetUsd).map(runs => join(runs).length)
        const full = widths(FULL)
        expect(widths(LIMITS_ONLY), `${columns} columns, empty`).toEqual(full)
        expect(widths(PARTIAL), `${columns} columns, partial`).toEqual(full)
      }
    }
  })

  test('the bar keeps its width as the figures grow', async () => {
    const width = widthOf(fitAt(160, LIMITS_ONLY))
    for (const [percent, usd, tokens] of [
      [0, 0, 0],
      [5, 0.05, 5],
      [99, 9.99, 99_000],
      [100, 10, 200_000],
      [100, 999.99, 999_999],
    ] as const) {
      const data: BarData = {
        rateLimits: limits(percent, percent),
        context: { tokens, window: 1_000_000, percent },
        split: { sys: tokens, mcp: tokens, tools: tokens, conv: tokens },
        cost: { usd },
        lastResponseAt: 0,
      }
      expect(widthOf(fitAt(160, data)), `${percent}% $${usd} ${tokens}`).toBe(width)
    }
  })
})

describe('plainText', () => {
  test('joins trimmed groups with a dot', async () => {
    expect(plainText(fitAt(100))).toBe(
      `5h  25%  7d  50%  ·  ctx ${'█'.repeat(6)}${'░'.repeat(14)}  62k/200k  31%  ·  $1.24 / $10  12%  ·  cache 45:00`,
    )
    expect(plainText([])).toBe('')
  })
})
