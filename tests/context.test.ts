import type { ContextCategory } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import type { BarData } from '../hooks/register'
import { GROUP_COLORS, splitContext, stackedMeter } from '../hooks/register'
import { ctx, legend } from '../hooks/segments'
import { ctxOf, EMPTY, FULL, join } from './fixtures'

const row = (name: string, tokens: number, kind: ContextCategory['kind'] = 'used'): ContextCategory => ({
  name,
  tokens,
  kind,
  color: 'inactive',
  isDeferred: kind === 'deferred',
})

const withContext = (tokens: number, window: number, percent: number): BarData => ({
  rateLimits: [],
  context: { tokens, window, percent },
})

describe('ctx segment', () => {
  test('draws the stacked meter, tokens, window and percentage', async () => {
    expect(join(ctx.render(ctxOf(FULL)))).toBe(
      `ctx ${'█'.repeat(12)}${'░'.repeat(28)}  62k/200k  31%   +--`,
    )
    expect(join(ctx.render(ctxOf(FULL, 'narrow')))).toBe(`ctx ${'█'.repeat(6)}${'░'.repeat(14)}  62k/200k  31%`)
  })

  test('draws as many meter cells as it is given', async () => {
    for (const cells of [6, 16, 20, 33, 40]) {
      const meter = join(ctx.render(ctxOf(FULL, 'wide', { ctxCells: cells }))).slice(4, 4 + cells)
      expect(meter).toMatch(new RegExp(`^[█░]{${cells}}$`))
    }
  })

  test('draws empty cells and -- placeholders before the first figure', async () => {
    expect(join(ctx.render(ctxOf(EMPTY)))).toBe(`ctx ${'░'.repeat(40)}   --/  --  --%   +--`)
    expect(join(ctx.render(ctxOf(EMPTY, 'narrow')))).toBe(`ctx ${'░'.repeat(20)}   --/  --  --%`)
  })

  test('draws an empty meter when the context has figures but no split yet', async () => {
    expect(join(ctx.render(ctxOf(withContext(62_000, 200_000, 31))))).toBe(`ctx ${'░'.repeat(40)}  62k/200k  31%   +--`)
  })

  test('keeps its width for every figure, from empty to a full 1M window', async () => {
    const width = join(ctx.render(ctxOf(EMPTY))).length
    for (const [tokens, window, percent] of [
      [0, 200_000, 0],
      [5, 200_000, 0],
      [950, 200_000, 0.5],
      [99_000, 200_000, 49.5],
      [200_000, 200_000, 100],
      [999_999, 1_000_000, 99.9],
      [1_000_000, 1_000_000, 100],
    ] as const) {
      expect(join(ctx.render(ctxOf(withContext(tokens, window, percent)))).length, `${tokens}/${window}`).toBe(width)
    }
  })

  test('colors each cell by its group in sys, tools, mcp, conv order', async () => {
    const runs = ctx.render(ctxOf(FULL))!.filter(r => r.text.startsWith('█'))
    expect(runs.map(r => [r.text.length, r.color])).toEqual([
      [2, GROUP_COLORS.sys],
      [4, GROUP_COLORS.tools],
      [2, GROUP_COLORS.mcp],
      [4, GROUP_COLORS.conv],
    ])
  })

  test('colors the percentage past 50%, 75% and 90%, never the tokens', async () => {
    const at = (percent: number) => ctx.render(ctxOf({ ...FULL, context: { tokens: percent * 2000, window: 200_000, percent } }))!
    const color = (percent: number) => at(percent).find(r => r.text.endsWith('%'))?.color
    expect([50, 51, 75, 76, 90, 91].map(color)).toEqual([undefined, 'blue', 'blue', '#ff8700', '#ff8700', 'magenta'])
    expect(at(95).find(r => r.text === '190k')?.color).toBeUndefined()
    expect(at(95).find(r => r.text.startsWith('/'))?.color).toBeUndefined()
  })
})

