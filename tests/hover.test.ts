import { describe, expect, test } from 'claude-code/testing'

import type { Run, Segment } from '../hooks/register'
import {
  cleanSpec,
  compose,
  customSegment,
  DEFAULT_SEGMENTS,
  fit,
  hoverAreaKey,
  parseLayout,
  plainText,
  runsWidth,
  widthOf,
} from '../hooks/register'
import { LEGEND_WIDTH, legendRuns } from '../hooks/segments/context'
import { BUILTINS, ctxOf, EMPTY, FULL, HOUR, join, LAYOUT, UTC } from './fixtures'
import { BAND, SOME_USAGE, START, world } from './world'

const ctxRuns = (form: 'wide' | 'crowded' | 'narrow', data = FULL, over = {}) =>
  compose([['ctx']], BUILTINS, ctxOf(data, form, over))[0]!
const hoverOf = (runs: readonly Run[]) => runs.find(r => r.hoverRuns !== undefined)?.hoverRuns

describe('the default segments', () => {
  test('show the legend on hover over ctx, not beside it', async () => {
    expect(DEFAULT_SEGMENTS).toBe('limit5h+limit7d,ctx,cost,cache')
    expect(LAYOUT.flat()).not.toContain('legend')
    const groups = fit(LAYOUT, BUILTINS, { data: FULL, now: 0, columns: 200, budgetUsd: 10, ttlMs: HOUR, localTime: UTC })
    expect(groups.map(join).join('')).not.toContain('■')
    expect(hoverOf(groups[1]!)!.map(r => r.text).join('')).toContain('■ conv  20k')
  })

  test('keep the legend id for a terminal with no pointer', async () => {
    expect(join(compose(parseLayout('ctx+legend'), BUILTINS, ctxOf(FULL))[0]!)).toContain('■ sys  10k')
  })
})

describe('the ctx hover view', () => {
  test('is the full legend in the meter cells on a wide or crowded bar', async () => {
    for (const form of ['wide', 'crowded'] as const) {
      const runs = ctxRuns(form)
      expect(runs.every(r => r.area === 'ctx')).toBe(true)
      const hover = hoverOf(runs)!
      expect(join(hover).trimEnd()).toBe('■ sys  10k  ■ tools  20k  ■ mcp  10k  ■ conv  20k')
      expect(runsWidth(hover)).toBe(runsWidth(runs))
    }
  })

  test('is the compact legend where the full one does not fit', async () => {
    const narrow = ctxRuns('narrow')
    expect(join(hoverOf(narrow)!).trimEnd()).toBe('■ 10k ■ 20k ■ 10k ■ 20k')
    expect(runsWidth(hoverOf(narrow)!)).toBe(runsWidth(narrow))
    // The narrowest meter still holds the compact legend: neither view is padded wider.
    const least = ctxRuns('narrow', FULL, { ctxCells: 6 })
    expect(runsWidth(least)).toBe(25)
    expect(runsWidth(hoverOf(least)!)).toBe(25)
    const shrunk = ctxRuns('crowded', FULL, { ctxCells: 16 })
    expect(join(shrunk)).not.toMatch(/ +$/)
    expect(join(hoverOf(shrunk)!).trimEnd()).toBe('■ 10k ■ 20k ■ 10k ■ 20k')
  })

  test('draws placeholders of the same width before the split is known', async () => {
    expect(join(hoverOf(ctxRuns('wide', EMPTY))!).trimEnd()).toBe('■ sys   --  ■ tools   --  ■ mcp   --  ■ conv   --')
    for (const form of ['wide', 'crowded', 'narrow'] as const) {
      expect(runsWidth(hoverOf(ctxRuns(form, EMPTY))!)).toBe(runsWidth(hoverOf(ctxRuns(form))!))
      expect(runsWidth(ctxRuns(form, EMPTY))).toBe(runsWidth(ctxRuns(form)))
    }
  })

  test('colors each square by its group', async () => {
    expect(legendRuns(FULL.split).filter(r => r.text === '■').map(r => r.color)).toEqual([
      'inactive',
      'suggestion',
      'merged',
      'claude',
    ])
    expect(runsWidth(legendRuns(FULL.split))).toBe(LEGEND_WIDTH.full)
    expect(runsWidth(legendRuns(FULL.split, 30))).toBe(LEGEND_WIDTH.compact)
  })

  test('is left out of the plain-text status line', async () => {
    const groups = fit(LAYOUT, BUILTINS, { data: FULL, now: 0, columns: 100, budgetUsd: 10, ttlMs: HOUR, localTime: UTC })
    expect(plainText(groups)).not.toContain('■')
  })
})

