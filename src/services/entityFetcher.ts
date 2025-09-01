import type { HAHistoryResponse } from '../types/homeAssistant'
import type { TimePeriod } from '../types/bayesian'
interface IHomeAssistantAPI {
  getHistory(startTime: Date, endTime?: Date, entityIds?: string[]): Promise<HAHistoryResponse>
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

export class EntityFetcher {
  private haApi: IHomeAssistantAPI | null = null
  private earliestStart: Date | null = null
  private latestEnd: Date | null = null
  private progressCallback?: (entityId: string, status: FetchProgress['status'], message?: string) => void
  private concurrentLimit = 2

  setApi(haApi: IHomeAssistantAPI) {
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

    const results: FetchedEntity[] = []
    const semaphore = new Semaphore(this.concurrentLimit)

    const fetchPromises = entityIds.map(async (entityId) => {
      await semaphore.acquire()
      try {
        return await this.fetchSingleEntity(entityId)
      } finally {
        semaphore.release()
      }
    })

    const settledResults = await Promise.allSettled(fetchPromises)
    
    for (const result of settledResults) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value)
      }
    }

    return results
  }

  private async fetchSingleEntity(entityId: string): Promise<FetchedEntity | null> {
    try {
      this.progressCallback?.(entityId, 'fetching', 'Fetching history...')

      const rawHistory = await this.haApi!.getHistory(
        this.earliestStart!,
        this.latestEnd!,
        [entityId]
      )

      // Deep clone to avoid reference issues
      const history = JSON.parse(JSON.stringify(rawHistory))
      
      this.progressCallback?.(entityId, 'fetched', 'History fetched')
      
      return { entityId, history }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fetch failed'
      this.progressCallback?.(entityId, 'error', message)
      console.warn(`Failed to fetch entity ${entityId}:`, error)
      return null
    }
  }

  cleanup() {
    this.haApi = null
    this.earliestStart = null
    this.latestEnd = null
    this.progressCallback = undefined
  }
}

class Semaphore {
  private permits: number
  private waitQueue: (() => void)[] = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--
        resolve()
      } else {
        this.waitQueue.push(resolve)
      }
    })
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const nextResolve = this.waitQueue.shift()!
      nextResolve()
    } else {
      this.permits++
    }
  }
}