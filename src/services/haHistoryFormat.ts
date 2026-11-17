import type { HAHistoryEntry, HAHistoryResponse } from '../types/homeAssistant'

/**
 * Compressed state row as returned by the `history/history_during_period`
 * websocket command (HA core: recorder/models/state.py `row_to_compressed_state`).
 *
 *  - `s`  state
 *  - `a`  attributes (omitted when `no_attributes: true`, and on non-first rows
 *         when `minimal_response: true`)
 *  - `lu` last_updated, UNIX timestamp in seconds (float)
 *  - `lc` last_changed, UNIX timestamp in seconds; only present when it differs from `lu`
 *
 * With `include_start_time_state: true` the first row represents the state at
 * `start_time`, and its `lu` is clamped to `start_time`.
 */
export interface HACompressedState {
  s: string
  a?: Record<string, any>
  lu: number
  lc?: number
}

export type HACompressedHistoryResponse = Record<string, HACompressedState[]>

const tsToIso = (ts: number | string): string => {
  // Defensive: accept ISO strings too in case a server ever returns them.
  if (typeof ts === 'string') return new Date(ts).toISOString()
  return new Date(Math.round(ts * 1000)).toISOString()
}

/**
 * Convert a compressed websocket history response into the app's
 * `HAHistoryResponse` shape used by workers/WASM/buffers.
 * Entities with no rows are omitted (mirrors the old REST behaviour).
 */
export function convertCompressedHistory(raw: HACompressedHistoryResponse | null | undefined): HAHistoryResponse {
  const result: HAHistoryResponse = {}
  if (!raw) return result

  for (const [entityId, rows] of Object.entries(raw)) {
    if (!Array.isArray(rows) || rows.length === 0) continue
    const entries: HAHistoryEntry[] = new Array(rows.length)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const lastUpdated = tsToIso(row.lu)
      entries[i] = {
        entity_id: entityId,
        state: row.s,
        last_changed: row.lc !== undefined ? tsToIso(row.lc) : lastUpdated,
        last_updated: lastUpdated,
        attributes: row.a ?? {}
      }
    }
    result[entityId] = entries
  }
  return result
}

/** Split an array into chunks of at most `size` items. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
