import { atom, read, update } from 'claude-code'
import type {
  ConfigSetInput,
  Elements,
  EngineInterface,
  PluginOptions,
  Register,
  RenderElement,
  SessionRateLimit,
  Timer,
} from 'claude-code'

import type { StatusBarRun, StatusBarSegmentResult, StatusBarSegmentSpec } from '../types'
import type { BarData, Run, Segment, SegmentContext } from './segment'
import { label, runsWidth, splitContext, WIDE_COLUMNS } from './segment'
import { BUILTIN_SEGMENTS } from './segments'

export * from './segment'
export { BUILTIN_SEGMENTS } from './segments'

// ── Configuration ───────────────────────────────────────────────────────────

// Where the bar draws: the band directly above the prompt, the hint line
// under the prompt, or the plugin's plain-text status line.
export const POSITIONS = ['above', 'below', 'status'] as const
export type Position = (typeof POSITIONS)[number]

// `,` separates groups, which the bar spreads over its width; `+` joins
// segments inside one group.
// The context legend shows on hover over `ctx`; the `legend` id draws it
// beside the meter for a terminal with no pointer. The limit segments draw
// only the windows the account reports: 5h and 7d on a Pro or Max plan, the
// spend limit on an Enterprise seat.
export const DEFAULT_SEGMENTS = 'limit5h+limit7d+limitSpend,ctx,cost,cache'

const TTL_MS = { '1h': 60 * 60 * 1000, '5m': 5 * 60 * 1000 } as const

export type Config = {
  layout: string[][]
  position: Position
  budgetUsd: number
  contextLimit: number
  ttlMs: number
  isShown: boolean
}

// `"limit5h+limit7d, ctx,cost"` → [['limit5h', 'limit7d'], ['ctx'], ['cost']].
export const parseLayout = (text: string): string[][] =>
  text
    .split(',')
    .map(group =>
      group
        .split('+')
        .map(id => id.trim())
        .filter(id => id.length > 0),
    )
    .filter(group => group.length > 0)

const isPosition = (v: unknown): v is Position => POSITIONS.some(p => p === v)

export const readConfig = (options: PluginOptions): Config => {
  const segments = options.segments
  const budget = Number(options.budgetUsd ?? 0)
  const limit = Number(options.contextLimit ?? 0)

  return {
    layout: parseLayout(typeof segments === 'string' ? segments : DEFAULT_SEGMENTS),
    position: isPosition(options.position) ? options.position : 'above',
    budgetUsd: Number.isFinite(budget) && budget > 0 ? budget : 0,
    contextLimit: Number.isFinite(limit) && limit > 0 ? Math.round(limit) : 0,
    ttlMs: TTL_MS[options.cacheTtl === '5m' ? '5m' : '1h'],
    isShown: options.show !== false,
  }
}

// The fields `/status-bar position|segments` changes. The command keeps them in
// the plugin's store, not in settings: a fresh install has no settings to
// change. A stored value wins over the option until the person sets that
// field in the `/config` menu.
export const OVERRIDES = ['position', 'segments'] as const
export type Override = (typeof OVERRIDES)[number]
export type Overrides = Partial<Record<Override, unknown>>

const isOverride = (v: string): v is Override => OVERRIDES.some(o => o === v)

// `config` with the stored overrides that are valid; the others are ignored.
export const withOverrides = (config: Config, stored: Overrides): Config => {
  const layout = typeof stored.segments === 'string' ? parseLayout(stored.segments) : []

  return {
    ...config,
    ...(isPosition(stored.position) ? { position: stored.position } : {}),
    ...(layout.length > 0 ? { layout } : {}),
  }
}

// ── Composing ───────────────────────────────────────────────────────────────

// A segment another mod published through `$.statusBar.segment`.
export const customSegment = (spec: StatusBarSegmentSpec): Segment => ({
  id: spec.id,
  render: ({ isNarrow }) => (isNarrow && spec.narrowRuns !== undefined ? spec.narrowRuns : spec.runs),
  ...(spec.hoverRuns === undefined ? {} : { hover: () => spec.hoverRuns ?? null }),
})

const cleanRun = (run: StatusBarRun): Run => {
  const out: Run = { text: String(run.text), tone: run.tone === 'label' ? 'label' : 'value' }
  if (typeof run.color === 'string' && run.color.length > 0) out.color = run.color

  return out
}