describe('custom hoverRuns', () => {
  const tip = (runs: string, hover: string): Segment =>
    customSegment(cleanSpec({ id: 'tip', runs: [{ text: runs }], hoverRuns: [{ text: hover, color: 'success' }] })!)

  test('cleanSpec keeps hoverRuns only when they are a list, cleaned', async () => {
    expect(cleanSpec({ id: 'x', runs: [], hoverRuns: [{ text: 'h' }, null as never] })!.hoverRuns).toEqual([
      { text: 'h', tone: 'value' },
    ])
    expect(cleanSpec({ id: 'x', runs: [], hoverRuns: 'h' as never })).not.toHaveProperty('hoverRuns')
  })

  test('pad the shorter view, so the two take the same cells', async () => {
    const segments = new Map([['tip', tip('ab', 'longer hover')]])
    const runs = compose([['tip']], segments, ctxOf(FULL))[0]!
    expect(join(runs)).toBe('ab          ')
    expect(join(hoverOf(runs)!)).toBe('longer hover')
    const short = compose([['tip']], new Map([['tip', tip('a long view', 'h')]]), ctxOf(FULL))[0]!
    expect(join(short)).toBe('a long view')
    expect(join(hoverOf(short)!)).toBe('h          ')
    expect(hoverOf(short)![0]).toEqual({ text: 'h', tone: 'value', color: 'success' })
  })

  test('draw no hover view for an empty hoverRuns', async () => {
    const segments = new Map([['tip', tip('ab', '')]])
    const plain = customSegment(cleanSpec({ id: 'tip', runs: [{ text: 'ab' }], hoverRuns: [] })!)
    expect(hoverOf(compose([['tip']], new Map([['tip', plain]]), ctxOf(FULL))[0]!)).toBeUndefined()
    // A hover view of one empty run still lines up.
    expect(runsWidth(hoverOf(compose([['tip']], segments, ctxOf(FULL))[0]!)!)).toBe(2)
  })

  test('count toward the width the bar fits, and go when the bar is cut', async () => {
    const segments = new Map([...BUILTINS, ['tip', tip('t', 'x'.repeat(40))]])
    const layout = parseLayout('limit5h+limit7d,ctx,cost,cache,tip')
    for (let columns = 0; columns <= 260; columns += 3) {
      const groups = fit(layout, segments, { data: FULL, now: 0, columns, budgetUsd: 10, ttlMs: HOUR, localTime: UTC })
      expect(widthOf(groups)).toBeLessThanOrEqual(columns)
      for (const runs of groups) {
        const hover = hoverOf(runs)
        if (hover !== undefined) expect(runsWidth(hover)).toBe(runsWidth(runs.filter(r => r.area === runs.find(h => h.hoverRuns)!.area)))
      }
    }
    // Cut to 10 columns, the one group left has no hover view.
    const cut = fit(parseLayout('ctx'), BUILTINS, { data: FULL, now: 0, columns: 10, budgetUsd: 10, ttlMs: HOUR })
    expect(cut[0]!.some(r => r.hoverRuns !== undefined || r.area !== undefined)).toBe(false)
  })
})

describe('the drawn hover area', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`draws both views in one keyed Box on ${surface}`, async ($, on) => {
      const w = world(on)
      w.usage = SOME_USAGE
      await $.session.start(START)
      for (const columns of [80, 160, 220]) {
        const ui = await $.ui.mount({ ...(BAND(columns) as object), surface } as never)
        const area = (await ui.find({ type: 'Box', key: hoverAreaKey('ctx') }))!
        expect(area, `${columns} columns`).toBeDefined()
        const [own, overlay] = area.children as { type: string; props: Record<string, unknown>; hover?: unknown; children: unknown[] }[]
        expect(own!.type).toBe('Text')
        expect(overlay).toMatchObject({
          type: 'Box',
          props: { position: 'absolute', top: 0, left: 0, display: 'none' },
          hover: { display: 'flex' },
        })
        // Both views take the area's width: nothing moves on hover.
        const ownText = (await ui.findAll({ type: 'Text', text: /^ctx / }))[0]!.text
        const hoverText = (await ui.findAll({ type: 'Text', text: /^■/ }))[0]!.text
        expect(ownText.length).toBe(area.props.width)
        expect(hoverText.length).toBe(area.props.width)
        expect(overlay!.props.width).toBe(area.props.width)
        expect(hoverText).toMatch(columns < 138 ? /^■ +(\d+k|--) ■/ : /^■ sys +(\d+k|--)  ■ tools/)
        await ui.unmount()
      }
    })
  }

  test('leaves groups with no hover view as one Text', async ($, on) => {
    world(on)
    const ui = await $.ui.mount(BAND(160))
    const root = (await ui.drawn()) as unknown as { children: { type: string; key?: string }[] }
    expect(root.children.map(c => c.type)).toEqual(['Text', 'Box', 'Text', 'Text'])
    await ui.unmount()
  })

  test('draws no hover area with the legend beside the meter', { options: { segments: 'ctx+legend' } }, async ($, on) => {
    world(on)
    const ui = await $.ui.mount(BAND(160))
    // ctx still has its hover view; the legend beside it draws no hover of its own.
    expect(await ui.findAll({ type: 'Box', key: hoverAreaKey('ctx') })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Box', key: hoverAreaKey('legend') })).toHaveLength(0)
    await ui.unmount()
  })
})
