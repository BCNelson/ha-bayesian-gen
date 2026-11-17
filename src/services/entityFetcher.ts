import type { HAHistoryResponse } from '../types/homeAssistant'
import type { TimePeriod } from '../types/bayesian'

export interface IHomeAssistantHistoryApi {
  getHistory(startTime: Date, endTime: Date | undefined, entityIds: string[]): Promise<HAHistoryResponse>
}

export interface FetchedEntity {
  entityId: string
  history: HAHistoryResponse
}

export interface FetchProgress {
  entityId: string
  status: 'queued' | 'fetching' | 'fetched' | 'error'
  message?: string
}

/**
 * Fetches entity histories for the analysis time range. A call to
 * `fetchEntities` issues a single batched history request (the client splits
 * very large batches into several websocket messages) and returns one
 * `FetchedEntity` per requested id that has history.
 */
export class EntityFetcher {
  private haApi: IHomeAssistantHistoryApi | null = null
  private earliestStart: Date | null = null
  private latestEnd: Date | null = null
  private progressCallback?: (entityId: string, status: FetchProgress['status'], message?: string) => void

  setApi(haApi: IHomeAssistantHistoryApi) {
    this.haApi = haApi
  }

  setTimeRange(periods: TimePeriod[]) {
    this.earliestStart = new Date(Math.min(...periods.map(p => p.start.getTime())))
    this.latestEnd = new Date(Math.max(...periods.map(p => p.end.getTime())))
  }

  setProgressCallback(callback: (entityId: string, status: FetchProgress['status'], message?: string) => void) {
    this.progressCallback = callback
  }

  async fetchEntities(entityIds: string[]): Promise<FetchedEntity[]> {
    if (!this.haApi || !this.earliestStart || !this.latestEnd) {
      throw new Error('EntityFetcher not properly configured')
    }
    if (entityIds.length === 0) return []

    entityIds.forEach(id => this.progressCallback?.(id, 'fetching', 'Fetching history...'))

    let history: HAHistoryResponse
    try {
      history = await this.haApi.getHistory(this.earliestStart, this.latestEnd, entityIds)
    } catch (error) {
      const message = error instanceof Error ? error.message : (error as any)?.message ?? 'Fetch failed'
      console.warn(`Failed to fetch history for ${entityIds.length} entities:`, error)
      entityIds.forEach(id => this.progressCallback?.(id, 'error', message))
      return []
    }

    const results: FetchedEntity[] = []
    for (const entityId of entityIds) {
      const entries = history[entityId]
      if (!entries || entries.length === 0) {
        this.progressCallback?.(entityId, 'error', 'No history in the selected range')
        continue
      }
      this.progressCallback?.(entityId, 'fetched', 'History fetched')
      results.push({ entityId, history: { [entityId]: entries } })
    }
    return results
  }

  cleanup() {
    this.haApi = null
    this.earliestStart = null
    this.latestEnd = null
    this.progressCallback = undefined
  }
}