// A run another mod passed: an object with a string or number `text`.
const isRun = (run: unknown): run is StatusBarRun =>
  typeof run === 'object' &&
  run !== null &&
  (typeof (run as { text?: unknown }).text === 'string' || typeof (run as { text?: unknown }).text === 'number')

const cleanRuns = (runs: readonly unknown[]): Run[] => runs.filter(isRun).map(cleanRun)

// Copies a published spec into plain runs, dropping entries that are not
// runs; null when it has no usable id or no list of runs.
export const cleanSpec = (spec: StatusBarSegmentSpec): StatusBarSegmentSpec | null => {
  if (typeof spec !== 'object' || spec === null) return null
  if (typeof spec.id !== 'string' || spec.id.trim().length === 0 || !Array.isArray(spec.runs)) return null
  const out: StatusBarSegmentSpec = { id: spec.id.trim(), runs: cleanRuns(spec.runs) }
  if (Array.isArray(spec.narrowRuns)) out.narrowRuns = cleanRuns(spec.narrowRuns)
  if (Array.isArray(spec.hoverRuns)) out.hoverRuns = cleanRuns(spec.hoverRuns)

  return out
}

// Pads runs with a label of spaces to `width` cells.
const padRuns = (runs: readonly Run[], width: number): Run[] => {
  const room = width - runsWidth(runs)

  return room > 0 ? [...runs, label(' '.repeat(room))] : [...runs]
}

// A segment's runs, with its hover view where it has one: both padded to the
// wider of the two and tagged as one area.
const drawSegment = (segment: Segment, ctx: SegmentContext): Run[] | null => {
  const drawn = segment.render(ctx)
  if (drawn === null || drawn.length === 0) return null
  const hover = segment.hover?.(ctx, runsWidth(drawn))
  if (hover === null || hover === undefined || hover.length === 0) return [...drawn]
  const width = Math.max(runsWidth(drawn), runsWidth(hover))
  const runs = padRuns(drawn, width).map(r => ({ ...r, area: segment.id }))
  runs[0] = { ...runs[0]!, hoverRuns: padRuns(hover, width) }

  return runs
}

// The bar's groups, left to right. Ids no segment has are skipped, as are
// segments that draw nothing, and groups left empty.
export const compose = (
  layout: readonly (readonly string[])[],
  segments: ReadonlyMap<string, Segment>,
  ctx: SegmentContext,
): Run[][] => {
  const out: Run[][] = []
  for (const group of layout) {
    const runs: Run[] = []
    for (const id of group) {
      const segment = segments.get(id)
      const drawn = segment === undefined ? null : drawSegment(segment, ctx)
      if (drawn === null) continue
      if (runs.length > 0) runs.push(label('  '))
      runs.push(...drawn)
    }
    if (runs.length > 0) out.push(runs)
  }

  return out
}

// Cells the groups take with the narrowest gap between them.
export const widthOf = (groups: readonly (readonly Run[])[]): number =>
  groups.reduce((sum, runs) => sum + runs.reduce((n, r) => n + r.text.length, 0), 0) + 2 * Math.max(0, groups.length - 1)

export const CTX_CELLS = { wide: 40, narrow: 20 } as const

// The forms the bar tries, roomiest first: meters and extras, meters alone,
// then neither (narrow).
// `least` is as far as the form shrinks its context meter.
const FORMS = [
  { isNarrow: false, isCrowded: false, ctxCells: CTX_CELLS.wide, least: 16 },
  { isNarrow: false, isCrowded: true, ctxCells: CTX_CELLS.wide, least: 16 },
  { isNarrow: true, isCrowded: true, ctxCells: CTX_CELLS.narrow, least: 6 },
] as const

// The narrow form when even it does not fit: groups dropped from the right,
// then the one left cut to `columns`.
const clip = (groups: readonly Run[][], columns: number): Run[][] => {
  const kept = [...groups]
  while (kept.length > 1 && widthOf(kept) > columns) kept.pop()
  if (kept.length === 0 || widthOf(kept) <= columns) return kept
  const runs: Run[] = []
  let room = Math.max(0, columns)
  for (const { area: _area, hoverRuns: _hover, ...run } of kept[0]!) {
    if (room === 0) break
    // A cut area loses its hover view: the two would no longer line up.
    const text = run.text.slice(0, room)
    room -= text.length
    runs.push({ ...run, text })
  }

  return runs.length > 0 ? [runs] : []
}

