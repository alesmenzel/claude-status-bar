import { describe, expect, test } from 'claude-code/testing'

import type { BarData } from '../hooks/register'
import { cost } from '../hooks/segments'
import { colorOf, ctxOf, EMPTY, FULL, join } from './fixtures'

const spent = (usd: number): BarData => ({ rateLimits: [], cost: { usd } })
const draw = (data: BarData, form: 'wide' | 'narrow' = 'wide', budgetUsd = 10) =>
  join(cost.render(ctxOf(data, form, { budgetUsd })))

describe('cost segment', () => {
  test('draws the cost, the budget, a meter and the share on a wide bar', async () => {
    expect(draw(FULL)).toBe('   $1.24 / $10 ━───────  12%')
  })

  test('drops the meter on a narrow bar', async () => {
    expect(draw(FULL, 'narrow')).toBe('   $1.24 / $10  12%')
  })

  test('draws the cost alone with no budget (budgetUsd 0)', async () => {
    expect(draw(FULL, 'wide', 0)).toBe('   $1.24')
    expect(draw(FULL, 'narrow', 0)).toBe('   $1.24')
    expect(draw(EMPTY, 'wide', 0)).toBe('   $-.--')
  })

  test('draws placeholders before the session has a cost', async () => {
    expect(draw(EMPTY)).toBe('   $-.-- / $10 ────────  --%')
    expect(draw(EMPTY, 'narrow')).toBe('   $-.-- / $10  --%')
    expect(cost.render(ctxOf(EMPTY))!.every(r => r.color === undefined)).toBe(true)
  })

  test('keeps its width from $0 to $9999.99 and past the budget', async () => {
    for (const [form, budgetUsd] of [
      ['wide', 10],
      ['narrow', 10],
      ['wide', 0],
    ] as const) {
      const width = draw(EMPTY, form, budgetUsd).length
      for (const usd of [0, 0.004, 0.05, 5, 9.99, 10, 99.99, 100, 1234.56, 9999.99]) {
        expect(draw(spent(usd), form, budgetUsd).length, `$${usd} ${form} budget ${budgetUsd}`).toBe(width)
      }
    }
  })

  test('reads a budget spent ten times over as a multiple, at the same width', async () => {
    expect(draw(spent(99.94), 'narrow')).toBe('  $99.94 / $10 999%')
    expect(draw(spent(150), 'narrow')).toBe(' $150.00 / $10  15x')
    expect(draw(spent(150))).toBe(` $150.00 / $10 ${'━'.repeat(8)}  15x`)
  })

  test('fills the meter by the share of the budget, full past it', async () => {
    expect(draw(spent(5))).toBe('   $5.00 / $10 ━━━━────  50%')
    expect(draw(spent(10))).toBe('  $10.00 / $10 ━━━━━━━━ 100%')
    expect(draw(spent(25))).toBe('  $25.00 / $10 ━━━━━━━━ 250%')
  })

  test('colors the share just above 50%, 75% and 90% of the budget', async () => {
    const color = (usd: number) => colorOf(cost.render(ctxOf(spent(usd))), /(%|x)$/)
    expect([4.99, 5, 5.01].map(color)).toEqual([undefined, undefined, 'blue'])
    expect([7.49, 7.5, 7.51].map(color)).toEqual(['blue', 'blue', '#ff8700'])
    expect([8.99, 9, 9.01].map(color)).toEqual(['#ff8700', '#ff8700', 'magenta'])
    expect(color(150)).toBe('magenta')
    expect(colorOf(cost.render(ctxOf(spent(9.5))), /━/)).toBe('magenta')
  })

  test('draws a budget that is not a whole number as given', async () => {
    expect(draw(spent(1), 'narrow', 2.5)).toBe('   $1.00 / $2.5  40%')
  })
})
