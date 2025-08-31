import type { TimePeriod, EntityProbability } from '../types/bayesian'
import type { HAHistoryResponse, HAHistoryEntry } from '../types/homeAssistant'
import { analyzeNumericStates, findOptimalNumericThresholds } from '../utils/sensorTimeAnalysis'

interface SerializedTimePeriod {
  id: string
  start: string
  end: string
  isTruePeriod: boolean
  label?: string
}

interface WorkerMessage {
  type: 'ANALYZE_ENTITY'
  id: string
  data: {
    entityHistory: HAHistoryResponse
    periods: SerializedTimePeriod[]
  }
}

interface WorkerResponse {
  type: 'ANALYSIS_RESULT' | 'ANALYSIS_ERROR' | 'ANALYSIS_PROGRESS'
  id: string
  data?: EntityProbability[]
  error?: string
  progress?: {
    entityId: string
    status: 'analyzing' | 'completed'
    message?: string
  }
}

interface TimelineEntry {
  time: number
  type: 'state_change' | 'period_start' | 'period_end'
  state?: string
  value?: number
  isTruePeriod?: boolean
}

interface StateSegment {
  start: number
  end: number
  state: string
  value?: number
  isTruePeriod: boolean
}

class BayesianCalculatorWorker {
  private numericThresholdCache = new Map<string, Map<string, number>>()
  calculateEntityProbabilities(
    history: HAHistoryResponse,
    serializedPeriods: SerializedTimePeriod[]
  ): EntityProbability[] {
    const periods: TimePeriod[] = serializedPeriods.map(p => ({
      ...p,
      start: new Date(p.start),
      end: new Date(p.end)
    }))
    const results: EntityProbability[] = []
    const truePeriods = periods.filter(p => p.isTruePeriod)
    const falsePeriods = periods.filter(p => !p.isTruePeriod)

    if (truePeriods.length === 0 || falsePeriods.length === 0) {
      throw new Error('Need at least one TRUE and one FALSE period')
    }

    for (const [entityId, entityHistory] of Object.entries(history)) {
      // Send progress update for entity start
      const progressResponse: WorkerResponse = {
        type: 'ANALYSIS_PROGRESS',
        id: 'progress',
        progress: {
          entityId,
          status: 'analyzing',
          message: 'Starting analysis'
        }
      }
      self.postMessage(progressResponse)
      
      const isNumeric = this.isNumericEntity(entityHistory)
      
      if (isNumeric) {
        const numericStats = analyzeNumericStates(entityHistory, periods)
        const optimalThresholds = this.getCachedOrCalculateThresholds(entityId, numericStats)
        
        const segments = this.createUnifiedTimeline(entityHistory, periods)
        const analysis = this.analyzeNumericSegments(segments)
        
        for (const [state, stats] of Object.entries(analysis)) {
          const probGivenTrue = stats.trueOccurrences / truePeriods.length
          const probGivenFalse = stats.falseOccurrences / falsePeriods.length
          const discriminationPower = Math.abs(probGivenTrue - probGivenFalse)
          
          results.push({
            entityId,
            state,
            probGivenTrue: Math.min(0.99, Math.max(0.01, probGivenTrue)),
            probGivenFalse: Math.min(0.99, Math.max(0.01, probGivenFalse)),
            discriminationPower,
            trueOccurrences: stats.trueOccurrences,
            falseOccurrences: stats.falseOccurrences,
            totalTruePeriods: truePeriods.length,
            totalFalsePeriods: falsePeriods.length,
            numericStats,
            optimalThresholds
          })
        }
      } else {
        const segments = this.createUnifiedTimeline(entityHistory, periods)
        const stateAnalysis = this.analyzeStateSegments(segments)
        
        for (const [state, analysis] of Object.entries(stateAnalysis)) {
          const probGivenTrue = analysis.trueOccurrences / truePeriods.length
          const probGivenFalse = analysis.falseOccurrences / falsePeriods.length
          const discriminationPower = Math.abs(probGivenTrue - probGivenFalse)
          
          results.push({
            entityId,
            state,
            probGivenTrue: Math.min(0.99, Math.max(0.01, probGivenTrue)),
            probGivenFalse: Math.min(0.99, Math.max(0.01, probGivenFalse)),
            discriminationPower,
            trueOccurrences: analysis.trueOccurrences,
            falseOccurrences: analysis.falseOccurrences,
            totalTruePeriods: truePeriods.length,
            totalFalsePeriods: falsePeriods.length
          })
        }
      }
      
      // Send progress update for entity completion
      const completionResponse: WorkerResponse = {
        type: 'ANALYSIS_PROGRESS',
        id: 'progress',
        progress: {
          entityId,
          status: 'completed',
          message: 'Analysis complete'
        }
      }
      self.postMessage(completionResponse)
    }

    return results.sort((a, b) => b.discriminationPower - a.discriminationPower)
  }