// Composes the bar to fit `columns`: the roomiest form that fits, its
// context meter shrunk (down to the form's `least`) to make room. Below
// WIDE_COLUMNS the bar is always narrow; where even the narrowest form is too
// wide, its rightmost groups go.
export const fit = (
  layout: readonly (readonly string[])[],
  segments: ReadonlyMap<string, Segment>,
  base: Omit<SegmentContext, 'isNarrow' | 'isCrowded' | 'ctxCells'>,
): Run[][] => {
  const forms = base.columns < WIDE_COLUMNS ? FORMS.filter(f => f.isNarrow) : FORMS
  let groups: Run[][] = []
  for (const { least, ...form } of forms) {
    groups = compose(layout, segments, { ...base, ...form })
    const over = widthOf(groups) - base.columns
    if (over <= 0) return groups
    const shrunk = compose(layout, segments, { ...base, ...form, ctxCells: Math.max(least, form.ctxCells - over) })
    if (widthOf(shrunk) <= base.columns) return shrunk
    groups = shrunk
  }

  return clip(groups, base.columns)
}

export const plainText = (groups: readonly (readonly Run[])[]): string =>
  groups.map(runs => runs.map(r => r.text).join('').trim()).join('  ·  ')

// ── Drawing ─────────────────────────────────────────────────────────────────

// The bar reads as metadata: labels in the theme's dimmest color, values a
// step brighter; a run's own color (thresholds, context groups) wins.
const LABEL_COLOR = 'subtle'
const VALUE_COLOR = 'inactive'

type Table = Pick<Elements['terminal'], 'Box' | 'Text'>

// A group's runs split into pieces: plain runs, and each hover area whole.
type Piece = { area?: string; runs: Run[] }

const piecesOf = (runs: readonly Run[]): Piece[] => {
  const pieces: Piece[] = []
  for (const run of runs) {
    const last = pieces.at(-1)
    if (last !== undefined && last.area === run.area && run.hoverRuns === undefined) last.runs.push(run)
    else pieces.push({ ...(run.area === undefined ? {} : { area: run.area }), runs: [run] })
  }

  return pieces
}

// The keyed Box a hover area draws in: its own view, and over it, hidden
// until the pointer is on the area, its hover view in the same cells.
export const hoverAreaKey = (id: string): string => `status-bar-hover-${id}`

