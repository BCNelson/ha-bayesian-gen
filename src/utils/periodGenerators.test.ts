import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  mergeSpans,
  clipSpans,
  subtractSpans,
  complementSpans,
  intersectSpans,
  trimSpans,
  filterMinDuration,
  matchesState,
  historyToSpans,
  generateFromHistory,
  scheduleToSpans,
  generateFromSchedule,
  summarize,
  toTimePeriods,
  parseTime,
  type Span
} from './periodGenerators'

const H = 3_600_000
const M = 60_000
const sp = (start: number, end: number): Span => ({ start, end })

// Pin a DST-observing zone so the schedule tests are deterministic
const originalTZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
afterAll(() => {
  process.env.TZ = originalTZ
})

/** Local-time helper (month is 1-based for readability) */
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

describe('span operations', () => {
  it('merges overlapping and adjacent spans', () => {
    expect(mergeSpans([sp(5, 10), sp(0, 5), sp(8, 12), sp(20, 30)])).toEqual([sp(0, 12), sp(20, 30)])
  })

  it('merges spans within the tolerance gap', () => {
    expect(mergeSpans([sp(0, 10), sp(12, 20)], 2)).toEqual([sp(0, 20)])
    expect(mergeSpans([sp(0, 10), sp(13, 20)], 2)).toEqual([sp(0, 10), sp(13, 20)])
  })

  it('drops empty and inverted spans when merging', () => {
    expect(mergeSpans([sp(5, 5), sp(10, 3), sp(1, 2)])).toEqual([sp(1, 2)])
  })

  it('clips to range', () => {
    expect(clipSpans([sp(-5, 5), sp(8, 20), sp(30, 40)], sp(0, 10))).toEqual([sp(0, 5), sp(8, 10)])
  })

  it('subtracts spans', () => {
    expect(subtractSpans([sp(0, 100)], [sp(10, 20), sp(50, 60)])).toEqual([sp(0, 10), sp(20, 50), sp(60, 100)])
    expect(subtractSpans([sp(0, 10)], [sp(-5, 20)])).toEqual([])
  })

  it('computes complement with exclusions', () => {
    expect(complementSpans([sp(10, 20)], sp(0, 50), [sp(30, 40)])).toEqual([sp(0, 10), sp(20, 30), sp(40, 50)])
  })

  it('intersects span lists', () => {
    expect(intersectSpans([sp(0, 10), sp(20, 30)], [sp(5, 25)])).toEqual([sp(5, 10), sp(20, 25)])
  })

  it('trims interior edges but not range edges', () => {
    const range = sp(0, 100)
    expect(trimSpans([sp(0, 40), sp(60, 100)], 5, range)).toEqual([sp(0, 35), sp(65, 100)])
    expect(trimSpans([sp(40, 48)], 5, range)).toEqual([])
  })

  it('filters by minimum duration', () => {
    expect(filterMinDuration([sp(0, 5), sp(10, 30)], 10)).toEqual([sp(10, 30)])
  })
})

describe('matchesState', () => {
  it('matches discrete states', () => {
    expect(matchesState('on', { kind: 'state', states: ['on'] })).toBe(true)
    expect(matchesState('off', { kind: 'state', states: ['on'] })).toBe(false)
  })

  it('uses strict above/below like HA numeric_state', () => {
    const m = { kind: 'numeric' as const, above: 20, below: 25 }
    expect(matchesState('22.5', m)).toBe(true)
    expect(matchesState('20', m)).toBe(false)
    expect(matchesState('25', m)).toBe(false)
    expect(matchesState('unavailable', m)).toBe(false)
    expect(matchesState('', m)).toBe(false)
  })

  it('never matches numeric with no bounds', () => {
    expect(matchesState('5', { kind: 'numeric' })).toBe(false)
  })
})