  private isNumericEntity(entityHistory: HAHistoryEntry[]): boolean {
    if (entityHistory.length === 0) return false
    
    const sampleSize = Math.min(10, entityHistory.length)
    let numericCount = 0
    
    for (let i = 0; i < sampleSize; i++) {
      const state = entityHistory[i].state
      if (!isNaN(parseFloat(state)) && state !== 'unavailable' && state !== 'unknown') {
        numericCount++
      }
    }
    
    return numericCount >= sampleSize * 0.7
  }

  private createUnifiedTimeline(
    entityHistory: HAHistoryEntry[],
    periods: TimePeriod[]
  ): StateSegment[] {
    const timeline: TimelineEntry[] = []
    
    for (const entry of entityHistory) {
      const time = new Date(entry.last_changed).getTime()
      const value = parseFloat(entry.state)
      timeline.push({
        time,
        type: 'state_change',
        state: entry.state,
        value: isNaN(value) ? undefined : value
      })
    }
    
    for (const period of periods) {
      timeline.push({
        time: new Date(period.start).getTime(),
        type: 'period_start',
        isTruePeriod: period.isTruePeriod
      })
      timeline.push({
        time: new Date(period.end).getTime(),
        type: 'period_end',
        isTruePeriod: period.isTruePeriod
      })
    }
    
    timeline.sort((a, b) => a.time - b.time)
    
    const segments: StateSegment[] = []
    let currentState: string | undefined
    let currentValue: number | undefined
    let currentPeriods: Set<boolean> = new Set()
    
    for (let i = 0; i < timeline.length; i++) {
      const entry = timeline[i]
      const nextEntry = timeline[i + 1]
      
      if (entry.type === 'state_change') {
        currentState = entry.state
        currentValue = entry.value
      } else if (entry.type === 'period_start') {
        currentPeriods.add(entry.isTruePeriod!)
      } else if (entry.type === 'period_end') {
        currentPeriods.delete(entry.isTruePeriod!)
      }
      
      if (currentState && currentPeriods.size > 0 && nextEntry) {
        const isTruePeriod = currentPeriods.has(true)
        segments.push({
          start: entry.time,
          end: nextEntry.time,
          state: currentState,
          value: currentValue,
          isTruePeriod
        })
      }
    }
    
    return segments
  }

  private analyzeStateSegments(
    segments: StateSegment[]
  ): Record<string, { trueOccurrences: number; falseOccurrences: number }> {
    const stateAnalysis: Record<string, { trueOccurrences: number; falseOccurrences: number }> = {}
    const seenInTruePeriod = new Set<string>()
    const seenInFalsePeriod = new Set<string>()
    
    for (const segment of segments) {
      const duration = segment.end - segment.start
      if (duration < 1000) continue
      
      if (!stateAnalysis[segment.state]) {
        stateAnalysis[segment.state] = { trueOccurrences: 0, falseOccurrences: 0 }
      }
      
      // Track state per period (true/false), not per segment
      const stateKey = segment.state
      
      if (segment.isTruePeriod && !seenInTruePeriod.has(stateKey)) {
        stateAnalysis[segment.state].trueOccurrences++
        seenInTruePeriod.add(stateKey)
      } else if (!segment.isTruePeriod && !seenInFalsePeriod.has(stateKey)) {
        stateAnalysis[segment.state].falseOccurrences++
        seenInFalsePeriod.add(stateKey)
      }
    }
    
    return stateAnalysis
  }

