// The status-bar contract: the `$.statusBar` noun other mods call to add their
// own segments to the bar, and the session state the bar keeps.

/**
 * One run of text in a segment. `tone` picks the bar's own dim colors:
 * `label` (the dimmest) or `value` (the default). `color` (a theme key such
 * as `success`, or a hex `#rrggbb`) wins over `tone`.
 */
export type StatusBarRun = {
  text: string
  tone?: 'label' | 'value'
  color?: string
}

/**
 * A segment another mod publishes: what the bar draws under `id`. `runs` is
 * drawn on a wide bar, `narrowRuns` (when given) on a narrow one, and
 * `hoverRuns` (when given) in the same cells while the pointer is over the
 * segment, both views padded to one width so nothing moves. The status line
 * has no pointer and never shows `hoverRuns`. The bar draws the segment only
 * where the `segments` option names `id`.
 */
export type StatusBarSegmentSpec = {
  id: string
  runs: readonly StatusBarRun[]
  narrowRuns?: readonly StatusBarRun[]
  hoverRuns?: readonly StatusBarRun[]
}

/**
 * What `$.statusBar.segment` and `$.statusBar.remove` answer: the id, and
 * whether the `segments` option places it in the bar.
 */
export type StatusBarSegmentResult = {
  id: string
  isPlaced: boolean
}

/**
 * The noun status-bar adds to `$`. A mod that lists `status-bar` under
 * `dependencies` calls it from any hook or timer.
 */
export type StatusBar = {
  /** Adds or replaces the segment under `spec.id`. */
  segment: (spec: StatusBarSegmentSpec) => Promise<StatusBarSegmentResult>
  /** Removes the segment under `id`. */
  remove: (args: { id: string }) => Promise<StatusBarSegmentResult>
}

declare module 'claude-code' {
  interface EngineInterface {
    statusBar: StatusBar
  }
  interface PluginState {
    'status-bar': { isHidden: boolean }
  }
}
