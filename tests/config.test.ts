import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_SEGMENTS, parseLayout, POSITIONS, readConfig } from '../hooks/register'
import { FIVE_MIN, HOUR } from './fixtures'

describe('parseLayout', () => {
  test('splits groups on , and segments inside a group on +', async () => {
    expect(parseLayout(DEFAULT_SEGMENTS)).toEqual([['limit5h', 'limit7d'], ['ctx'], ['cost'], ['cache']])
    expect(parseLayout('a+b+c')).toEqual([['a', 'b', 'c']])
    expect(parseLayout('a,b,c')).toEqual([['a'], ['b'], ['c']])
  })

  test('keeps the order given', async () => {
    expect(parseLayout('cache,cost+ctx,limit7d')).toEqual([['cache'], ['cost', 'ctx'], ['limit7d']])
    expect(parseLayout('ctx+cost')).not.toEqual(parseLayout('cost+ctx'))
  })

  test('trims space and drops empty ids and groups', async () => {
    expect(parseLayout('  cache ,  cost +  ctx  ')).toEqual([['cache'], ['cost', 'ctx']])
    expect(parseLayout('cache,,cost')).toEqual([['cache'], ['cost']])
    expect(parseLayout('+cache++cost+')).toEqual([['cache', 'cost']])
    expect(parseLayout('cache, + ,cost')).toEqual([['cache'], ['cost']])
  })

  test('answers no groups for an empty list', async () => {
    expect(parseLayout('')).toEqual([])
    expect(parseLayout('   ')).toEqual([])
    expect(parseLayout(',,+,')).toEqual([])
  })

  test('keeps unknown ids: the composer skips them', async () => {
    expect(parseLayout('nope+cache,whatever')).toEqual([['nope', 'cache'], ['whatever']])
  })
})

describe('readConfig', () => {
  test('falls back to defaults with no options', async () => {
    expect(readConfig({})).toEqual({
      layout: parseLayout(DEFAULT_SEGMENTS),
      position: 'above',
      budgetUsd: 0,
      contextLimit: 0,
      ttlMs: HOUR,
      isShown: true,
    })
  })

  test('reads the segments option, an empty one as an empty bar', async () => {
    expect(readConfig({ segments: 'cache,cost+ctx' }).layout).toEqual([['cache'], ['cost', 'ctx']])
    expect(readConfig({ segments: '' }).layout).toEqual([])
    // A value that is not a string is not a list: the default stands.
    expect(readConfig({ segments: 5 }).layout).toEqual(parseLayout(DEFAULT_SEGMENTS))
  })

  test('reads each position and falls back to above for any other value', async () => {
    for (const position of POSITIONS) expect(readConfig({ position }).position).toBe(position)
    for (const position of ['sideways', 'ABOVE', '', 1, true, null]) {
      expect(readConfig({ position: position as never }).position).toBe('above')
    }
  })

  test('reads show; only false hides the bar', async () => {
    expect(readConfig({ show: false }).isShown).toBe(false)
    expect(readConfig({ show: true }).isShown).toBe(true)
    expect(readConfig({}).isShown).toBe(true)
  })

  test('reads budgetUsd, with 0 meaning no budget', async () => {
    expect(readConfig({ budgetUsd: 10 }).budgetUsd).toBe(10)
    expect(readConfig({ budgetUsd: 2.5 }).budgetUsd).toBe(2.5)
    expect(readConfig({ budgetUsd: '25' }).budgetUsd).toBe(25)
    expect(readConfig({ budgetUsd: 0 }).budgetUsd).toBe(0)
  })

  test('reads an invalid budget as no budget', async () => {
    for (const budgetUsd of [-1, -0.01, 'abc', Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(readConfig({ budgetUsd: budgetUsd as never }).budgetUsd, String(budgetUsd)).toBe(0)
    }
  })

  test('reads contextLimit in whole tokens, an invalid one as off', async () => {
    expect(readConfig({ contextLimit: 256_000 }).contextLimit).toBe(256_000)
    expect(readConfig({ contextLimit: '128000' }).contextLimit).toBe(128_000)
    expect(readConfig({ contextLimit: 1000.6 }).contextLimit).toBe(1001)
    for (const contextLimit of [0, -1, 'abc', Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(readConfig({ contextLimit: contextLimit as never }).contextLimit, String(contextLimit)).toBe(0)
    }
  })

  test('reads the cache TTL, 1h for any other value', async () => {
    expect(readConfig({ cacheTtl: '5m' }).ttlMs).toBe(FIVE_MIN)
    expect(readConfig({ cacheTtl: '1h' }).ttlMs).toBe(HOUR)
    expect(readConfig({ cacheTtl: '10m' }).ttlMs).toBe(HOUR)
  })
})