  private analyzeNumericSegments(
    segments: StateSegment[]
  ): Record<string, { trueOccurrences: number; falseOccurrences: number }> {
    const stateAnalysis: Record<string, { trueOccurrences: number; falseOccurrences: number }> = {}
    
    const trueValues: number[] = []
    const falseValues: number[] = []
    
    for (const segment of segments) {
      if (segment.value !== undefined) {
        if (segment.isTruePeriod) {
          trueValues.push(segment.value)
        } else {
          falseValues.push(segment.value)
        }
      }
    }
    
    const trueMean = trueValues.length > 0 ? 
      trueValues.reduce((a, b) => a + b, 0) / trueValues.length : 0
    const falseMean = falseValues.length > 0 ? 
      falseValues.reduce((a, b) => a + b, 0) / falseValues.length : 0
      
    const state = `mean_true: ${trueMean.toFixed(2)}, mean_false: ${falseMean.toFixed(2)}`
    stateAnalysis[state] = {
      trueOccurrences: trueValues.length,
      falseOccurrences: falseValues.length
    }
    
    return stateAnalysis
  }

  private getCachedOrCalculateThresholds(
    entityId: string,
    numericStats: any
  ): { above?: number; below?: number } | undefined {
    if (!numericStats.isNumeric) return undefined
    
    const cacheKey = this.getNumericStatsCacheKey(numericStats)
    
    if (!this.numericThresholdCache.has(entityId)) {
      this.numericThresholdCache.set(entityId, new Map())
    }
    
    const entityCache = this.numericThresholdCache.get(entityId)!
    
    if (entityCache.has(cacheKey)) {
      const cached = entityCache.get(cacheKey)!
      return {
        above: cached > 0 ? cached : undefined,
        below: cached < 0 ? Math.abs(cached) : undefined
      }
    }
    
    const thresholds = findOptimalNumericThresholds(numericStats)
    
    const cacheValue = thresholds.above !== undefined ? 
      thresholds.above : 
      (thresholds.below !== undefined ? -thresholds.below : 0)
    
    entityCache.set(cacheKey, cacheValue)
    
    return thresholds
  }

  private getNumericStatsCacheKey(stats: any): string {
    if (!stats.trueChunks || !stats.falseChunks) return 'empty'
    
    const trueKey = stats.trueChunks
      .map((c: any) => `${c.value.toFixed(2)}-${c.duration}`)
      .slice(0, 5)
      .join(',')
    const falseKey = stats.falseChunks
      .map((c: any) => `${c.value.toFixed(2)}-${c.duration}`)
      .slice(0, 5)
      .join(',')
    
    return `${trueKey}|${falseKey}`
  }

}

const calculator = new BayesianCalculatorWorker()

self.onmessage = function(e: MessageEvent<WorkerMessage>) {
  const { type, data, id } = e.data

  try {
    if (type === 'ANALYZE_ENTITY') {
      const { entityHistory, periods } = data
      const result = calculator.calculateEntityProbabilities(entityHistory, periods)
      
      const response: WorkerResponse = {
        type: 'ANALYSIS_RESULT',
        id,
        data: result
      }
      
      self.postMessage(response)
    }
  } catch (error) {
    const errorResponse: WorkerResponse = {
      type: 'ANALYSIS_ERROR',
      id,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
    
    self.postMessage(errorResponse)
  }
}