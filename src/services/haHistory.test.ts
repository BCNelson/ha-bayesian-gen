import { describe, it, expect, vi } from 'vitest'
import { convertCompressedHistory, chunk } from './haHistoryFormat'
import {
  findHistoryGaps,
  synthesizeHistoryFromStatistics,
  fillHistoryGapsWithStatistics,
  type HAMessageSender
} from './haStatistics'
import { HomeAssistantClient } from './homeAssistant'
import { enrichEntities, filterByScope, EMPTY_SCOPE } from './haRegistries'
import { EntityScorer } from './entityScorer'
import type { HAEntity, HAHistoryResponse, HARegistries } from '../types/homeAssistant'

const T0 = Date.UTC(2025, 0, 1, 0, 0, 0) // ms
const sec = (ms: number) => ms / 1000
const HOUR = 3600_000

describe('convertCompressedHistory', () => {
  it('converts compressed rows to HAHistoryEntry with ISO timestamps', () => {
    const result = convertCompressedHistory({
      'binary_sensor.door': [
        { s: 'off', a: {}, lu: sec(T0) },
        { s: 'on', lu: sec(T0 + 60_000) },
        { s: 'off', lu: sec(T0 + 120_000), lc: sec(T0 + 90_000) }
      ]
    })

    expect(result['binary_sensor.door']).toEqual([
      { entity_id: 'binary_sensor.door', state: 'off', last_changed: '2025-01-01T00:00:00.000Z', last_updated: '2025-01-01T00:00:00.000Z', attributes: {} },
      { entity_id: 'binary_sensor.door', state: 'on', last_changed: '2025-01-01T00:01:00.000Z', last_updated: '2025-01-01T00:01:00.000Z', attributes: {} },
      { entity_id: 'binary_sensor.door', state: 'off', last_changed: '2025-01-01T00:01:30.000Z', last_updated: '2025-01-01T00:02:00.000Z', attributes: {} }
    ])
  })

  it('handles fractional-second timestamps and keeps attributes', () => {
    const result = convertCompressedHistory({
      'sensor.t': [{ s: '21.5', a: { unit_of_measurement: '°C' }, lu: 1735689600.123456 }]
    })
    expect(result['sensor.t'][0].last_updated).toBe('2025-01-01T00:00:00.123Z')
    expect(result['sensor.t'][0].attributes).toEqual({ unit_of_measurement: '°C' })
  })

  it('omits entities with no rows and tolerates null', () => {
    expect(convertCompressedHistory({ 'sensor.x': [] })).toEqual({})
    expect(convertCompressedHistory(null)).toEqual({})
  })

  it('chunks arrays', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('statistics fallback', () => {
  const rangeStart = new Date(T0)
  const rangeEnd = new Date(T0 + 10 * HOUR)

  const historyStartingAt = (entityId: string, ms: number): HAHistoryResponse => ({
    [entityId]: [{
      entity_id: entityId,
      state: '20',
      last_changed: new Date(ms).toISOString(),
      last_updated: new Date(ms).toISOString(),
      attributes: {}
    }]
  })

  it('finds gaps only for eligible entities whose history starts late', () => {
    const history: HAHistoryResponse = {
      ...historyStartingAt('sensor.late', T0 + 5 * HOUR),
      ...historyStartingAt('sensor.ontime', T0),
      ...historyStartingAt('binary_sensor.late', T0 + 5 * HOUR)
    }
    const gaps = findHistoryGaps(
      history,
      ['sensor.late', 'sensor.ontime', 'binary_sensor.late', 'sensor.missing'],
      new Set(['sensor.late', 'sensor.ontime', 'sensor.missing']),
      rangeStart,
      rangeEnd
    )
    expect(gaps).toEqual([
      { entityId: 'sensor.late', start: rangeStart, end: new Date(T0 + 5 * HOUR) },
      { entityId: 'sensor.missing', start: rangeStart, end: rangeEnd }
    ])
  })

  it('synthesizes rows from means, skipping nulls and rows outside the gap', () => {
    const rows = synthesizeHistoryFromStatistics(
      'sensor.t',
      [
        { start: T0 + HOUR, end: T0 + 2 * HOUR, mean: 21.123456 },
        { start: T0 - HOUR, end: T0, mean: 1 }, // entirely before the gap
        { start: T0, end: T0 + HOUR, mean: 20 },
        { start: T0 + 2 * HOUR, end: T0 + 3 * HOUR, mean: null },
        { start: T0 + 3 * HOUR, end: T0 + 4 * HOUR, mean: 22 } // at/after gap end
      ],
      new Date(T0),
      new Date(T0 + 3 * HOUR)
    )
    expect(rows.map(r => [r.last_changed, r.state, r.synthetic])).toEqual([
      ['2025-01-01T00:00:00.000Z', '20', true],
      ['2025-01-01T01:00:00.000Z', '21.1235', true]
    ])
    expect(rows[0].entity_id).toBe('sensor.t')
    expect(rows[0].attributes.synthesized_from).toBe('statistics_mean')
  })

  it('clamps a statistic period that started before the gap to the gap start', () => {
    const rows = synthesizeHistoryFromStatistics(
      'sensor.t',
      [{ start: T0 - 30 * 60_000, end: T0 + 30 * 60_000, mean: 5 }],
      new Date(T0),
      new Date(T0 + HOUR)
    )
    expect(rows[0].last_changed).toBe(new Date(T0).toISOString())
  })

  it('fetches statistics via the connection and prepends synthesized rows', async () => {
    const history = historyStartingAt('sensor.late', T0 + 2 * HOUR)
    const conn: HAMessageSender = {
      sendMessagePromise: vi.fn().mockResolvedValue({
        'sensor.late': [
          { start: T0, end: T0 + HOUR, mean: 18 },
          { start: T0 + HOUR, end: T0 + 2 * HOUR, mean: 19 }
        ]
      }) as any
    }
    const gaps = [{ entityId: 'sensor.late', start: new Date(T0), end: new Date(T0 + 2 * HOUR) }]
    await fillHistoryGapsWithStatistics(conn, history, gaps)

    expect(conn.sendMessagePromise).toHaveBeenCalledWith({
      type: 'recorder/statistics_during_period',
      start_time: new Date(T0).toISOString(),
      end_time: new Date(T0 + 2 * HOUR).toISOString(),
      statistic_ids: ['sensor.late'],
      period: 'hour',
      types: ['mean']
    })
    expect(history['sensor.late'].map(e => e.state)).toEqual(['18', '19', '20'])
    expect(history['sensor.late'][2].synthetic).toBeUndefined()
  })

  it('leaves history untouched when statistics fail', async () => {
    const history = historyStartingAt('sensor.late', T0 + 2 * HOUR)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const conn: HAMessageSender = { sendMessagePromise: vi.fn().mockRejectedValue(new Error('nope')) as any }
    await fillHistoryGapsWithStatistics(conn, history, [
      { entityId: 'sensor.late', start: new Date(T0), end: new Date(T0 + 2 * HOUR) }
    ])
    expect(history['sensor.late']).toHaveLength(1)
    warn.mockRestore()
  })
})

describe('HomeAssistantClient (mocked connection)', () => {
  const makeConn = (handler: (msg: any) => any) => ({
    sendMessagePromise: vi.fn(async (msg: any) => handler(msg)),
    close: vi.fn(),
    haVersion: '2025.1.0'
  })

  it('batches history requests and fills gaps from statistics for state_class sensors', async () => {
    const start = new Date(T0)
    const end = new Date(T0 + 4 * HOUR)
    const conn = makeConn((msg) => {
      switch (msg.type) {
        case 'get_states':
          return [
            { entity_id: 'sensor.temp', state: '20', attributes: { state_class: 'measurement' }, last_changed: '', last_updated: '', context: {} },
            { entity_id: 'binary_sensor.door', state: 'off', attributes: {}, last_changed: '', last_updated: '', context: {} }
          ]
        case 'history/history_during_period':
          return Object.fromEntries(msg.entity_ids.map((id: string) => [
            id,
            [{ s: id === 'sensor.temp' ? '20' : 'off', lu: sec(T0 + 2 * HOUR) }]
          ]))
        case 'recorder/statistics_during_period':
          return { 'sensor.temp': [{ start: T0, end: T0 + HOUR, mean: 17 }, { start: T0 + HOUR, end: T0 + 2 * HOUR, mean: 18 }] }
      }
      throw new Error(`unexpected ${msg.type}`)
    })
    const client = new HomeAssistantClient(conn as any)
    await client.getStates()

    const ids = Array.from({ length: 30 }, (_, i) => `binary_sensor.b${i}`)
    const history = await client.getHistory(start, end, ['sensor.temp', 'binary_sensor.door', ...ids])

    const historyCalls = conn.sendMessagePromise.mock.calls.map(c => c[0]).filter(m => m.type === 'history/history_during_period')
    expect(historyCalls).toHaveLength(2) // 32 ids, 25 per batch
    expect(historyCalls[0]).toMatchObject({
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
      include_start_time_state: true
    })
    expect(history['sensor.temp'].map(e => e.state)).toEqual(['17', '18', '20'])
    expect(history['binary_sensor.door']).toHaveLength(1) // no statistics for non-numeric
    const statCalls = conn.sendMessagePromise.mock.calls.map(c => c[0]).filter(m => m.type === 'recorder/statistics_during_period')
    expect(statCalls).toHaveLength(1)
    expect(statCalls[0].statistic_ids).toEqual(['sensor.temp'])
  })

  it('returns {} for an empty id list without calling HA', async () => {
    const conn = makeConn(() => ({}))
    const client = new HomeAssistantClient(conn as any)
    expect(await client.getHistory(new Date(T0), undefined, [])).toEqual({})
    expect(conn.sendMessagePromise).not.toHaveBeenCalled()
  })
})

describe('registry enrichment and scope', () => {
  const state = (entity_id: string, attributes: Record<string, any> = {}): HAEntity => ({
    entity_id, state: 'on', last_changed: new Date().toISOString(), last_updated: new Date().toISOString(), attributes
  })
  const registries: HARegistries = {
    entities: [
      { entity_id: 'light.kitchen', name: null, original_name: 'Kitchen Light', device_id: 'd1', area_id: null, labels: ['l1'], platform: 'hue', hidden_by: null, disabled_by: null, entity_category: null },
      { entity_id: 'sensor.kitchen_signal', name: null, device_id: 'd1', area_id: null, labels: [], platform: 'hue', hidden_by: null, disabled_by: null, entity_category: 'diagnostic' },
      { entity_id: 'switch.bed', name: 'Bed switch', device_id: null, area_id: 'bedroom', labels: [], platform: 'x', hidden_by: 'user', disabled_by: null, entity_category: null }
    ],
    devices: [{ id: 'd1', name: 'Hue', name_by_user: null, area_id: 'kitchen' }],
    areas: [{ area_id: 'kitchen', name: 'Kitchen', floor_id: 'ground' }, { area_id: 'bedroom', name: 'Bedroom', floor_id: 'upstairs' }],
    floors: [{ floor_id: 'ground', name: 'Ground' }, { floor_id: 'upstairs', name: 'Upstairs' }],
    labels: [{ label_id: 'l1', name: 'Lighting' }]
  }

  const enriched = enrichEntities(
    [state('light.kitchen', { friendly_name: 'Kitchen' }), state('sensor.kitchen_signal'), state('switch.bed'), state('input_boolean.guest')],
    registries
  )

  it('resolves area via device, floor via area, and registry flags', () => {
    const [light, signal, bed, guest] = enriched
    expect(light.meta).toMatchObject({ name: 'Kitchen', area_id: 'kitchen', area_name: 'Kitchen', floor_id: 'ground', labels: ['l1'] })
    expect(signal.meta?.entity_category).toBe('diagnostic')
    expect(bed.meta).toMatchObject({ name: 'Bed switch', area_id: 'bedroom', floor_name: 'Upstairs', hidden: true })
    expect(guest.meta).toMatchObject({ area_id: null, hidden: false, disabled: false })
  })

  it('filters by scope (AND across categories, OR within)', () => {
    expect(filterByScope(enriched, EMPTY_SCOPE)).toHaveLength(4)
    expect(filterByScope(enriched, { ...EMPTY_SCOPE, floors: ['ground'] }).map(e => e.entity_id))
      .toEqual(['light.kitchen', 'sensor.kitchen_signal'])
    expect(filterByScope(enriched, { ...EMPTY_SCOPE, floors: ['ground'], domains: ['light'] }).map(e => e.entity_id))
      .toEqual(['light.kitchen'])
    expect(filterByScope(enriched, { ...EMPTY_SCOPE, labels: ['l1'] }).map(e => e.entity_id)).toEqual(['light.kitchen'])
  })

  it('scorer excludes hidden and diagnostic entities by default', () => {
    const ids = new EntityScorer().filterAndSortEntities(enriched)
    expect(ids).toContain('light.kitchen')
    expect(ids).toContain('input_boolean.guest')
    expect(ids).not.toContain('sensor.kitchen_signal')
    expect(ids).not.toContain('switch.bed')
  })
})
