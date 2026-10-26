import { describe, expect, mock, test } from 'claude-code/testing'
import type { ContextCategory } from 'claude-code'

import type { BarData, Run, SegmentContext } from '../hooks/register'
import {
  BUILTIN_SEGMENTS,
  cleanSpec,
  customSegment,
  fit,
  widthOf,
  clockText,
  compose,
  DEFAULT_SEGMENTS,
  kTokens,
  levelColor,
  meter,
  parseLayout,
  percentText,
  readConfig,
  splitContext,
} from '../hooks/register'

const row = (name: string, tokens: number, kind: ContextCategory['kind'] = 'used'): ContextCategory => ({
  name,
  tokens,
  kind,
  color: 'inactive',
  isDeferred: kind === 'deferred',
})

const BUILTINS = new Map(BUILTIN_SEGMENTS.map(s => [s.id, s]))
// The bar with the legend beside the meter (the default shows it on hover).
const LAYOUT = parseLayout('limit5h+limit7d,ctx+legend,cost,cache')

const full: BarData = {
  rateLimits: [
    { kind: 'five_hour', percentUsed: 25 },
    { kind: 'seven_day', percentUsed: 50 },
  ],
  context: { tokens: 62_000, window: 200_000, percent: 31 },
  split: { sys: 10_000, mcp: 10_000, tools: 20_000, conv: 20_000 },
  cost: { usd: 1.237 },
  lastResponseAt: 0,
}
const empty: BarData = { rateLimits: [] }

const ctxAt = (data: BarData, columns: number, now = 3_600_000 - 272_000): SegmentContext => ({
  data,
  now,
  columns,
  isNarrow: columns < 110,
  isCrowded: columns < 110,
  ctxCells: columns < 110 ? 20 : 40,
  budgetUsd: 10,
  ttlMs: 3_600_000,
})
const join = (runs: readonly Run[]): string => runs.map(r => r.text).join('')
const texts = (data: BarData, columns: number, now?: number): string[] =>
  compose(LAYOUT, BUILTINS, ctxAt(data, columns, now)).map(join)

describe('status-bar', () => {
  test('splits context rows into sys, mcp, tools and conv', async () => {
    const split = splitContext([
      row('System prompt', 3000),
      row('System tools', 12000),
      row('MCP tools', 8000),
      row('Memory files', 2000),
      row('Skills', 1000),
      row('Messages', 40000),
      row('Free space', 100000, 'free'),
      row('Autocompact buffer', 33000, 'buffer'),
      row('MCP tools (deferred)', 9000, 'deferred'),
    ])
    expect(split).toEqual({ sys: 6000, mcp: 8000, tools: 12000, conv: 40000 })
  })

  test('pads tokens, percentages and the cache clock to a fixed width', async () => {
    expect(kTokens(950)).toBe(' 950')
    expect(kTokens(62_400)).toBe(' 62k')
    expect(kTokens(1_200_000)).toBe('1.2M')
    expect([0.05, 0.25, 1].map(percentText)).toEqual(['  5%', ' 25%', '100%'])
    expect(clockText(34_000)).toBe('00:34')
    expect(clockText(272_000)).toBe('04:32')
    expect(clockText(3_599_000)).toBe('59:59')
  })
})

test('draws meters and the context split on a wide bar', async () => {
  expect(texts(full, 160)).toEqual([
    '5h ━━──────  25% ↻--:--  7d ━━━━────  50% ↻--- --:--',
    'ctx ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  62k/200k  31%   +--  ■ sys  10k  ■ tools  20k  ■ mcp  10k  ■ conv  20k',
    '   $1.24 / $10 ━───────  12%',
    'cache 04:32',
  ])
})

test('shortens the meters and drops the legend on a narrow bar', async () => {
  expect(texts(full, 80)).toEqual([
    '5h  25%  7d  50%',
    'ctx ██████░░░░░░░░░░░░░░  62k/200k  31%',
    '   $1.24 / $10  12%',
    'cache 04:32',
  ])
})

test('draws placeholders of the same width with no data', async () => {
  for (const columns of [160, 80]) {
    // The limit windows outlive /clear: only the session's figures go.
    const before = texts({ rateLimits: full.rateLimits }, columns)
    const after = texts(full, columns)
    expect(before.map(t => t.length)).toEqual(after.map(t => t.length))
  }
  expect(texts({ rateLimits: full.rateLimits }, 160)[3]).toBe('cache --:--')
})

test('colors each context cell by its group', async () => {
  const ctx = compose([['ctx']], BUILTINS, ctxAt(full, 160))[0]!
  const plain = ctx.map(({ area: _area, hoverRuns: _hover, ...run }) => run)
  expect(plain.filter(r => r.color !== undefined && r.text.startsWith('█'))).toEqual([
    { text: '██', tone: 'value', color: 'inactive' },
    { text: '████', tone: 'value', color: 'suggestion' },
    { text: '██', tone: 'value', color: 'merged' },
    { text: '████', tone: 'value', color: 'claude' },
  ])
})

