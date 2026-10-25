import type { Segment } from '../segment'
import { cache } from './cache'
import { ctx, legend } from './context'
import { cost } from './cost'
import { limit5h, limit7d, limitSpend } from './limits'

// Every built-in segment, by id.
export const BUILTIN_SEGMENTS: readonly Segment[] = [limit5h, limit7d, limitSpend, ctx, legend, cost, cache]

export { cache, cost, ctx, legend, limit5h, limit7d, limitSpend }