describe('generateFromHistory', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0)
  const iso = (offsetH: number) => new Date(t0 + offsetH * H).toISOString()
  const range = sp(t0, t0 + 24 * H)
  const history = [
    { state: 'off', last_changed: iso(0) },
    { state: 'on', last_changed: iso(2) },
    { state: 'off', last_changed: iso(8) },
    { state: 'unavailable', last_changed: iso(12) },
    { state: 'off', last_changed: iso(13) },
    { state: 'on', last_changed: iso(22) }
  ]

  it('splits history into matched and unknown spans', () => {
    const { matched, unknown } = historyToSpans(history, { kind: 'state', states: ['on'] }, range)
    expect(matched).toEqual([sp(t0 + 2 * H, t0 + 8 * H), sp(t0 + 22 * H, t0 + 24 * H)])
    expect(unknown).toEqual([sp(t0 + 12 * H, t0 + 13 * H)])
  })

  it('FALSE is the complement minus unknown', () => {
    const r = generateFromHistory(history, { matcher: { kind: 'state', states: ['on'] }, range })
    expect(r.trueSpans).toEqual([sp(t0 + 2 * H, t0 + 8 * H), sp(t0 + 22 * H, t0 + 24 * H)])
    expect(r.falseSpans).toEqual([sp(t0, t0 + 2 * H), sp(t0 + 8 * H, t0 + 12 * H), sp(t0 + 13 * H, t0 + 22 * H)])
  })

  it('treats time before the first data point as unknown', () => {
    const r = generateFromHistory([{ state: 'on', last_changed: iso(5) }], {
      matcher: { kind: 'state', states: ['on'] },
      range
    })
    expect(r.trueSpans).toEqual([sp(t0 + 5 * H, t0 + 24 * H)])
    expect(r.falseSpans).toEqual([])
  })

  it('clips history that starts before the range', () => {
    const r = generateFromHistory([{ state: 'on', last_changed: new Date(t0 - 10 * H).toISOString() }], {
      matcher: { kind: 'state', states: ['on'] },
      range
    })
    expect(r.trueSpans).toEqual([range])
  })

  it('applies min duration and buffer', () => {
    const blip = [
      { state: 'off', last_changed: iso(0) },
      { state: 'on', last_changed: iso(4) },
      { state: 'off', last_changed: new Date(t0 + 4 * H + 5 * M).toISOString() },
      { state: 'on', last_changed: iso(10) },
      { state: 'off', last_changed: iso(16) }
    ]
    const r = generateFromHistory(blip, {
      matcher: { kind: 'state', states: ['on'] },
      range,
      minDurationMinutes: 30,
      bufferMinutes: 15
    })
    // 5-minute blip dropped; the 6h span trimmed by 15 min each side
    expect(r.trueSpans).toEqual([sp(t0 + 10 * H + 15 * M, t0 + 16 * H - 15 * M)])
    // FALSE spans: [0,4h) (range start untouched), [4h05,10h), [16h,24h) (range end untouched)
    expect(r.falseSpans).toEqual([
      sp(t0, t0 + 4 * H - 15 * M),
      sp(t0 + 4 * H + 5 * M + 15 * M, t0 + 10 * H - 15 * M),
      sp(t0 + 16 * H + 15 * M, t0 + 24 * H)
    ])
  })

  it('supports numeric thresholds', () => {
    const numeric = [
      { state: '10', last_changed: iso(0) },
      { state: '30', last_changed: iso(6) },
      { state: '15', last_changed: iso(12) }
    ]
    const r = generateFromHistory(numeric, { matcher: { kind: 'numeric', above: 20 }, range })
    expect(r.trueSpans).toEqual([sp(t0 + 6 * H, t0 + 12 * H)])
    expect(summarize(r)).toEqual({ trueCount: 1, falseCount: 2, trueHours: 6, falseHours: 18 })
  })

  it('returns no spans for empty history', () => {
    const r = generateFromHistory([], { matcher: { kind: 'state', states: ['on'] }, range })
    expect(r).toEqual({ trueSpans: [], falseSpans: [] })
  })
})

