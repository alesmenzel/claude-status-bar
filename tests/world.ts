// The engine beneath the plugin, for the tests that drive the mod through $.
// Not a test file itself. Register it before the test's first call on $.
import type { ConfigRow, On, SessionUsage } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

export type World = {
  usage: SessionUsage
  store: Map<string, unknown>
  rows: ConfigRow[]
  sets: { key: string; value: unknown }[]
  deny?: string
  statuses: (string | undefined)[]
  commands: string[]
  clock: ReturnType<typeof mock.clock>
}

export const NO_USAGE: SessionUsage = {
  startedAt: 0,
  context: { tokens: 0, window: 200_000, percent: 0 },
  rateLimits: [],
}

export const SOME_USAGE: SessionUsage = {
  startedAt: 0,
  context: { tokens: 62_000, window: 200_000, percent: 31 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 25, resetsAt: '2026-10-25T12:20:00Z' },
    { kind: 'seven_day', percentUsed: 50, resetsAt: '2026-10-26T09:00:00Z' },
  ],
  cost: { usd: 1.24 },
}

// A `/config` row as the real engine lists a plugin's userConfig field:
// key `<plugin>.<field>`, provider the plugin with its source after `@`
// (`status-bar@inline` for a --plugin-dir load, `status-bar@<marketplace>`
// for an install).
export const configRow = (
  field: string,
  value: ConfigRow['value'],
  provider = 'status-bar@inline',
  kind: ConfigRow['kind'] = 'text',
): ConfigRow =>
  ({
    key: `${provider.split('@')[0]}.${field}`,
    label: field,
    kind,
    value,
    provider: { plugin: provider, tier: 'user' },
    isLocked: false,
  }) as ConfigRow

// The status-bar rows of a session, from the given source.
export const statusBarRows = (provider = 'status-bar@inline'): ConfigRow[] => [
  configRow('show', true, provider, 'boolean'),
  configRow('position', 'above', provider, 'choice'),
  configRow('segments', 'limit5h+limit7d,ctx,cost,cache', provider),
  configRow('budgetUsd', 10, provider, 'number'),
  configRow('cacheTtl', '1h', provider, 'choice'),
]

export const world = (on: On, store: Record<string, unknown> = {}): World => {
  const w: World = {
    usage: NO_USAGE,
    store: new Map(Object.entries(store)),
    rows: [
      { key: 'autoContinueAtUsageLimit', label: 'auto', kind: 'boolean', value: true, provider: { plugin: 'engine', tier: 'core' }, isLocked: false } as ConfigRow,
      ...statusBarRows(),
      configRow('position', 'x', 'other@inline', 'choice'),
    ],
    sets: [],
    statuses: [],
    commands: [],
    clock: mock.clock(on, { now: 0 }),
  }
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }) as never)
  on('store.set', ($, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined } as never
  })
  on('store.delete', ($, e) => {
    w.store.delete(e.key)
    return { value: undefined } as never
  })
  on('session.usage', () => ({ value: w.usage }) as never)
  on('command.register', ($, e) => {
    w.commands.push(e.name)
    return { value: undefined } as never
  })
  on('config.list', () => ({ value: w.rows }) as never)
  on('config.set', ($, e) => {
    w.sets.push({ key: e.key, value: e.value })
    return (w.deny === undefined ? { value: e.value } : { deny: w.deny }) as never
  })
  on('ui.status', ($, e) => {
    w.statuses.push(e.text)
    return { value: undefined } as never
  })
  on('session.start', () => ({ cwd: '/' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  // The engine's own band and hint: a Text the tests can tell apart.
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))

  return w
}

export const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
export const END_CLEAR = { reason: 'clear', sessionId: 's1', resume: {} } as never
export const END_EXIT = { reason: 'prompt_input_exit', sessionId: 's1', resume: {} } as never
export const TURN = {
  answer: 'done',
  durationMs: 1,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
  usage: { inputTokens: 1, outputTokens: 1 },
} as never

export const BAND = (bodyColumns = 160) =>
  ({
    plugin: 'status-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns },
  }) as never

// Runs /status-bar as the person typing it at the prompt.
export const slash = ($: Engine, args: string) =>
  $.command.run({
    command: 'status-bar',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
