import type { HAEntity, HAHistoryResponse } from '../types/homeAssistant'
import type { TimePeriod, EntityProbability } from '../types/bayesian'

interface IHomeAssistantAPI {
  testConnection(): Promise<boolean>
  getStates(): Promise<HAEntity[]>
  getHistory(startTime: Date, endTime?: Date, entityIds?: string[]): Promise<HAHistoryResponse>
}
import { WorkerPool } from './workerPool'
import { EntityFetcher } from './entityFetcher'
import { EntityScorer, type EntityScore } from './entityScorer'

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
  onEntityScored?: (scores: Map<string, EntityScore>) => void
}

export class AnalysisOrchestrator {
  private workerPool: WorkerPool
  private entityFetcher: EntityFetcher
  private entityScorer: EntityScorer
  private callbacks: AnalysisCallbacks = {}

  constructor() {
    this.workerPool = new WorkerPool()
    this.entityFetcher = new EntityFetcher()
    this.entityScorer = new EntityScorer()
    
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
    const relevantEntityIds = this.getScoredAndSortedEntityIds(entities, selectedEntityIds)
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

  private getScoredAndSortedEntityIds(entities: HAEntity[], selectedEntityIds?: string[]): string[] {
    const sortedIds = this.entityScorer.filterAndSortEntities(entities, selectedEntityIds)
    
    const scores = this.entityScorer.getScoresForEntities(
      entities.filter(e => sortedIds.includes(e.entity_id))
    )
    this.callbacks.onEntityScored?.(scores)
    
    console.log(`Scored and sorted ${sortedIds.length} entities for analysis`)
    if (sortedIds.length > 0) {
      const topScores = Array.from(scores.values()).slice(0, 5)
      console.log('Top 5 entities by score:')
      topScores.forEach(score => {
        console.log(`  ${score.entityId}: ${score.score} (${score.reasons.join(', ')})`)
      })
    }
    
    return sortedIds
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