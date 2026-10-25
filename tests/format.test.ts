import { describe, expect, test } from 'claude-code/testing'

import {
  CLOCK_PLACEHOLDER,
  clockText,
  kTokens,
  label,
  levelColor,
  meter,
  PERCENT_PLACEHOLDER,
  percentRun,
  percentText,
  value,
} from '../hooks/register'

describe('kTokens', () => {
  test('shortens tokens to units, k and M', async () => {
    expect([0, 5, 99, 950, 999].map(kTokens)).toEqual(['   0', '   5', '  99', ' 950', ' 999'])
    expect([1000, 1499, 62_400, 99_000, 200_000, 999_499].map(kTokens)).toEqual([
      '  1k',
      '  1k',
      ' 62k',
      ' 99k',
      '200k',
      '999k',
    ])
    expect([1_000_000, 1_200_000, 9_940_000].map(kTokens)).toEqual(['1.0M', '1.2M', '9.9M'])
  })

  test('hands over to the next unit where rounding would take a fifth cell', async () => {
    expect(kTokens(999.6)).toBe('  1k')
    expect(kTokens(999_500)).toBe('1.0M')
    expect(kTokens(999_999)).toBe('1.0M')
    expect(kTokens(9_960_000)).toBe(' 10M')
    expect(kTokens(150_000_000)).toBe('150M')
  })

  test('always takes 4 cells', async () => {
    for (const n of [0, 5, 99, 100, 999, 999.5, 1000, 9999, 99_999, 999_499, 999_500, 1e6, 9.95e6, 1e7, 1e8, 1e9, 1e12]) {
      expect(kTokens(n), String(n)).toHaveLength(4)
    }
  })
})

describe('percentText', () => {
  test('pads the percentage to 4 cells', async () => {
    expect([0, 0.05, 0.25, 0.99, 1].map(percentText)).toEqual(['  0%', '  5%', ' 25%', ' 99%', '100%'])
    expect(percentText(0.004)).toBe('  0%')
    expect(percentText(0.995)).toBe('100%')
    expect(percentText(2.5)).toBe('250%')
  })

  test('reads 1000% and more as a multiple', async () => {
    expect(percentText(9.99)).toBe('999%')
    expect(percentText(9.996)).toBe(' 10x')
    expect(percentText(15)).toBe(' 15x')
    expect(percentText(250)).toBe('250x')
    expect(percentText(1e6)).toBe('999x')
  })

  test('always takes 4 cells, as the placeholder does', async () => {
    expect(PERCENT_PLACEHOLDER).toHaveLength(4)
    for (const f of [0, 0.05, 0.5, 0.99, 1, 1.5, 9.99, 10, 99, 1000, 1e9]) {
      expect(percentText(f), String(f)).toHaveLength(4)
    }
  })
})

describe('clockText', () => {
  test('writes zero-padded mm:ss of whole seconds', async () => {
    expect(clockText(0)).toBe('00:00')
    expect(clockText(999)).toBe('00:00')
    expect(clockText(34_000)).toBe('00:34')
    expect(clockText(272_000)).toBe('04:32')
    expect(clockText(3_599_000)).toBe('59:59')
    expect(clockText(-5000)).toBe('00:00')
  })

  test('takes 5 cells, as the placeholder does', async () => {
    expect(CLOCK_PLACEHOLDER).toBe('--:--')
    for (const ms of [0, 1000, 59_000, 60_000, 599_000, 3_599_000]) expect(clockText(ms)).toHaveLength(5)
  })
})

describe('levelColor', () => {
  test('is none up to 50%, then blue, orange and magenta', async () => {
    expect([0, 0.25, 0.4999, 0.5].map(levelColor)).toEqual([undefined, undefined, undefined, undefined])
    expect([0.5001, 0.6, 0.75].map(levelColor)).toEqual(['blue', 'blue', 'blue'])
    expect([0.7501, 0.8, 0.9].map(levelColor)).toEqual(['#ff8700', '#ff8700', '#ff8700'])
    expect([0.9001, 1, 5].map(levelColor)).toEqual(['magenta', 'magenta', 'magenta'])
  })
})

describe('meter', () => {
  const text = (fraction: number, width = 8) => meter(fraction, width).map(r => r.text).join('')

  test('fills its cells by the fraction, rounded', async () => {
    expect(text(0)).toBe('────────')
    expect(text(0.0624)).toBe('────────')
    expect(text(0.0625)).toBe('━───────')
    expect(text(0.5)).toBe('━━━━────')
    expect(text(1)).toBe('━━━━━━━━')
  })

  test('always takes its width, past 100% and below 0', async () => {
    for (const f of [-1, 0, 0.3, 1, 2, 100]) {
      for (const width of [1, 8, 20]) expect(text(f, width)).toHaveLength(width)
    }
  })

  test('colors the filled part by level and leaves the rest a label', async () => {
    expect(meter(0.5, 8)).toEqual([{ text: '━━━━', tone: 'value' }, label('────')])
    expect(meter(0.76, 8)[0]).toEqual({ text: '━━━━━━', tone: 'value', color: '#ff8700' })
    expect(meter(0.76, 8)[1]!.color).toBeUndefined()
  })
})

describe('runs', () => {
  test('build label and value runs', async () => {
    expect(label('x')).toEqual({ text: 'x', tone: 'label' })
    expect(value('y')).toEqual({ text: 'y', tone: 'value' })
    expect(value('y', 'blue')).toEqual({ text: 'y', tone: 'value', color: 'blue' })
    expect(percentRun(0.91)).toEqual({ text: ' 91%', tone: 'value', color: 'magenta' })
    expect(percentRun(0.2)).toEqual({ text: ' 20%', tone: 'value' })
  })
})