export const drawBar = ({ Box, Text }: Table, groups: readonly (readonly Run[])[], width: number): RenderElement => {
  const line = (key: string, runs: readonly Run[]): RenderElement => (
    <Text key={key} wrap="truncate" mono tabular>
      {runs.map((run, j) => (
        <Text key={String(j)} color={run.color ?? (run.tone === 'label' ? LABEL_COLOR : VALUE_COLOR)}>
          {run.text}
        </Text>
      ))}
    </Text>
  )
  const piece = ({ area, runs }: Piece, j: number): RenderElement => {
    const hoverRuns = runs[0]?.hoverRuns
    if (area === undefined || hoverRuns === undefined) return line(`p${j}`, runs)

    return (
      <Box key={hoverAreaKey(area)} flexDirection="row" width={runsWidth(runs)}>
        {line('own', runs)}
        <Box position="absolute" top={0} left={0} width={runsWidth(hoverRuns)} display="none" hover={{ display: 'flex' }}>
          {line('hover', hoverRuns)}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="row" justifyContent="space-between" width={width} height={1}>
      {groups.map((runs, i) => {
        const pieces = piecesOf(runs)
        // A group with no hover area stays one Text, as it always was.
        if (pieces.every(p => p.runs[0]?.hoverRuns === undefined)) return line(String(i), runs)

        return (
          <Box key={`g${i}`} flexDirection="row" flexShrink={0}>
            {pieces.map(piece)}
          </Box>
        )
      })}
    </Box>
  )
}

// ── The mod ─────────────────────────────────────────────────────────────────

// The plugin a config row belongs to, without its source: the engine names
// a --plugin-dir load `status-bar@inline` and a marketplace install
// `status-bar@<marketplace>`, while `$.plugin.name` is plain `status-bar`.
export const basePluginName = (name: string): string => {
  const at = name.indexOf('@')

  return at > 0 ? name.slice(0, at) : name
}

// The `userConfig` field a `/config` change sets when it is this plugin's
// row (key `<plugin>.<field>`, provider this plugin from any source); else
// undefined.
export const ownField = (change: Pick<ConfigSetInput, 'key' | 'provider'>, plugin: string): string | undefined => {
  const base = basePluginName(plugin)
  if (basePluginName(change.provider.plugin) !== base) return undefined
  const prefix = change.key.startsWith(`${base}.`) ? `${base}.` : `${change.provider.plugin}.`

  return change.key.startsWith(prefix) ? change.key.slice(prefix.length) : undefined
}

const isHidden = atom({ plugin: 'status-bar', key: 'isHidden' } as const, false)
const HIDDEN_KEY = 'isHidden'

const COMMAND = 'status-bar'
const USAGE = `/${COMMAND} [on|off|toggle|position above|below|status|segments <list>]`

// The mod's working state for one load of the module. `config` is `options`
// with the stored overrides on top.
type Bar = {
  options: PluginOptions
  overrides: Overrides
  config: Config
  isOnStatus: boolean
  data: BarData
  custom: Map<string, Segment>
  tick?: Timer
  // Context tokens at the end of the last main-loop turn (or at the start of
  // the conversation): what the next turn's delta counts from.
  baseTokens?: number
}

// Every segment by id: the built-ins and those other mods published.
function segmentsOf(bar: Bar): ReadonlyMap<string, Segment> {
  const all = new Map<string, Segment>(bar.custom)
  // Built-ins win over a custom segment that takes one of their ids.
  for (const s of BUILTIN_SEGMENTS) all.set(s.id, s)

  return all
}

async function groupsAt($: EngineInterface, bar: Bar, columns: number): Promise<Run[][]> {
  return fit(bar.config.layout, segmentsOf(bar), {
    data: bar.data,
    now: await $.clock.now(),
    columns,
    budgetUsd: bar.config.budgetUsd,
    contextLimit: bar.config.contextLimit,
    ttlMs: bar.config.ttlMs,
  })
}

async function isBarHidden($: EngineInterface, bar: Bar): Promise<boolean> {
  return (await read($, isHidden)) || !bar.config.isShown
}

// The plain-text status line takes the narrow form.
const STATUS_COLUMNS = 100

// Redraw the bar wherever it is placed, and clear the status line it left.
async function refresh($: EngineInterface, bar: Bar): Promise<void> {
  if (bar.config.position !== 'status') {
    if (bar.isOnStatus) $.ui.status(undefined)
    bar.isOnStatus = false
    $.ui.invalidate('ui.render')
    return
  }
  // Moved here from the band or the hint: take it off there.
  if (!bar.isOnStatus) $.ui.invalidate('ui.render')
  bar.isOnStatus = true
  $.ui.status((await isBarHidden($, bar)) ? undefined : plainText(await groupsAt($, bar, STATUS_COLUMNS)))
}

function reconfigure(bar: Bar): void {
  bar.config = withOverrides(readConfig(bar.options), bar.overrides)
}

// The rate-limit windows belong to the account, not to the conversation: an
// empty list (a new session, or one just cleared, before its first response)
// keeps the windows the last response reported.
function keepLimits(bar: Bar, rateLimits: readonly SessionRateLimit[]): void {
  if (rateLimits.length > 0) bar.data.rateLimits = rateLimits
}

async function measure($: EngineInterface, bar: Bar): Promise<void> {
  const usage = await $.session.usage({ breakdown: 'summary' })
  bar.data.context = usage.context
  keepLimits(bar, usage.rateLimits)
  bar.data.cost = usage.cost
  if (usage.context.breakdown !== undefined) bar.data.split = splitContext(usage.context.breakdown.categories)
  await refresh($, bar)
}

export const register: Register = (on, options) => {
  const bar: Bar = {
    options,
    overrides: {},
    config: readConfig(options),
    isOnStatus: false,
    data: { rateLimits: [] },
    custom: new Map(),
  }
  const { data, custom } = bar
  const isPlaced = (id: string): boolean => bar.config.layout.some(group => group.includes(id))

  // The extension point: other mods add segments through `$.statusBar`.
  on('engine.create', async ($, e, next) => {
    const built = await next(e)
    const answer = (id: string): StatusBarSegmentResult => ({ id, isPlaced: isPlaced(id) })

    return {
      ...built,
      statusBar: {
        segment: async (spec: StatusBarSegmentSpec): Promise<StatusBarSegmentResult> => {
          const clean = cleanSpec(spec)
          if (clean === null) return { id: String(spec.id), isPlaced: false }
          // The bar's one-second tick draws it.
          custom.set(clean.id, customSegment(clean))

          return answer(clean.id)
        },
        remove: async ({ id }: { id: string }): Promise<StatusBarSegmentResult> => {
          custom.delete(id)

          return answer(id)
        },
      },
    }
  })

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // The runtime toggle outlives the session.
    const stored = await $.store.get(HIDDEN_KEY)
    if (typeof stored === 'boolean') await update($, isHidden, () => stored)
    for (const field of OVERRIDES) bar.overrides[field] = await $.store.get(field)
    reconfigure(bar)
    $.ui.status(undefined)
    await $.command.register({
      name: 'status-bar',
      description: 'Show, hide or move the status bar.',
      argumentHint: '[on|off|toggle|position <above|below|status>|segments <list>]',
      immediate: true,
    })
    bar.tick?.cancel()
    bar.tick = $.clock.every(1000, () => refresh($, bar))
    await measure($, bar)
    bar.baseTokens = data.context?.tokens

    return result
  })

  on('command.run', { command: 'status-bar' }, async ($, e) => {
    // `args` can come in missing from a plugin's `$.command.run`; read it as bare.
    const [verb = 'toggle', ...rest] = (e.args ?? '').trim().split(/\s+/).filter(w => w.length > 0)
    const arg = rest.join(' ')

    if (verb === 'on' || verb === 'off' || verb === 'toggle') {
      const next = await update($, isHidden, was => (verb === 'toggle' ? !was : verb === 'off'))
      await $.store.set(HIDDEN_KEY, next)
      await refresh($, bar)
      if (!next && !bar.config.isShown) return { text: 'The status bar is off in its settings (show = false).' }

      return { text: next ? 'Status bar hidden.' : 'Status bar shown.' }
    }

    if (verb === 'position' || verb === 'segments') {
      if (verb === 'position' && !isPosition(arg)) return { text: `Usage: /${COMMAND} position above|below|status` }
      if (verb === 'segments' && parseLayout(arg).length === 0) {
        return { text: `Usage: /${COMMAND} segments ${DEFAULT_SEGMENTS}` }
      }
      await $.store.set(verb, arg)
      bar.overrides[verb] = arg
      reconfigure(bar)
      await refresh($, bar)

      return { text: `Status bar ${verb}: ${arg}` }
    }

    return { text: `Usage: ${USAGE}` }
  })

  // A change in the `/config` menu applies now, and the person's choice there
  // replaces what `/status-bar` stored for that field.
  on('config.set', async ($, e, next) => {
    const result = await next(e)
    const field = ownField(e, $.plugin.name)
    if (field === undefined || 'deny' in result) return result
    bar.options = { ...bar.options, [field]: result.value }
    if (isOverride(field)) {
      await $.store.delete(field)
      bar.overrides[field] = undefined
    }
    reconfigure(bar)
    await refresh($, bar)

    return result
  })

  on('session.measure', async ($, e, next) => {
    data.context = e.context
    keepLimits(bar, e.rateLimits)
    data.cost = e.cost
    await refresh($, bar)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagent turns use their own cache prefix; track the main loop only.
    if (e.agentId === undefined) {
      if (e.usage !== undefined) data.lastResponseAt = await $.clock.now()
      await measure($, bar)
      // What this turn added to the context, against the last turn's end.
      const tokens = data.context?.tokens
      if (tokens !== undefined) {
        data.ctxDelta = bar.baseTokens === undefined ? undefined : tokens - bar.baseTokens
        bar.baseTokens = tokens
        await refresh($, bar)
      }
    }

    return result
  })

  on('session.end', async ($, e, next) => {
    const result = await next(e)
    // The conversation's figures go; the bar keeps its shape with placeholders.
    data.lastResponseAt = undefined
    data.split = undefined
    data.cost = undefined
    data.ctxDelta = undefined
    bar.baseTokens = undefined
    if (e.reason === 'clear') {
      // The process goes on under a new session: keep the clock and re-measure.
      await measure($, bar).catch(() => refresh($, bar))
      bar.baseTokens = data.context?.tokens
    } else {
      bar.tick?.cancel()
      bar.tick = undefined
    }

    return result
  })

  // Both places are hooked: `/status-bar position` moves the bar at runtime.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (bar.config.position !== 'above' || e.props.hasSurvey || (await isBarHidden($, bar))) return next(e)
    const columns = e.props.bodyColumns

    return drawBar($.ui.resolve(e), await groupsAt($, bar, columns), columns)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    if (bar.config.position !== 'below' || (await isBarHidden($, bar))) return hint
    // The hint line is indented by two cells on each side.
    const columns = Math.max(20, (e.viewport?.columns ?? 100) - 4)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {hint}
        {drawBar({ Box, Text }, await groupsAt($, bar, columns), columns)}
      </Box>
    )
  })
}