test('colors meters and the cache clock above 50%, 75% and 90%', async () => {
  expect([0.5, 0.51, 0.75, 0.76, 0.9, 0.91].map(levelColor)).toEqual([
    undefined,
    'blue',
    'blue',
    '#ff8700',
    '#ff8700',
    'magenta',
  ])
  expect(meter(0.8, 8)[0]).toEqual({ text: '━━━━━━', tone: 'value', color: '#ff8700' })
  const cacheColor = (elapsedMs: number) =>
    compose([['cache']], BUILTINS, ctxAt(full, 160, elapsedMs))[0]!.at(-1)!.color
  expect([60_000, 1_900_000, 2_800_000, 3_300_000, 3_700_000].map(cacheColor)).toEqual([
    undefined,
    'blue',
    '#ff8700',
    'magenta',
    'magenta',
  ])
  // A fresh 1h cache reads 59:59, a cold one 00:00.
  expect(join(compose([['cache']], BUILTINS, ctxAt(full, 160, 0))[0]!)).toBe('cache 59:59')
  expect(join(compose([['cache']], BUILTINS, ctxAt(full, 160, 4_000_000))[0]!)).toBe('cache 00:00')
})

test('lays the bar out from the segments option, skipping unknown ids', async () => {
  expect(parseLayout(' cache , nope+cost,, ctx + legend ')).toEqual([['cache'], ['nope', 'cost'], ['ctx', 'legend']])
  expect(compose(parseLayout('nope,cache'), BUILTINS, ctxAt(full, 160)).map(join)).toEqual(['cache 04:32'])
  expect(readConfig({ segments: 'cost', position: 'sideways', budgetUsd: -1 })).toMatchObject({
    layout: [['cost']],
    position: 'above',
    budgetUsd: 0,
    isShown: true,
  })
})

const BAND = {
  plugin: 'status-bar',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } as never,
} as const

test('draws the band above the prompt on terminal and desktop', async ($, on) => {
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', () => null as never) // the engine's own band: nothing
  mock.clock(on, { now: 0 })
  await $.session.measure({
    context: { tokens: 62_000, window: 200_000, percent: 31 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 25 }],
    cost: { usd: 1.24 },
    changed: ['context', 'rateLimits', 'cost'],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    expect(await ui.find({ type: 'Text', text: /62k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /--:--/ })).toBeDefined()
    await ui.unmount()
  }
})

test('draws a placeholder band before any data', async ($, on) => {
  on('ui.render', () => null as never)
  mock.clock(on, { now: 0 })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /--:--/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / --%/ })).toBeDefined()
  await ui.unmount()
})

test('draws a segment another mod publishes, narrow runs on a narrow bar', async () => {
  const spec = cleanSpec({
    id: ' clock ',
    runs: [{ text: 'clk ', tone: 'label' }, { text: '12:00', color: 'success' }],
    narrowRuns: [{ text: '12:00' }],
  })!
  expect(spec.id).toBe('clock')
  const segments = new Map([...BUILTINS, ['clock', customSegment(spec)]])
  expect(compose([['cache', 'clock']], segments, ctxAt(full, 160)).map(join)).toEqual(['cache 04:32  clk 12:00'])
  expect(compose([['clock']], segments, ctxAt(full, 80))[0]).toEqual([{ text: '12:00', tone: 'value' }])
  expect(cleanSpec({ id: ' ', runs: [] })).toBeNull()
})

test('draws the bar under the prompt hint with position below', { options: { position: 'below' } }, async ($, on) => {
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: '? for shortcuts' }))
  mock.clock(on, { now: 0 })
  const ui = await $.ui.mount({
    plugin: 'status-bar',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } as never,
  })
  expect(await ui.find({ type: 'Text', text: /--:--/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /for shortcuts/ })).toBeDefined()
  await ui.unmount()
})

test('shrinks the context meter, then goes narrow, so the bar fits its width', async () => {
  const base = { data: full, now: 0, budgetUsd: 10, ttlMs: 3_600_000 }
  for (const columns of [220, 200, 160, 130, 110, 80]) {
    expect(widthOf(fit(LAYOUT, BUILTINS, { ...base, columns }))).toBeLessThanOrEqual(columns)
  }
  const at = (columns: number) => fit(LAYOUT, BUILTINS, { ...base, columns }).map(join)
  // 220 columns: everything, the context meter at its full 40 cells.
  expect(at(220)[1]).toContain('█'.repeat(12) + '░'.repeat(28) + ' ')
  expect(at(220)[1]).toContain('■ conv')
  // 160 columns: no room for the legend; the meters stay.
  expect(at(160)[0]).toContain('━━──────')
  expect(at(160)[1]).not.toContain('■')
  // 80 columns: narrow, no meters.
  expect(at(80)[0]).toBe('5h  25%  7d  50%')
})
