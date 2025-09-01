import type { HAEntity, HAHistoryResponse } from '../types/homeAssistant'
import type { TimePeriod, EntityProbability } from '../types/bayesian'

interface IHomeAssistantAPI {
  testConnection(): Promise<boolean>
  getStates(): Promise<HAEntity[]>
  getHistory(startTime: Date, endTime?: Date, entityIds?: string[]): Promise<HAHistoryResponse>
}
import { WorkerPool } from './workerPool'
import { EntityFetcher } from './entityFetcher'

export interface AnalysisProgress {
  current: number
  total: number
  currentEntity: string
}

export interface EntityStatus {
  status: 'queued' | 'fetching' | 'fetched' | 'analyzing' | 'completed' | 'error'
  message?: string
}

export interface AnalysisCallbacks {
  onProgress?: (progress: AnalysisProgress) => void
  onEntityStatus?: (entityId: string, status: EntityStatus) => void
  onResult?: (results: EntityProbability[]) => void
  onEntityFetched?: (entityId: string, history: any[]) => void
}

export class AnalysisOrchestrator {
  private workerPool: WorkerPool
  private entityFetcher: EntityFetcher
  private callbacks: AnalysisCallbacks = {}

  constructor() {
    this.workerPool = new WorkerPool()
    this.entityFetcher = new EntityFetcher()
    
    // Set up worker progress callback
    this.workerPool.setProgressCallback((entityId, status, message) => {
      this.callbacks.onEntityStatus?.(entityId, { status: status as any, message })
    })
  }

  setCallbacks(callbacks: AnalysisCallbacks) {
    this.callbacks = callbacks
  }

  async analyzeEntities(
    haApi: IHomeAssistantAPI,
    entities: HAEntity[],
    periods: TimePeriod[],
    selectedEntityIds?: string[]
  ): Promise<EntityProbability[]> {
    const relevantEntityIds = this.getRelevantEntityIds(entities, selectedEntityIds)
    const allResults: EntityProbability[] = []
    let completedCount = 0
    
    this.initializeProgress(relevantEntityIds)
    
    // Set up entity fetcher
    this.entityFetcher.setApi(haApi)
    this.entityFetcher.setTimeRange(periods)
    this.entityFetcher.setProgressCallback((entityId, status, message) => {
      this.callbacks.onEntityStatus?.(entityId, { status, message })
    })

    // Process entities with immediate result display
    const fetchQueue = [...relevantEntityIds]
    const maxConcurrentFetches = 2
    let activeFetches = 0

    await new Promise<void>((resolve) => {
      const checkCompletion = () => {
        if (fetchQueue.length === 0 && activeFetches === 0) {
          resolve()
        }
      }

      const processNextEntity = () => {
        while (activeFetches < maxConcurrentFetches && fetchQueue.length > 0) {
          const entityId = fetchQueue.shift()!
          activeFetches++
          this.processSingleEntity(entityId, periods, (results) => {
            // Accumulate results for return value
            allResults.push(...results)
            
            // Pass individual results to callback for immediate display
            if (results.length > 0) {
              this.callbacks.onResult?.(results)
            }
            
            completedCount++
            this.updateProgress(completedCount, relevantEntityIds.length)
            
            activeFetches--
            processNextEntity()
            checkCompletion()
          })
        }
      }

      processNextEntity()
    })

    return allResults
  }

  private async processSingleEntity(
    entityId: string,
    periods: TimePeriod[],
    onComplete: (results: EntityProbability[]) => void
  ): Promise<void> {
    try {
      // Fetch entity history
      const histories = await this.entityFetcher.fetchEntities([entityId])
      if (histories.length === 0) {
        onComplete([])
        return
      }
      
      const { history } = histories[0]
      
      // Cache the fetched data immediately for simulation
      this.callbacks.onEntityFetched?.(entityId, history[entityId] || [])
      
      // Analyze immediately after fetch
      const results = await this.analyzeEntity(entityId, history, periods)
      
      // Call completion callback with results
      onComplete(results)
    } catch (error) {
      console.warn(`Failed to process entity ${entityId}:`, error)
      onComplete([])
    }
  }

  private async analyzeEntity(
    entityId: string,
    history: HAHistoryResponse,
    periods: TimePeriod[]
  ): Promise<EntityProbability[]> {
    this.callbacks.onEntityStatus?.(entityId, { 
      status: 'analyzing', 
      message: 'Analyzing states...' 
    })

    const serializedPeriods = periods.map(p => ({
      ...p,
      start: p.start.toISOString(),
      end: p.end.toISOString()
    }))

    try {
      const results = await this.workerPool.analyzeEntity(history, serializedPeriods)
      
      this.callbacks.onEntityStatus?.(entityId, { 
        status: 'completed', 
        message: 'Analysis complete' 
      })
      
      return Array.isArray(results) ? results : []
    } catch (error) {
      this.callbacks.onEntityStatus?.(entityId, { 
        status: 'error', 
        message: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      })
      return []
    }
  }

  private getRelevantEntityIds(entities: HAEntity[], selectedEntityIds?: string[]): string[] {
    if (selectedEntityIds && selectedEntityIds.length > 0) {
      return selectedEntityIds
    }

    return entities
      .filter(entity => {
        const domain = entity.entity_id.split('.')[0]
        const excludedDomains = [
          'automation', 'script', 'scene', 'group', 'zone', 
          'update', 'button', 'persistent_notification'
        ]
        return !excludedDomains.includes(domain) &&
               entity.state !== 'unavailable' &&
               entity.state !== 'unknown' &&
               entity.state !== ''
      })
      .map(entity => entity.entity_id)
  }

  private initializeProgress(entityIds: string[]) {
    entityIds.forEach(entityId => {
      this.callbacks.onEntityStatus?.(entityId, { status: 'queued' })
    })
    
    this.callbacks.onProgress?.({
      current: 0,
      total: entityIds.length,
      currentEntity: ''
    })
  }

  private updateProgress(current: number, total: number, currentEntity = '') {
    this.callbacks.onProgress?.({
      current,
      total,
      currentEntity
    })
  }

  terminate() {
    this.workerPool.terminate()
    this.entityFetcher.cleanup()
  }
}