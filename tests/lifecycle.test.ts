import type { RenderElement } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { BAND, END_CLEAR, END_EXIT, NO_USAGE, slash, SOME_USAGE, START, TURN, world } from './world'

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }

// What shows with no pointer on the bar: hover views (drawn hidden) left out.
const textOf = (node: unknown): string =>
  typeof node === 'string'
    ? node
    : (node as Node).props?.display === 'none'
      ? ''
      : ((node as Node).children ?? []).map(textOf).join('')

// The bar's shape: its rows (the root Box's height) and each group's width.
const shapeOf = (tree: RenderElement) => {
  const root = tree as unknown as Node
  return {
    type: root.type,
    height: root.props?.height,
    width: root.props?.width,
    groups: (root.children ?? []).map(child => textOf(child).length),
  }
}

describe('the band above the prompt', () => {
  test('fills in with the session figures', async ($, on) => {
    const w = world(on)
    w.usage = SOME_USAGE
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(160))
    expect(await ui.find({ type: 'Text', text: /62k\/200k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.24/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↻\d\d:\d\d/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /↻(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d\d:\d\d/ })).toBeDefined()
    await ui.unmount()
  })

  test('starts the cache timer at the first main-loop response and counts down', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(160))
    expect(await ui.find({ type: 'Text', text: 'cache --:--' })).toBeDefined()
    // A subagent's turn does not start the timer.
    await $.turn.complete({ ...(TURN as object), agentId: 'a1' } as never)
    expect(await ui.find({ type: 'Text', text: 'cache --:--' })).toBeDefined()
    await $.turn.complete(TURN)
    expect(await ui.find({ type: 'Text', text: 'cache 59:59' })).toBeDefined()
    await w.clock.advance(3_600_000 - 272_000)
    expect(await ui.find({ type: 'Text', text: 'cache 04:32' })).toBeDefined()
    await w.clock.advance(272_000)
    expect(await ui.find({ type: 'Text', text: 'cache 00:00' })).toBeDefined()
    await ui.unmount()
  })

  test('counts down from 5 minutes with cacheTtl 5m', { options: { cacheTtl: '5m' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.turn.complete(TURN)
    await w.clock.advance(26_000)
    const ui = await $.ui.mount(BAND(160))
    expect(await ui.find({ type: 'Text', text: 'cache 04:34' })).toBeDefined()
    await ui.unmount()
  })

  test('leaves the band to the engine while a survey shows', async ($, on) => {
    world(on)
    const ui = await $.ui.mount({
      ...(BAND(160) as object),
      props: { hasSurvey: true, isWorking: false, maxRows: 10, bodyColumns: 160 },
    } as never)
    expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['engine'] })
    await ui.unmount()
  })

  test('draws no bar with show false', { options: { show: false } }, async ($, on) => {
    world(on)
    const ui = await $.ui.mount(BAND(160))
    expect(await ui.drawn()).toMatchObject({ type: 'Text', children: ['engine'] })
    await ui.unmount()
  })

  test('draws the cost alone with budgetUsd 0', { options: { budgetUsd: 0 } }, async ($, on) => {
    const w = world(on)
    w.usage = SOME_USAGE
    await $.session.start(START)
    const ui = await $.ui.mount(BAND(160))
    expect(await ui.find({ type: 'Text', text: /\$1\.24/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\/ \$/ })).toBeUndefined()
    await ui.unmount()
  })

  test('draws the segments option in its order', { options: { segments: 'cache,cost' } }, async ($, on) => {
    world(on)
    const ui = await $.ui.mount(BAND(160))
    const groups = ((await ui.drawn()) as unknown as Node).children!.map(textOf)
    expect(groups).toEqual(['cache --:--', '   $-.--'])
    await ui.unmount()
  })

  test('takes the band for an invalid position (the default, above)', { options: { position: 'sideways' } }, async ($, on) => {
    world(on)
    const ui = await $.ui.mount(BAND(160))
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeDefined()
    await ui.unmount()
  })

  test('never draws wider than the band, at any width', async ($, on) => {
    const w = world(on)
    w.usage = SOME_USAGE
    await $.session.start(START)
    for (const columns of [30, 60, 80, 109, 110, 140, 160, 200, 240]) {
      const ui = await $.ui.mount(BAND(columns))
      const shape = shapeOf(await ui.drawn())
      expect(shape.width).toBe(columns)
      const used = shape.groups.reduce((a, b) => a + b, 0) + 2 * Math.max(0, shape.groups.length - 1)
      expect(used <= columns, `${columns} columns drew ${used}`).toBe(true)
      await ui.unmount()
    }
  })
})

describe('no layout shift', () => {
  test('the band keeps its rows and widths across /clear', async ($, on) => {
    const w = world(on)
    w.usage = SOME_USAGE
    await $.session.start(START)
    await $.turn.complete(TURN)
    for (const columns of [80, 120, 160, 220]) {
      const ui = await $.ui.mount(BAND(columns))
      const withData = shapeOf(await ui.drawn())
      expect(withData.height).toBe(1)
      w.usage = NO_USAGE
      await $.session.end(END_CLEAR)
      const cleared = shapeOf(await ui.drawn())
      expect(cleared, `${columns} columns`).toEqual(withData)
      expect(await ui.find({ type: 'Text', text: 'cache --:--' })).toBeDefined()
      // And back: figures arrive without moving anything.
      w.usage = SOME_USAGE
      await $.turn.complete(TURN)
      expect(shapeOf(await ui.drawn())).toEqual(withData)
      await ui.unmount()
    }
  })

  test('the band before any data has the shape it has with data', async ($, on) => {
    const w = world(on)
    for (const columns of [80, 160, 220]) {
      w.usage = NO_USAGE
      const ui = await $.ui.mount(BAND(columns))
      const empty = shapeOf(await ui.drawn())
      w.usage = SOME_USAGE
      await $.session.start(START)
      await $.turn.complete(TURN)
      expect(shapeOf(await ui.drawn()), `${columns} columns`).toEqual(empty)
      await ui.unmount()
    }
  })
})

describe('the status line position', () => {
  test('writes the narrow bar as plain text and clears it when hidden', { options: { position: 'status' } }, async ($, on) => {
    const w = world(on)
    w.usage = SOME_USAGE
    await $.session.start(START)
    const last = () => w.statuses.at(-1)
    expect(last()).toMatch(/^5h  25%  7d  50%  ·  ctx [█░]{20}  62k\/200k  31%  ·  \$1\.24  ·  cache --:--$/)
    const width = last()!.length
    await slash($, 'off')
    expect(last()).toBeUndefined()
    await slash($, 'on')
    expect(last()!.length).toBe(width)
    w.usage = NO_USAGE
    await $.session.end(END_CLEAR)
    expect(last()).toBe(`5h  --%  7d  --%  ·  ctx ${'░'.repeat(20)}    0/200k   0%  ·  $-.--  ·  cache --:--`)
    expect(last()!.length).toBe(width)
  })

  test('stops the one-second tick when the session ends', { options: { position: 'status' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await w.clock.advance(3000)
    const ticking = w.statuses.length
    expect(ticking).toBeGreaterThan(2)
    await $.session.end(END_EXIT)
    const ended = w.statuses.length
    await w.clock.advance(5000)
    expect(w.statuses.length).toBe(ended)
  })

  test('keeps ticking across /clear', { options: { position: 'status' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    await $.session.end(END_CLEAR)
    const cleared = w.statuses.length
    await w.clock.advance(3000)
    expect(w.statuses.length).toBe(cleared + 3)
  })
})