describe('stackedMeter', () => {
  const cells = (split: Parameters<typeof stackedMeter>[0], window: number, width: number) =>
    stackedMeter(split, window, width).reduce((n, r) => n + r.text.length, 0)

  test('always takes exactly its width', async () => {
    const split = { sys: 1, mcp: 1, tools: 1, conv: 1 }
    for (const width of [1, 6, 20, 40]) {
      expect(cells(undefined, 0, width)).toBe(width)
      expect(cells(split, 3, width)).toBe(width)
      expect(cells({ sys: 0, mcp: 0, tools: 0, conv: 0 }, 100, width)).toBe(width)
      // A split larger than the window fills the meter and goes no further.
      expect(cells({ sys: 500, mcp: 500, tools: 500, conv: 500 }, 100, width)).toBe(width)
    }
  })

  test('rounds the running total so the cells add up to the fill', async () => {
    // Each group alone is 1.5 cells; the four together are 6.
    const runs = stackedMeter({ sys: 15, mcp: 15, tools: 15, conv: 15 }, 100, 10)
    expect(runs.filter(r => r.text.startsWith('█')).reduce((n, r) => n + r.text.length, 0)).toBe(6)
  })

  test('draws every cell empty with a zero window', async () => {
    expect(join(stackedMeter({ sys: 10, mcp: 10, tools: 10, conv: 10 }, 0, 8))).toBe('░'.repeat(8))
  })
})

describe('legend segment', () => {
  test('draws each group with its tokens on a wide bar', async () => {
    expect(join(legend.render(ctxOf(FULL)))).toBe('■ sys  10k  ■ tools  20k  ■ mcp  10k  ■ conv  20k')
  })

  test('draws nothing on a crowded or narrow bar', async () => {
    expect(legend.render(ctxOf(FULL, 'crowded'))).toBeNull()
    expect(legend.render(ctxOf(FULL, 'narrow'))).toBeNull()
  })

  test('draws placeholders of the same width before the split is known', async () => {
    const empty = join(legend.render(ctxOf(EMPTY)))
    expect(empty).toBe('■ sys   --  ■ tools   --  ■ mcp   --  ■ conv   --')
    expect(empty.length).toBe(join(legend.render(ctxOf(FULL))).length)
    const big = { ...FULL, split: { sys: 999_999, mcp: 0, tools: 5, conv: 1_500_000 } }
    expect(join(legend.render(ctxOf(big))).length).toBe(empty.length)
  })

  test('colors each square by its group', async () => {
    const squares = legend.render(ctxOf(FULL))!.filter(r => r.text === '■')
    expect(squares.map(r => r.color)).toEqual(['inactive', 'suggestion', 'merged', 'claude'])
  })
})

describe('splitContext', () => {
  test('groups used rows into sys, mcp, tools and conv', async () => {
    expect(
      splitContext([
        row('System prompt', 3000),
        row('System tools', 12000),
        row('MCP tools', 8000),
        row('Custom agents', 500),
        row('Memory files', 2000),
        row('Messages', 40000),
      ]),
    ).toEqual({ sys: 5500, mcp: 8000, tools: 12000, conv: 40000 })
  })

  test('skips free, buffer and deferred rows', async () => {
    expect(
      splitContext([row('Free space', 1000, 'free'), row('Autocompact buffer', 2000, 'buffer'), row('MCP tools', 3000, 'deferred')]),
    ).toEqual({ sys: 0, mcp: 0, tools: 0, conv: 0 })
  })

  test('matches names without regard to case, mcp before tools', async () => {
    expect(splitContext([row('mcp TOOLS', 10), row('TOOLS', 20), row('messages', 30)])).toEqual({
      sys: 0,
      mcp: 10,
      tools: 20,
      conv: 30,
    })
  })

  test('answers zeros for no rows', async () => {
    expect(splitContext([])).toEqual({ sys: 0, mcp: 0, tools: 0, conv: 0 })
  })
})
