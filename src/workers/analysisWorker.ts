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
  type: 'ANALYSIS_RESULT' | 'ANALYSIS_ERROR'
  id: string
  data?: EntityProbability[]
  error?: string
}

class BayesianCalculatorWorker {
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
      const numericStats = analyzeNumericStates(entityHistory, periods)
      const stateAnalysis = this.analyzeEntityStates(entityHistory, truePeriods, falsePeriods)

      for (const [state, analysis] of Object.entries(stateAnalysis)) {
        const probGivenTrue = analysis.trueOccurrences / truePeriods.length
        const probGivenFalse = analysis.falseOccurrences / falsePeriods.length
        
        const discriminationPower = Math.abs(probGivenTrue - probGivenFalse)

        const optimalThresholds = numericStats.isNumeric ? 
          findOptimalNumericThresholds(numericStats) : 
          undefined

        results.push({
          entityId,
          state,
          probGivenTrue: Math.min(0.99, Math.max(0.01, probGivenTrue)),
          probGivenFalse: Math.min(0.99, Math.max(0.01, probGivenFalse)),
          discriminationPower,
          trueOccurrences: analysis.trueOccurrences,
          falseOccurrences: analysis.falseOccurrences,
          totalTruePeriods: truePeriods.length,
          totalFalsePeriods: falsePeriods.length,
          numericStats,
          optimalThresholds
        })
      }
    }

    return results.sort((a, b) => b.discriminationPower - a.discriminationPower)
  }

  private analyzeEntityStates(
    entityHistory: HAHistoryEntry[],
    truePeriods: TimePeriod[],
    falsePeriods: TimePeriod[]
  ): Record<string, { trueOccurrences: number; falseOccurrences: number }> {
    const stateAnalysis: Record<string, { trueOccurrences: number; falseOccurrences: number }> = {}

    for (const truePeriod of truePeriods) {
      const dominantState = this.getSimpleDominantState(entityHistory, truePeriod)
      
      if (dominantState) {
        if (!stateAnalysis[dominantState]) {
          stateAnalysis[dominantState] = { trueOccurrences: 0, falseOccurrences: 0 }
        }
        stateAnalysis[dominantState].trueOccurrences++
      }
    }

    for (const falsePeriod of falsePeriods) {
      const dominantState = this.getSimpleDominantState(entityHistory, falsePeriod)
      
      if (dominantState) {
        if (!stateAnalysis[dominantState]) {
          stateAnalysis[dominantState] = { trueOccurrences: 0, falseOccurrences: 0 }
        }
        stateAnalysis[dominantState].falseOccurrences++
      }
    }

    return stateAnalysis
  }

  private getSimpleDominantState(
    entityHistory: HAHistoryEntry[],
    period: TimePeriod
  ): string | null {
    if (entityHistory.length === 0) return null

    const periodStart = new Date(period.start)
    const periodEnd = new Date(period.end)
    const midpoint = new Date((periodStart.getTime() + periodEnd.getTime()) / 2)
    
    let relevantState = null
    for (const entry of entityHistory) {
      const entryTime = new Date(entry.last_changed)
      if (entryTime <= midpoint) {
        relevantState = entry.state
      } else {
        break
      }
    }

    if (!relevantState && entityHistory.length > 0) {
      for (const entry of entityHistory) {
        const entryTime = new Date(entry.last_changed)
        if (entryTime >= periodStart && entryTime <= periodEnd) {
          relevantState = entry.state
          break
        }
      }
    }

    return relevantState
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