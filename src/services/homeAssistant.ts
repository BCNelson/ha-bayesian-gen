/**
 * Home Assistant client over the WebSocket API (home-assistant-js-websocket).
 */
import {
  createConnection,
  getStates as wsGetStates,
  type Auth,
  type Connection
} from 'home-assistant-js-websocket'
import type {
  HAEntity,
  HAHistoryResponse,
  HARegistries,
  HAEntityRegistryEntry,
  HADeviceRegistryEntry,
  HAAreaRegistryEntry,
  HAFloorRegistryEntry,
  HALabelRegistryEntry
} from '../types/homeAssistant'
import { chunk, convertCompressedHistory, type HACompressedHistoryResponse } from './haHistoryFormat'
import { fillHistoryGapsWithStatistics, findHistoryGaps, type HAMessageSender } from './haStatistics'

/** Max entity_ids per history/history_during_period message */
const HISTORY_BATCH_SIZE = 25

export interface GetHistoryOptions {
  /** Fill missing (purged) history of numeric sensors from long-term statistics. Default true. */
  statisticsFallback?: boolean
}

export class HomeAssistantClient {
  /** Entities that have long-term statistics (state_class attribute present). */
  private statisticsEligible = new Set<string>()
  private readonly conn: Connection & HAMessageSender
  readonly auth?: Auth

  constructor(connection: Connection, auth?: Auth) {
    this.conn = connection as Connection & HAMessageSender
    this.auth = auth
  }

  static async connect(auth: Auth): Promise<HomeAssistantClient> {
    const connection = await createConnection({ auth })
    return new HomeAssistantClient(connection, auth)
  }

  get hassUrl(): string | undefined {
    return this.auth?.data.hassUrl
  }

  get haVersion(): string {
    return this.conn.haVersion
  }

  async getStates(): Promise<HAEntity[]> {
    const states = await wsGetStates(this.conn)
    this.statisticsEligible = new Set(
      states.filter(s => s.attributes?.state_class !== undefined).map(s => s.entity_id)
    )
    return states.map(s => ({
      entity_id: s.entity_id,
      state: s.state,
      last_changed: s.last_changed,
      last_updated: s.last_updated,
      attributes: s.attributes ?? {}
    }))
  }

  /**
   * Fetch the entity/device/area/floor/label registries. Each is fetched
   * independently; a failure (e.g. an older HA without floors/labels) yields [].
   */
  async getRegistries(): Promise<HARegistries> {
    const list = async <T>(type: string): Promise<T[]> => {
      try {
        return (await this.conn.sendMessagePromise<T[]>({ type })) ?? []
      } catch (error) {
        console.warn(`Registry ${type} unavailable:`, error)
        return []
      }
    }
    const [entities, devices, areas, floors, labels] = await Promise.all([
      list<HAEntityRegistryEntry>('config/entity_registry/list'),
      list<HADeviceRegistryEntry>('config/device_registry/list'),
      list<HAAreaRegistryEntry>('config/area_registry/list'),
      list<HAFloorRegistryEntry>('config/floor_registry/list'),
      list<HALabelRegistryEntry>('config/label_registry/list')
    ])
    return { entities, devices, areas, floors, labels }
  }

  /**
   * Fetch state history for `entityIds` via `history/history_during_period`,
   * batching ids per message, and convert to `HAHistoryResponse`.
   */
  async getHistory(
    startTime: Date,
    endTime: Date | undefined,
    entityIds: string[],
    options: GetHistoryOptions = {}
  ): Promise<HAHistoryResponse> {
    if (!entityIds || entityIds.length === 0) return {}

    const batches = await Promise.all(
      chunk(entityIds, HISTORY_BATCH_SIZE).map(ids =>
        this.conn.sendMessagePromise<HACompressedHistoryResponse>({
          type: 'history/history_during_period',
          start_time: startTime.toISOString(),
          ...(endTime ? { end_time: endTime.toISOString() } : {}),
          entity_ids: ids,
          include_start_time_state: true,
          significant_changes_only: false,
          minimal_response: true,
          no_attributes: true
        })
      )
    )
    const history: HAHistoryResponse = {}
    for (const raw of batches) Object.assign(history, convertCompressedHistory(raw))

    if (options.statisticsFallback !== false) {
      const gaps = findHistoryGaps(history, entityIds, this.statisticsEligible, startTime, endTime ?? new Date())
      await fillHistoryGapsWithStatistics(this.conn, history, gaps, 'hour')
    }
    return history
  }

  async getConfig() {
    return this.conn.sendMessagePromise<Record<string, any>>({ type: 'get_config' })
  }

  close() {
    this.conn.close()
  }
}
