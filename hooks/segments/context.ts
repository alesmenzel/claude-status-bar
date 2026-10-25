import type { Run, Segment, Split } from '../segment'
import {
  DELTA_PLACEHOLDER,
  deltaText,
  GROUP_COLORS,
  GROUPS,
  kTokens,
  label,
  contextWindow,
  isOverLimit,
  PERCENT_PLACEHOLDER,
  percentRun,
  stackedMeter,
  value,
} from '../segment'

const TOKENS_PLACEHOLDER = '  --'

// The share of the window used: the engine's own figure against its window,
// or the tokens against a lower `contextLimit` not yet passed. Undefined with
// no figure.
const usedFraction = (
  context: { tokens?: number; window: number; percent?: number } | undefined,
  window: number,
): number | undefined => {
  if (context === undefined) return undefined
  if (window === context.window) return context.percent === undefined ? undefined : context.percent / 100
  return context.tokens === undefined || window <= 0 ? undefined : context.tokens / window
}

// The context window: `ctx ████░░░░  62k/200k  31% +4.1k`, the bar's cells
// colored by the group that fills them, the percentage colored past 50%, 75%
// and 90% as the other meters are, then what the last main-loop turn added.
// With a `contextLimit` below the engine's window, all of it counts against
// that limit (`62k/256k  24%`) up to it; past it, against the engine's window
// again (`320k/1.0M  32%`), the window figure magenta to say the limit is
// passed. Empty cells and `--` before the first figure; `+--` for the
// delta until two turn ends are measured. A narrow bar drops the delta.
export const ctx: Segment = {
  id: 'ctx',
  render: ({ data, ctxCells, isNarrow, contextLimit }) => {
    const context = data.context
    const window = context === undefined ? 0 : contextWindow(context.window, contextLimit, context.tokens)
    const isPassed = context !== undefined && isOverLimit(context.window, contextLimit, context.tokens)
    const fraction = usedFraction(context, window)
    const runs: Run[] = [label('ctx '), ...stackedMeter(data.split, window, ctxCells), label(' ')]
    runs.push(
      value(context?.tokens === undefined ? TOKENS_PLACEHOLDER : kTokens(context.tokens)),
      isPassed
        ? { text: `/${kTokens(window)}`, tone: 'label', color: 'magenta' }
        : label(`/${context === undefined ? TOKENS_PLACEHOLDER : kTokens(window)}`),
      label(' '),
      fraction === undefined ? value(PERCENT_PLACEHOLDER) : percentRun(fraction),
    )
    if (!isNarrow) runs.push(label(' '), value(data.ctxDelta === undefined ? DELTA_PLACEHOLDER : deltaText(data.ctxDelta)))

    return runs
  },
  // On hover the legend takes the meter's place, in the form that fits it.
  hover: ({ data }, width) => legendRuns(data.split, width),
}

// The context split's legend: `■ sys  10k  ■ tools  20k  ■ mcp  10k  ■ conv  20k`
// (49 cells), or where fewer than that fit, the squares and figures alone:
// `■ 10k ■ 20k ■ 10k ■ 20k` (23 cells; ' 10k' is kTokens' own padding).
export const LEGEND_WIDTH = { full: 49, compact: 23 } as const

export const legendRuns = (split: Split | undefined, width: number = LEGEND_WIDTH.full): Run[] => {
  const isFull = width >= LEGEND_WIDTH.full
  const runs: Run[] = []
  for (const key of GROUPS) {
    if (runs.length > 0) runs.push(label(isFull ? '  ' : ' '))
    runs.push({ text: '■', tone: 'value', color: GROUP_COLORS[key] })
    // kTokens pads to 4 cells, so the compact form needs no gap of its own.
    if (isFull) runs.push(label(` ${key} `))
    runs.push(value(split === undefined ? TOKENS_PLACEHOLDER : kTokens(split[key])))
  }

  return runs
}

// The legend as a segment of its own, for a terminal with no pointer to hover
// the context meter with. Only where the bar has room for it.
export const legend: Segment = {
  id: 'legend',
  render: ({ data, isCrowded }) => (isCrowded ? null : legendRuns(data.split)),
}
