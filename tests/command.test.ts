import { describe, expect, test } from 'claude-code/testing'

import { basePluginName, ownField } from '../hooks/register'
import { BAND, slash, START, world } from './world'

const USAGE = 'Usage: /status-bar [on|off|toggle|position above|below|status|segments <list>]'

describe('/status-bar on, off and toggle', () => {
  test('hides and shows the bar and keeps the choice in the store', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND())
    const isBar = async () => (await ui.find({ type: 'Text', text: /cache/ })) !== undefined
    expect(await isBar()).toBe(true)

    expect(await slash($, 'off')).toMatchObject({ text: 'Status bar hidden.' })
    expect(w.store.get('isHidden')).toBe(true)
    expect(await isBar()).toBe(false)
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()

    // off again stays off.
    expect(await slash($, 'off')).toMatchObject({ text: 'Status bar hidden.' })
    expect(await isBar()).toBe(false)

    expect(await slash($, 'on')).toMatchObject({ text: 'Status bar shown.' })
    expect(w.store.get('isHidden')).toBe(false)
    expect(await isBar()).toBe(true)
    expect(await slash($, 'on')).toMatchObject({ text: 'Status bar shown.' })
    await ui.unmount()
  })

  test('toggles with toggle, and with no argument', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(await slash($, 'toggle')).toMatchObject({ text: 'Status bar hidden.' })
    expect(await slash($, 'toggle')).toMatchObject({ text: 'Status bar shown.' })
    expect(await slash($, '')).toMatchObject({ text: 'Status bar hidden.' })
    expect(await slash($, '   ')).toMatchObject({ text: 'Status bar shown.' })
    expect(w.store.get('isHidden')).toBe(false)
  })

  test('reads the verb with space around it', async ($, on) => {
    world(on)
    expect(await slash($, '  off  ')).toMatchObject({ text: 'Status bar hidden.' })
  })

  test('says the settings hide the bar when show is false', { options: { show: false } }, async ($, on) => {
    world(on)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND())
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
    expect(await slash($, 'on')).toMatchObject({
      text: 'The status bar is off in its settings (show = false).',
    })
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
    expect(await slash($, 'off')).toMatchObject({ text: 'Status bar hidden.' })
    await ui.unmount()
  })

  test('starts hidden when a past session hid it', async ($, on) => {
    world(on, { isHidden: true })
    await $.session.start(START)
    const ui = await $.ui.mount(BAND())
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeUndefined()
    expect(await slash($, '')).toMatchObject({ text: 'Status bar shown.' })
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeDefined()
    await ui.unmount()
  })

  test('ignores a stored value that is not a boolean', async ($, on) => {
    world(on, { isHidden: 'yes' })
    await $.session.start(START)
    const ui = await $.ui.mount(BAND())
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('/status-bar position and segments', () => {
  test('keeps the position in the store, with no config rows at all', async ($, on) => {
    const w = world(on)
    w.rows = []
    for (const position of ['below', 'status', 'above']) {
      expect(await slash($, `position ${position}`)).toMatchObject({
        text: `Status bar position: ${position}`,
      })
      expect(w.store.get('position')).toBe(position)
    }
    expect(w.sets).toEqual([])
  })

  test('refuses a position it does not know', async ($, on) => {
    const w = world(on)
    for (const args of ['position', 'position sideways', 'position ABOVE', 'position above below']) {
      expect(await slash($, args)).toMatchObject({
        text: 'Usage: /status-bar position above|below|status',
      })
    }
    expect(w.store.has('position')).toBe(false)
  })

  test('keeps the segments in the store, as typed', async ($, on) => {
    const w = world(on)
    expect(await slash($, 'segments cache, cost+ctx')).toMatchObject({
      text: 'Status bar segments: cache, cost+ctx',
    })
    expect(w.store.get('segments')).toBe('cache, cost+ctx')
    expect(w.sets).toEqual([])
  })

  test('refuses an empty segments list', async ($, on) => {
    const w = world(on)
    for (const args of ['segments', 'segments  ', 'segments ,', 'segments +,+']) {
      expect(await slash($, args)).toMatchObject({
        text: 'Usage: /status-bar segments limit5h+limit7d,ctx,cost,cache',
      })
    }
    expect(w.store.has('segments')).toBe(false)
  })

  test('moves the bar at once', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND())
    const isBand = async () => (await ui.find({ type: 'Text', text: /cache/ })) !== undefined
    expect(await isBand()).toBe(true)

    await slash($, 'position status')
    expect(await isBand()).toBe(false)
    expect(w.statuses.at(-1)).toMatch(/cache --:--$/)

    await slash($, 'position above')
    expect(await isBand()).toBe(true)
    expect(w.statuses.at(-1)).toBeUndefined()
    await ui.unmount()
  })

  test('draws the new segments at once', async ($, on) => {
    world(on)
    await $.session.start(START)
    const ui = await $.ui.mount(BAND())
    await slash($, 'segments cache')
    expect(await ui.find({ type: 'Text', text: /cache/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('stored overrides', () => {
  test("a past session's position and segments apply when the session starts", async ($, on) => {
    const w = world(on, { position: 'status', segments: 'cache' })
    await $.session.start(START)
    expect(w.statuses.at(-1)).toBe('cache --:--')
  })

  test('ignores stored values that are not valid', async ($, on) => {
    world(on, { position: 'sideways', segments: ',' })
    await $.session.start(START)
    const ui = await $.ui.mount(BAND())
    expect(await ui.find({ type: 'Text', text: /5h/ })).toBeDefined()
    await ui.unmount()
  })

  for (const provider of ['status-bar@inline', 'status-bar@alesmenzel-mods', 'status-bar']) {
    test(`a /config menu change from ${provider} replaces the stored value`, async ($, on) => {
      const w = world(on, { position: 'status' })
      await $.session.start(START)
      await $.config.set({
        key: 'status-bar.position',
        value: 'above',
        previous: 'above',
        provider: { plugin: provider, tier: 'user' },
        origin: { kind: 'composer' },
      } as never)
      expect(w.store.has('position')).toBe(false)
      expect(w.statuses.at(-1)).toBeUndefined()
      const ui = await $.ui.mount(BAND())
      expect(await ui.find({ type: 'Text', text: /cache/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test("keeps the stored value when another plugin's row changes", async ($, on) => {
    const w = world(on, { position: 'status' })
    await $.session.start(START)
    for (const plugin of ['other@inline', 'status-bar-extra@inline']) {
      await $.config.set({
        key: `${plugin.split('@')[0]}.position`,
        value: 'above',
        previous: 'x',
        provider: { plugin, tier: 'user' },
        origin: { kind: 'composer' },
      } as never)
    }
    expect(w.store.get('position')).toBe('status')
  })

  test("ownField reads the field of this plugin's rows only", async () => {
    const change = (key: string, plugin: string) => ({ key, provider: { plugin, tier: 'user' } }) as never
    expect(ownField(change('status-bar.position', 'status-bar@inline'), 'status-bar')).toBe('position')
    expect(ownField(change('status-bar.segments', 'status-bar@market'), 'status-bar')).toBe('segments')
    expect(ownField(change('status-bar@inline.show', 'status-bar@inline'), 'status-bar')).toBe('show')
    expect(ownField(change('status-bar.position', 'status-bar'), 'status-bar@inline')).toBe('position')
    expect(ownField(change('other.position', 'other@inline'), 'status-bar')).toBeUndefined()
    expect(ownField(change('status-bar.position', 'other@inline'), 'status-bar')).toBeUndefined()
    expect(ownField(change('status-bar-extra.position', 'status-bar-extra@inline'), 'status-bar')).toBeUndefined()
    expect(basePluginName('status-bar@inline')).toBe('status-bar')
    expect(basePluginName('status-bar')).toBe('status-bar')
  })
})

describe('/status-bar with an unknown verb', () => {
  test('answers the usage and changes nothing', async ($, on) => {
    const w = world(on)
    for (const args of ['bogus', 'ON', 'hide', 'off now']) {
      const text = (await slash($, args)).text
      if (args === 'off now') expect(text).toBe('Status bar hidden.')
      else expect(text, args).toBe(USAGE)
    }
    expect(w.sets).toEqual([])
  })
})

describe('command registration', () => {
  test('registers /status-bar when the session starts', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.commands).toEqual(['status-bar'])
  })
})

describe('a run with no args (regression)', () => {
  test('reads missing args as bare /status-bar, a toggle', async ($, on) => {
    world(on)
    expect(await $.command.run({ command: 'status-bar' } as never)).toMatchObject({ text: 'Status bar hidden.' })
    expect(await $.command.run({ command: 'status-bar' } as never)).toMatchObject({ text: 'Status bar shown.' })
  })
})
