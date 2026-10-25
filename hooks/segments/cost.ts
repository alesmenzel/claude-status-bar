import type { Run, Segment } from '../segment'
import { label, METER_WIDTH, meter, PERCENT_PLACEHOLDER, percentRun, value } from '../segment'

// Cells the dollar figure takes: '$1.24' is padded to ' $1.24' and so on, so
// the bar keeps its width up to $9999.99.
const USD_WIDTH = 8

// The session cost against the `budgetUsd` option: `$1.24 / $10 ━─────── 12%`;
// with no budget (0, the default), the cost alone: `$1.24`. The engine gives
// mods no account budget in dollars (`session.usage` has the session's `cost`
// and the rate-limit windows' percentages only), so the budget is the
// person's own. `$-.--` before the session has a figure.
export const cost: Segment = {
  id: 'cost',
  render: ({ data, isNarrow, budgetUsd }) => {
    const usd = data.cost?.usd
    const runs: Run[] = [value((usd === undefined ? '$-.--' : `$${usd.toFixed(2)}`).padStart(USD_WIDTH))]
    if (budgetUsd > 0) {
      const fraction = usd === undefined ? undefined : usd / budgetUsd
      runs.push(label(` / $${budgetUsd} `))
      if (!isNarrow) runs.push(...meter(fraction ?? 0, METER_WIDTH), label(' '))
      runs.push(fraction === undefined ? value(PERCENT_PLACEHOLDER) : percentRun(fraction))
    }

    return runs
  },
}
