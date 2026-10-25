import { describe, expect, test } from 'claude-code/testing'

import { readConfig } from '../hooks/register'
import { cost, limitSpend } from '../hooks/segments'
import { ctxOf, EMPTY, join } from './fixtures'
import type { World } from './world'
import { BAND, END_CLEAR, NO_USAGE, SOME_USAGE, START, world } from './world'

// The cost group as the band draws it.
const costText = async (ui: { findAll: (q: { type: string; text: RegExp }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text', text: /\$(-\.--|\d+\.\d\d)/ }))[0]!.text

const spent = (w: World, usd: number | undefined) => {
  w.usage = { ...SOME_USAGE, ...(usd === undefined ? { cost: undefined } : { cost: { usd } }) }
}

describe('the session budget', () => {
  test('is none by default: the engine gives mods no account budget in dollars', async () => {
    // The manifest's default.
    expect(readConfig({ budgetUsd: 0 }).budgetUsd).toBe(0)
  })

  test('with none, the cost segment draws the spend alone, fixed width', async ($, on) => {
    const w = world(on)
    spent(w, 1.24)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(160))
    const text = await costText(ui)
    expect(text).toBe('   $1.24')
    expect(text).not.toContain('/')
    expect(text).not.toContain('%')
    expect(text).not.toContain('━')
    await ui.unmount()
  })

  test('with none, the spend keeps its width from no figure to $9999.99 and across /clear', async ($, on) => {
    const w = world(on)
    spent(w, undefined)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(160))
    const width = (await costText(ui)).length
    for (const usd of [0, 0.05, 12.5, 999.99, 9999.99]) {
      spent(w, usd)
      await $.session.start(START)
      expect((await costText(ui)).length, `$${usd}`).toBe(width)
    }
    w.usage = NO_USAGE
    await $.session.end(END_CLEAR)
    expect(await costText(ui)).toBe('   $-.--')
    await ui.unmount()
  })

  test('budgetUsd above 0 overrides: / $budget, a meter and the share', { options: { budgetUsd: 10 } }, async ($, on) => {
    const w = world(on)
    spent(w, 9.5)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(160))
    expect(await costText(ui)).toBe('   $9.50 / $10 ━━━━━━━━  95%')
    const share = (await ui.findAll({ type: 'Text', text: /^ 95%$/ }))[0]!
    expect(share.props.color).toBe('magenta')
    await ui.unmount()
  })

  test('the budget form keeps its width from no figure to past the budget', { options: { budgetUsd: 10 } }, async ($, on) => {
    const w = world(on)
    spent(w, undefined)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(160))
    expect(await costText(ui)).toBe('   $-.-- / $10 ────────  --%')
    const width = (await costText(ui)).length
    for (const usd of [0, 5, 10, 99.99, 150]) {
      spent(w, usd)
      await $.session.start(START)
      expect((await costText(ui)).length, `$${usd}`).toBe(width)
    }
    await ui.unmount()
  })

  test('a negative or unreadable budgetUsd counts as none', { options: { budgetUsd: -5 } }, async ($, on) => {
    const w = world(on)
    spent(w, 1.24)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(160))
    expect(await costText(ui)).toBe('   $1.24')
    await ui.unmount()
  })

  test('the no-budget form is the narrow and the wide one alike', async () => {
    for (const form of ['wide', 'crowded', 'narrow'] as const) {
      expect(join(cost.render(ctxOf({ rateLimits: [], cost: { usd: 3 } }, form, { budgetUsd: 0 })))).toBe('   $3.00')
    }
  })
})

describe('the account spend limit (limitSpend)', () => {
  test("draws the account's spend limit, a percentage the engine gives with no dollar figure", async () => {
    const data = { rateLimits: [{ kind: 'spend_limit', percentUsed: 80, resetsAt: '2026-11-01T00:00:00Z' }] }
    expect(join(limitSpend.render(ctxOf(data)))).toBe('spend ━━━━━━──  80%')
  })

  test('draws a placeholder of the same width where the account has none', async () => {
    expect(join(limitSpend.render(ctxOf(EMPTY)))).toBe('spend ────────  --%')
    expect(join(limitSpend.render(ctxOf(EMPTY, 'narrow')))).toBe('spend  --%')
  })
})
