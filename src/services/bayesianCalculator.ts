import type { TimePeriod, EntityProbability, BayesianObservation, BayesianSensorConfig } from '../types/bayesian'
import type { HAHistoryResponse, HAHistoryEntry } from '../types/homeAssistant'
import { analyzeNumericStates, findOptimalNumericThresholds } from '../utils/sensorTimeAnalysis'

export class BayesianCalculator {
  calculateEntityProbabilities(
    history: HAHistoryResponse,
    periods: TimePeriod[]
  ): EntityProbability[] {
    const results: EntityProbability[] = []
    const truePeriods = periods.filter(p => p.isTruePeriod)
    const falsePeriods = periods.filter(p => !p.isTruePeriod)

    if (truePeriods.length === 0 || falsePeriods.length === 0) {
      throw new Error('Need at least one TRUE and one FALSE period')
    }

    for (const [entityId, entityHistory] of Object.entries(history)) {
      const numericStats = analyzeNumericStates(entityHistory, periods)
      
      const stateAnalysis = this.analyzeEntityStates(
        entityHistory,
        truePeriods,
        falsePeriods
      )

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
          totalFalsePeriods: falsePeriods.length,
          numericStats // Store for later use in config generation
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

    const midpoint = new Date((period.start.getTime() + period.end.getTime()) / 2)
    
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
        if (entryTime >= period.start && entryTime <= period.end) {
          relevantState = entry.state
          break
        }
      }
    }

    return relevantState
  }



  generateBayesianConfig(
    entityProbabilities: EntityProbability[],
    sensorName: string,
    maxObservations: number = 10
  ): BayesianSensorConfig {
    const topEntities = entityProbabilities.slice(0, maxObservations)
    
    const observations: BayesianObservation[] = topEntities.map(ep => {
      const isNumeric = !isNaN(parseFloat(ep.state))
      
      if (isNumeric && ep.numericStats?.isNumeric) {
        const stats = ep.numericStats
        
        const optimalThresholds = ep.optimalThresholds || findOptimalNumericThresholds(stats)
        
        const observation: BayesianObservation = {
          entity_id: ep.entityId,
          platform: 'numeric_state',
          prob_given_true: ep.probGivenTrue,
          prob_given_false: ep.probGivenFalse
        }
        
        if (optimalThresholds.above !== undefined) observation.above = optimalThresholds.above
        if (optimalThresholds.below !== undefined) observation.below = optimalThresholds.below
        
        return observation
      } else {
        return {
          entity_id: ep.entityId,
          platform: 'state',
          prob_given_true: ep.probGivenTrue,
          prob_given_false: ep.probGivenFalse,
          to_state: ep.state
        }
      }
    })

    return {
      platform: 'bayesian',
      name: sensorName,
      unique_id: `bayesian_${sensorName.toLowerCase().replace(/\s+/g, '_')}`,
      prior: 0.5,
      probability_threshold: 0.5,
      observations
    }
  }
}