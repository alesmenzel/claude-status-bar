import type { EngineInterface, Register } from 'claude-code'

// An example status-bar segment, published from a mod of its own. Add its id,
// `clock`, to status-bar's `segments` option (`...,cost,cache,clock`) to place it.

const pad = (n: number): string => String(n).padStart(2, '0')

// Publishes the segment; status-bar draws it on its next tick (once a second).
async function publish($: EngineInterface): Promise<void> {
  const now = new Date(await $.clock.now())
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  await $.statusBar.segment({
    id: 'clock',
    runs: [
      { text: 'clock ', tone: 'label' },
      { text: time, tone: 'value' },
    ],
    // A narrow bar drops the label.
    narrowRuns: [{ text: time, tone: 'value' }],
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await publish($)
    $.clock.every(15_000, () => publish($))

    return result
  })
}
