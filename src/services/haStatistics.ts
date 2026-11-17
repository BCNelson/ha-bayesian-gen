/**
 * Long-term statistics fallback.
 *
 * The recorder purges raw state history after `purge_keep_days` (default 10),
 * but keeps hourly long-term statistics indefinitely for entities that have a
 * `state_class` attribute (numeric sensors). When the user asks for periods
 * older than the raw history, we synthesize history rows from the hourly
 * statistic means for the missing span.
 *
 * LIMITATION: statistics are *averages* over the period (hour/5 minutes), not
 * real state changes. Short spikes are smoothed out, and threshold crossings are
 * only resolved to the statistic period. Synthesized rows are flagged with
 * `synthetic: true` so callers can tell them apart.
 */
import type { HAHistoryEntry, HAHistoryResponse } from '../types/homeAssistant'

export type StatisticsPeriod = '5minute' | 'hour'

/** Row returned by `recorder/statistics_during_period` (start/end are ms epoch). */
export interface HAStatisticRow {
  start: number
  end: number
  mean?: number | null
}

export type HAStatisticsResponse = Record<string, HAStatisticRow[]>

/** Minimal connection surface we need (lets tests pass a mock). */
export interface HAMessageSender {
  sendMessagePromise<T>(message: { type: string; [key: string]: any }): Promise<T>
}

export interface HistoryGap {
  entityId: string
  start: Date
  end: Date
}

/** Allowed slack between the requested start and the first history row. */
const GAP_TOLERANCE_MS = 5 * 60 * 1000

/**
 * Find entities whose raw history starts after the requested range start.
 * Only entities in `eligibleIds` (those with long-term statistics) are considered.
 */
export function findHistoryGaps(
  history: HAHistoryResponse,
  entityIds: string[],
  eligibleIds: ReadonlySet<string>,
  rangeStart: Date,
  rangeEnd: Date
): HistoryGap[] {
  const gaps: HistoryGap[] = []
  for (const entityId of entityIds) {
    if (!eligibleIds.has(entityId)) continue
    const rows = history[entityId]
    const firstTs = rows && rows.length > 0 ? new Date(rows[0].last_changed).getTime() : rangeEnd.getTime()
    if (firstTs - rangeStart.getTime() > GAP_TOLERANCE_MS) {
      gaps.push({ entityId, start: rangeStart, end: new Date(Math.min(firstTs, rangeEnd.getTime())) })
    }
  }
  return gaps
}

const formatMean = (mean: number): string => String(Number(mean.toFixed(4)))

/**
 * Build HAHistoryEntry rows from statistic means covering [gapStart, gapEnd).
 * Each statistic period becomes one "state change" at its start time
 * (clamped to gapStart). Periods with no mean are skipped.
 */
export function synthesizeHistoryFromStatistics(
  entityId: string,
  rows: HAStatisticRow[],
  gapStart: Date,
  gapEnd: Date,
  period: StatisticsPeriod = 'hour'
): HAHistoryEntry[] {
  const startMs = gapStart.getTime()
  const endMs = gapEnd.getTime()
  const out: HAHistoryEntry[] = []

  const sorted = [...rows].sort((a, b) => a.start - b.start)
  for (const row of sorted) {
    if (row.mean === null || row.mean === undefined || !Number.isFinite(row.mean)) continue
    if (row.end <= startMs || row.start >= endMs) continue
    const ts = new Date(Math.max(row.start, startMs)).toISOString()
    out.push({
      entity_id: entityId,
      state: formatMean(row.mean),
      last_changed: ts,
      last_updated: ts,
      attributes: { synthesized_from: 'statistics_mean', statistics_period: period },
      synthetic: true
    })
  }
  return out
}

/**
 * Fetch long-term statistics for every gap and prepend synthesized rows to the
 * history. Mutates and returns `history`. Failures are logged and ignored (the
 * raw history is still usable).
 */
export async function fillHistoryGapsWithStatistics(
  conn: HAMessageSender,
  history: HAHistoryResponse,
  gaps: HistoryGap[],
  period: StatisticsPeriod = 'hour'
): Promise<HAHistoryResponse> {
  if (gaps.length === 0) return history

  // All gaps share the same start (the requested range start); fetch in one call
  // up to the latest gap end.
  const start = new Date(Math.min(...gaps.map(g => g.start.getTime())))
  const end = new Date(Math.max(...gaps.map(g => g.end.getTime())))

  let stats: HAStatisticsResponse
  try {
    stats = await conn.sendMessagePromise<HAStatisticsResponse>({
      type: 'recorder/statistics_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: gaps.map(g => g.entityId),
      period,
      types: ['mean']
    })
  } catch (error) {
    console.warn('Long-term statistics fallback failed:', error)
    return history
  }

  for (const gap of gaps) {
    const rows = stats?.[gap.entityId]
    if (!rows || rows.length === 0) continue
    const synthesized = synthesizeHistoryFromStatistics(gap.entityId, rows, gap.start, gap.end, period)
    if (synthesized.length === 0) continue
    history[gap.entityId] = [...synthesized, ...(history[gap.entityId] ?? [])]
  }
  return history
}
