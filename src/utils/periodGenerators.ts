/**
 * Pure helpers that turn entity histories or recurring schedules into
 * TRUE / FALSE time periods.
 *
 * All span math is done on epoch milliseconds. Calendar math (schedules)
 * uses the local time zone via `new Date(y, m, d, h, min)` so DST shifts are
 * handled by the platform: a 23:00–07:00 window is always 23:00 local to
 * 07:00 local, even if that night is 7 or 9 hours long.
 */
import type { TimePeriod } from '../types/bayesian'

export interface Span {
  start: number
  end: number
}

export interface HistoryPoint {
  state: string
  last_changed: string
}

export type StateMatcher =
  | { kind: 'state'; states: string[] }
  | { kind: 'numeric'; above?: number; below?: number }

/** States that mean "we don't know" – excluded from both TRUE and FALSE. */
export const UNKNOWN_STATES = new Set(['unavailable', 'unknown', ''])

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

// ---------------------------------------------------------------------------
// Generic span operations
// ---------------------------------------------------------------------------

/** Sort and merge overlapping or touching spans (gap <= toleranceMs). */
export function mergeSpans(spans: Span[], toleranceMs = 0): Span[] {
  const sorted = spans
    .filter(s => s.end > s.start)
    .map(s => ({ ...s }))
    .sort((a, b) => a.start - b.start)
  const out: Span[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.start - last.end <= toleranceMs) {
      last.end = Math.max(last.end, s.end)
    } else {
      out.push(s)
    }
  }
  return out
}

/** Clip spans to a range, dropping anything entirely outside it. */
export function clipSpans(spans: Span[], range: Span): Span[] {
  const out: Span[] = []
  for (const s of spans) {
    const start = Math.max(s.start, range.start)
    const end = Math.min(s.end, range.end)
    if (end > start) out.push({ start, end })
  }
  return out
}

/** Remove `remove` spans from `spans`. */
export function subtractSpans(spans: Span[], remove: Span[]): Span[] {
  const cuts = mergeSpans(remove)
  let result = mergeSpans(spans)
  for (const cut of cuts) {
    const next: Span[] = []
    for (const s of result) {
      if (cut.end <= s.start || cut.start >= s.end) {
        next.push(s)
        continue
      }
      if (cut.start > s.start) next.push({ start: s.start, end: cut.start })
      if (cut.end < s.end) next.push({ start: cut.end, end: s.end })
    }
    result = next
  }
  return result
}

/** Everything in `range` that is not covered by `spans` (or `exclude`). */
export function complementSpans(spans: Span[], range: Span, exclude: Span[] = []): Span[] {
  return subtractSpans([range], [...spans, ...exclude])
}

/** Intersection of two span lists. */
export function intersectSpans(a: Span[], b: Span[]): Span[] {
  const out: Span[] = []
  const ma = mergeSpans(a)
  const mb = mergeSpans(b)
  let i = 0
  let j = 0
  while (i < ma.length && j < mb.length) {
    const start = Math.max(ma[i].start, mb[j].start)
    const end = Math.min(ma[i].end, mb[j].end)
    if (end > start) out.push({ start, end })
    if (ma[i].end < mb[j].end) i++
    else j++
  }
  return out
}

export function filterMinDuration(spans: Span[], minMs: number): Span[] {
  if (minMs <= 0) return spans
  return spans.filter(s => s.end - s.start >= minMs)
}

/**
 * Shrink each span by `bufferMs` on both sides so data close to a transition
 * isn't attributed to the wrong side. Edges that coincide with the outer
 * `range` are left alone (they are not real transitions).
 */
export function trimSpans(spans: Span[], bufferMs: number, range?: Span): Span[] {
  if (bufferMs <= 0) return spans
  const out: Span[] = []
  for (const s of spans) {
    const start = range && s.start <= range.start ? s.start : s.start + bufferMs
    const end = range && s.end >= range.end ? s.end : s.end - bufferMs
    if (end > start) out.push({ start, end })
  }
  return out
}

export function totalDuration(spans: Span[]): number {
  return spans.reduce((sum, s) => sum + (s.end - s.start), 0)
}

// ---------------------------------------------------------------------------
// Entity history → spans
// ---------------------------------------------------------------------------

export function matchesState(state: string, matcher: StateMatcher): boolean {
  if (matcher.kind === 'state') {
    return matcher.states.includes(state)
  }
  if (state.trim() === '') return false
  const value = Number(state)
  if (!Number.isFinite(value)) return false
  if (matcher.above === undefined && matcher.below === undefined) return false
  // Same semantics as HA numeric_state: strictly above / strictly below
  if (matcher.above !== undefined && !(value > matcher.above)) return false
  if (matcher.below !== undefined && !(value < matcher.below)) return false
  return true
}

/**
 * Walk a state history and return the spans where the matcher matched and the
 * spans where the entity was unknown/unavailable (or had no data yet).
 * Each state holds from its `last_changed` until the next entry's, the last
 * one until `range.end`.
 */
export function historyToSpans(
  history: HistoryPoint[],
  matcher: StateMatcher,
  range: Span
): { matched: Span[]; unknown: Span[] } {
  const points = history
    .map(h => ({ state: h.state, t: new Date(h.last_changed).getTime() }))
    .filter(p => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)

  const matched: Span[] = []
  const unknown: Span[] = []

  if (points.length === 0) {
    return { matched, unknown: [{ ...range }] }
  }

  // No data before the first point – treat as unknown
  if (points[0].t > range.start) {
    unknown.push({ start: range.start, end: points[0].t })
  }

  for (let i = 0; i < points.length; i++) {
    const start = points[i].t
    const end = i + 1 < points.length ? points[i + 1].t : range.end
    const [clipped] = clipSpans([{ start, end }], range)
    if (!clipped) continue
    const state = points[i].state
    if (UNKNOWN_STATES.has(state)) {
      unknown.push(clipped)
    } else if (matchesState(state, matcher)) {
      matched.push(clipped)
    }
  }

  return { matched: mergeSpans(matched), unknown: mergeSpans(unknown) }
}