describe('scheduleToSpans', () => {
  it('parses times', () => {
    expect(parseTime('07:30')).toEqual({ h: 7, m: 30 })
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('abc')).toBeNull()
  })

  it('builds same-day windows on selected weekdays', () => {
    // Mon 2026-01-05 .. Mon 2026-01-12
    const range = sp(local(2026, 1, 5), local(2026, 1, 12))
    const spans = scheduleToSpans({ startTime: '09:00', endTime: '17:00', weekdays: [1, 3] }, range)
    expect(spans).toEqual([
      sp(local(2026, 1, 5, 9), local(2026, 1, 5, 17)),
      sp(local(2026, 1, 7, 9), local(2026, 1, 7, 17))
    ])
  })

  it('handles windows that cross midnight, including one started before the range', () => {
    // Range starts Tue 02:00; Monday-night window 23:00–07:00 should be clipped in
    const range = sp(local(2026, 1, 6, 2), local(2026, 1, 7, 12))
    const spans = scheduleToSpans({ startTime: '23:00', endTime: '07:00', weekdays: [1, 2] }, range)
    expect(spans).toEqual([
      sp(local(2026, 1, 6, 2), local(2026, 1, 6, 7)),
      sp(local(2026, 1, 6, 23), local(2026, 1, 7, 7))
    ])
  })

  it('merges consecutive overnight windows that touch', () => {
    const range = sp(local(2026, 1, 5), local(2026, 1, 8))
    const spans = scheduleToSpans({ startTime: '12:00', endTime: '12:00', weekdays: [0, 1, 2, 3, 4, 5, 6] }, range)
    // start == end means a 24h window; consecutive days merge into the full range
    expect(spans).toEqual([range])
  })

  it('keeps local wall-clock times across DST spring-forward', () => {
    // US DST starts Sun 2026-03-08 02:00 local
    const range = sp(local(2026, 3, 7), local(2026, 3, 10))
    const spans = scheduleToSpans({ startTime: '23:00', endTime: '07:00', weekdays: [6] }, range)
    expect(spans).toHaveLength(1)
    const s = spans[0]
    expect(new Date(s.start).getHours()).toBe(23)
    expect(new Date(s.end).getHours()).toBe(7)
    expect((s.end - s.start) / H).toBe(7) // one hour lost
  })

  it('keeps local wall-clock times across DST fall-back', () => {
    // US DST ends Sun 2026-11-01 02:00 local
    const range = sp(local(2026, 10, 31), local(2026, 11, 3))
    const spans = scheduleToSpans({ startTime: '23:00', endTime: '07:00', weekdays: [6] }, range)
    expect(spans).toHaveLength(1)
    expect((spans[0].end - spans[0].start) / H).toBe(9) // one hour gained
  })

  it('returns nothing for invalid input', () => {
    const range = sp(local(2026, 1, 5), local(2026, 1, 12))
    expect(scheduleToSpans({ startTime: 'x', endTime: '07:00', weekdays: [1] }, range)).toEqual([])
    expect(scheduleToSpans({ startTime: '09:00', endTime: '17:00', weekdays: [] }, range)).toEqual([])
  })
})

describe('generateFromSchedule', () => {
  const range = sp(local(2026, 1, 5), local(2026, 1, 7)) // Mon 00:00 .. Wed 00:00

  it('FALSE defaults to the complement', () => {
    const r = generateFromSchedule({
      trueWindow: { startTime: '22:00', endTime: '06:00', weekdays: [1] },
      range
    })
    expect(r.trueSpans).toEqual([sp(local(2026, 1, 5, 22), local(2026, 1, 6, 6))])
    expect(r.falseSpans).toEqual([
      sp(range.start, local(2026, 1, 5, 22)),
      sp(local(2026, 1, 6, 6), range.end)
    ])
  })

  it('uses an explicit FALSE window and never overlaps TRUE', () => {
    const r = generateFromSchedule({
      trueWindow: { startTime: '22:00', endTime: '06:00', weekdays: [1, 2] },
      falseWindow: { startTime: '05:00', endTime: '12:00', weekdays: [1, 2] },
      range
    })
    expect(r.falseSpans).toEqual([
      sp(local(2026, 1, 5, 5), local(2026, 1, 5, 12)),
      sp(local(2026, 1, 6, 6), local(2026, 1, 6, 12))
    ])
    expect(intersectSpans(r.trueSpans, r.falseSpans)).toEqual([])
  })

  it('converts to TimePeriods sorted by start', () => {
    const r = generateFromSchedule({
      trueWindow: { startTime: '22:00', endTime: '06:00', weekdays: [1] },
      range
    })
    const periods = toTimePeriods(r, 'Sleep')
    expect(periods.map(p => p.isTruePeriod)).toEqual([false, true, false])
    expect(new Set(periods.map(p => p.id)).size).toBe(3)
    expect(periods[1].label).toBe('Sleep (TRUE)')
  })
})
