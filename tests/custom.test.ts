import { describe, expect, test } from 'claude-code/testing'

import type { StatusBarSegmentSpec } from '../types'
import type { Segment } from '../hooks/register'
import { cleanSpec, compose, customSegment, fit, parseLayout, widthOf } from '../hooks/register'
import { BUILTINS, ctxOf, FULL, HOUR, join } from './fixtures'

const spec = (over: Partial<StatusBarSegmentSpec> & Record<string, unknown>): StatusBarSegmentSpec =>
  ({ id: 'clock', runs: [{ text: '12:00' }], ...over }) as StatusBarSegmentSpec
const clean = (over: Partial<StatusBarSegmentSpec> & Record<string, unknown>) => cleanSpec(spec(over))

describe('cleanSpec', () => {
  test('trims the id and copies the runs', async () => {
    expect(clean({ id: '  clock  ' })).toEqual({ id: 'clock', runs: [{ text: '12:00', tone: 'value' }] })
  })

  test('rejects a spec with no usable id', async () => {
    for (const id of ['', '   ', 5, null, undefined, {}]) {
      expect(clean({ id: id as never }), String(id)).toBeNull()
    }
  })

  test('rejects a spec whose runs are not a list', async () => {
    for (const runs of [undefined, null, 'clk', { text: 'x' }, 3]) {
      expect(clean({ runs: runs as never }), String(runs)).toBeNull()
    }
  })

  test('rejects a spec that is not an object', async () => {
    expect(cleanSpec(null as never)).toBeNull()
    expect(cleanSpec('clock' as never)).toBeNull()
  })

  test('drops entries that are not runs instead of failing', async () => {
    const out = clean({ runs: [null, 'x', {}, { text: undefined }, { text: 'ok' }, 7] as never })
    expect(out).toEqual({ id: 'clock', runs: [{ text: 'ok', tone: 'value' }] })
  })

  test('reads a number text as text, any tone but label as value', async () => {
    expect(clean({ runs: [{ text: 42 as never, tone: 'shout' as never }, { text: 'a', tone: 'label' }] })!.runs).toEqual([
      { text: '42', tone: 'value' },
      { text: 'a', tone: 'label' },
    ])
  })

  test('keeps a color string and drops an empty or non-string one', async () => {
    expect(
      clean({
        runs: [
          { text: 'a', color: 'success' },
          { text: 'b', color: '#00ff00' },
          { text: 'c', color: '' },
          { text: 'd', color: 3 as never },
        ],
      })!.runs.map(r => r.color),
    ).toEqual(['success', '#00ff00', undefined, undefined])
  })

  test('drops fields a run or spec does not have', async () => {
    const out = clean({ extra: true, runs: [{ text: 'a', onPress: () => {} } as never] })!
    expect(Object.keys(out)).toEqual(['id', 'runs'])
    expect(Object.keys(out.runs[0]!)).toEqual(['text', 'tone'])
  })

  test('keeps narrowRuns only when they are a list', async () => {
    expect(clean({ narrowRuns: [{ text: '12' }] })!.narrowRuns).toEqual([{ text: '12', tone: 'value' }])
    expect(clean({ narrowRuns: 'no' as never })).not.toHaveProperty('narrowRuns')
    expect(clean({ narrowRuns: [] })!.narrowRuns).toEqual([])
  })

  test('copies the runs, so later changes to the spec do not reach the bar', async () => {
    const runs = [{ text: 'before' }]
    const out = cleanSpec({ id: 'clock', runs })!
    runs[0]!.text = 'after'
    expect(out.runs[0]!.text).toBe('before')
  })
})

describe('customSegment', () => {
  const clock = customSegment(
    cleanSpec({ id: 'clock', runs: [{ text: 'clk ', tone: 'label' }, { text: '12:00' }], narrowRuns: [{ text: '12:00' }] })!,
  )
  const plain = customSegment(cleanSpec({ id: 'plain', runs: [{ text: 'plain' }] })!)
  const segments = new Map<string, Segment>([...BUILTINS, ['clock', clock], ['plain', plain]])

  test('draws its runs on a wide or crowded bar', async () => {
    expect(clock.id).toBe('clock')
    expect(join(clock.render(ctxOf(FULL)))).toBe('clk 12:00')
    expect(join(clock.render(ctxOf(FULL, 'crowded')))).toBe('clk 12:00')
  })

  test('draws its narrowRuns on a narrow bar', async () => {
    expect(clock.render(ctxOf(FULL, 'narrow'))).toEqual([{ text: '12:00', tone: 'value' }])
  })

  test('falls back to its runs on a narrow bar with no narrowRuns', async () => {
    expect(join(plain.render(ctxOf(FULL, 'narrow')))).toBe('plain')
  })

  test('takes its place in the layout beside the built-ins', async () => {
    const at = ctxOf(FULL, 'wide', { now: HOUR / 4 })
    expect(compose(parseLayout('cache+clock,plain'), segments, at).map(join)).toEqual(['cache 45:00  clk 12:00', 'plain'])
    expect(compose(parseLayout('clock'), segments, ctxOf(FULL, 'narrow')).map(join)).toEqual(['12:00'])
  })

  test('draws nothing for a segment with no runs', async () => {
    const blank = customSegment(cleanSpec({ id: 'blank', runs: [] })!)
    const withBlank = new Map(segments).set('blank', blank)
    expect(compose(parseLayout('blank+plain,blank'), withBlank, ctxOf(FULL)).map(join)).toEqual(['plain'])
  })

  test('is skipped once removed, and drawn once added back', async () => {
    const live = new Map(segments)
    const layout = parseLayout('plain,clock')
    expect(compose(layout, live, ctxOf(FULL)).map(join)).toEqual(['plain', 'clk 12:00'])
    live.delete('clock')
    expect(compose(layout, live, ctxOf(FULL)).map(join)).toEqual(['plain'])
    live.set('clock', clock)
    expect(compose(layout, live, ctxOf(FULL)).map(join)).toEqual(['plain', 'clk 12:00'])
  })

  test('counts toward the width the bar fits', async () => {
    const wide = customSegment(cleanSpec({ id: 'wide', runs: [{ text: 'x'.repeat(30) }], narrowRuns: [{ text: 'x' }] })!)
    const all = new Map(segments).set('wide', wide)
    const layout = parseLayout('limit5h+limit7d,ctx+legend,cost,cache,wide')
    for (const columns of [80, 120, 160, 220]) {
      expect(widthOf(fit(layout, all, { data: FULL, now: 0, columns, budgetUsd: 10, ttlMs: HOUR }))).toBeLessThanOrEqual(columns)
    }
  })
})