export interface PostProcessOptions {
  /** Drop TRUE/FALSE spans shorter than this many minutes. */
  minDurationMinutes?: number
  /** Trim this many minutes off each side of every transition. */
  bufferMinutes?: number
}

export interface GeneratedSpans {
  trueSpans: Span[]
  falseSpans: Span[]
}

function postProcess(trueSpans: Span[], falseSpans: Span[], range: Span, opts: PostProcessOptions): GeneratedSpans {
  const minMs = (opts.minDurationMinutes ?? 0) * MINUTE_MS
  const bufferMs = (opts.bufferMinutes ?? 0) * MINUTE_MS
  // Min duration is applied to the raw spans (drops brief blips), the buffer
  // is applied afterwards. Spans dropped here count as neither TRUE nor FALSE.
  const t = trimSpans(filterMinDuration(mergeSpans(trueSpans), minMs), bufferMs, range)
  const f = trimSpans(filterMinDuration(mergeSpans(falseSpans), minMs), bufferMs, range)
  return { trueSpans: t, falseSpans: f }
}

export interface EntityGeneratorOptions extends PostProcessOptions {
  matcher: StateMatcher
  range: Span
}

/** TRUE = spans where the entity matched, FALSE = the known complement. */
export function generateFromHistory(history: HistoryPoint[], opts: EntityGeneratorOptions): GeneratedSpans {
  const { matched, unknown } = historyToSpans(history, opts.matcher, opts.range)
  const falseSpans = complementSpans(matched, opts.range, unknown)
  return postProcess(matched, falseSpans, opts.range, opts)
}

// ---------------------------------------------------------------------------
// Recurring schedules
// ---------------------------------------------------------------------------

export interface ScheduleWindow {
  /** "HH:mm" local time */
  startTime: string
  /** "HH:mm" local time; <= startTime means the window ends the next day */
  endTime: string
  /** Days (0 = Sunday … 6 = Saturday) on which the window *starts* */
  weekdays: number[]
}

export function parseTime(value: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return { h, m }
}

/** All occurrences of a weekly window that overlap `range`, clipped and merged. */
export function scheduleToSpans(window: ScheduleWindow, range: Span): Span[] {
  const start = parseTime(window.startTime)
  const end = parseTime(window.endTime)
  if (!start || !end || window.weekdays.length === 0 || range.end <= range.start) return []

  const crossesMidnight = end.h * 60 + end.m <= start.h * 60 + start.m
  const days = new Set(window.weekdays)
  const spans: Span[] = []

  // Start one day early so a window that began yesterday evening is included
  const first = new Date(range.start)
  const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate() - 1)
  const last = new Date(range.end)
  const stop = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)

  while (cursor.getTime() <= stop.getTime()) {
    if (days.has(cursor.getDay())) {
      const y = cursor.getFullYear()
      const mo = cursor.getMonth()
      const d = cursor.getDate()
      const s = new Date(y, mo, d, start.h, start.m).getTime()
      const e = new Date(y, mo, d + (crossesMidnight ? 1 : 0), end.h, end.m).getTime()
      if (e > s) spans.push({ start: s, end: e })
    }
    // Advance by calendar day (not 24h) so DST days don't drift
    cursor.setDate(cursor.getDate() + 1)
  }

  return mergeSpans(clipSpans(spans, range))
}

export interface ScheduleGeneratorOptions extends PostProcessOptions {
  trueWindow: ScheduleWindow
  /** FALSE = everything else (default) or a specific window */
  falseWindow?: ScheduleWindow | null
  range: Span
}

export function generateFromSchedule(opts: ScheduleGeneratorOptions): GeneratedSpans {
  const trueSpans = scheduleToSpans(opts.trueWindow, opts.range)
  const falseSpans = opts.falseWindow
    ? subtractSpans(scheduleToSpans(opts.falseWindow, opts.range), trueSpans)
    : complementSpans(trueSpans, opts.range)
  return postProcess(trueSpans, falseSpans, opts.range, opts)
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export interface GenerationSummary {
  trueCount: number
  falseCount: number
  trueHours: number
  falseHours: number
}

export function summarize(result: GeneratedSpans): GenerationSummary {
  return {
    trueCount: result.trueSpans.length,
    falseCount: result.falseSpans.length,
    trueHours: totalDuration(result.trueSpans) / HOUR_MS,
    falseHours: totalDuration(result.falseSpans) / HOUR_MS
  }
}

let idCounter = 0

export function toTimePeriods(result: GeneratedSpans, labelPrefix = 'Generated'): TimePeriod[] {
  const stamp = Date.now()
  const make = (s: Span, isTrue: boolean): TimePeriod => ({
    id: `gen-${stamp}-${idCounter++}`,
    start: new Date(s.start),
    end: new Date(s.end),
    isTruePeriod: isTrue,
    label: `${labelPrefix} (${isTrue ? 'TRUE' : 'FALSE'})`
  })
  return [
    ...result.trueSpans.map(s => make(s, true)),
    ...result.falseSpans.map(s => make(s, false))
  ].sort((a, b) => a.start.getTime() - b.start.getTime())
}

/** Lookback range ending now (or at `now`), in whole days. */
export function lookbackRange(days: number, now: Date = new Date()): Span {
  return { start: now.getTime() - days * 24 * HOUR_MS, end: now.getTime() }
}
