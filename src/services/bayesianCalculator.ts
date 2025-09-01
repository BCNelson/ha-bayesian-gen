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
      
      // Check if this entity has numeric values
      if (numericStats.isNumeric && numericStats.trueChunks && numericStats.falseChunks) {
        // For numeric entities, calculate optimal thresholds and create a single entry
        const optimalThresholds = findOptimalNumericThresholds(numericStats)
        
        // Calculate probabilities based on optimal thresholds
        const trueMatches = numericStats.trueChunks.filter(chunk => {
          if (optimalThresholds.above !== undefined && optimalThresholds.below !== undefined) {
            return chunk.value > optimalThresholds.above && chunk.value <= optimalThresholds.below
          } else if (optimalThresholds.above !== undefined) {
            return chunk.value > optimalThresholds.above
          } else if (optimalThresholds.below !== undefined) {
            return chunk.value <= optimalThresholds.below
          }
          return false
        })
        
        const falseMatches = numericStats.falseChunks.filter(chunk => {
          if (optimalThresholds.above !== undefined && optimalThresholds.below !== undefined) {
            return chunk.value > optimalThresholds.above && chunk.value <= optimalThresholds.below
          } else if (optimalThresholds.above !== undefined) {
            return chunk.value > optimalThresholds.above
          } else if (optimalThresholds.below !== undefined) {
            return chunk.value <= optimalThresholds.below
          }
          return false
        })
        
        // Calculate time-weighted probabilities
        const trueTotalTime = numericStats.trueChunks.reduce((sum, c) => sum + c.duration, 0)
        const falseTotalTime = numericStats.falseChunks.reduce((sum, c) => sum + c.duration, 0)
        const trueMatchTime = trueMatches.reduce((sum, c) => sum + c.duration, 0)
        const falseMatchTime = falseMatches.reduce((sum, c) => sum + c.duration, 0)
        
        const probGivenTrue = trueTotalTime > 0 ? trueMatchTime / trueTotalTime : 0
        const probGivenFalse = falseTotalTime > 0 ? falseMatchTime / falseTotalTime : 0
        const discriminationPower = Math.abs(probGivenTrue - probGivenFalse)
        
        // Create a descriptive state string for numeric ranges
        let stateDesc = 'numeric'
        if (optimalThresholds.above !== undefined && optimalThresholds.below !== undefined) {
          stateDesc = `${optimalThresholds.above} < value <= ${optimalThresholds.below}`
        } else if (optimalThresholds.above !== undefined) {
          stateDesc = `> ${optimalThresholds.above}`
        } else if (optimalThresholds.below !== undefined) {
          stateDesc = `<= ${optimalThresholds.below}`
        }
        
        results.push({
          entityId,
          state: stateDesc,
          probGivenTrue: Math.min(0.99, Math.max(0.01, probGivenTrue)),
          probGivenFalse: Math.min(0.99, Math.max(0.01, probGivenFalse)),
          discriminationPower,
          trueOccurrences: truePeriods.length,
          falseOccurrences: falsePeriods.length,
          totalTruePeriods: truePeriods.length,
          totalFalsePeriods: falsePeriods.length,
          numericStats,
          optimalThresholds
        })
      } else {
        // For non-numeric entities, use state-based analysis
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
            numericStats: { isNumeric: false }
          })
        }
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
    maxObservations: number = 10,
    skipFiltering: boolean = false
  ): BayesianSensorConfig {
    let topEntities: EntityProbability[]
    
    if (skipFiltering) {
      // User selections - use exactly what they selected
      topEntities = entityProbabilities.slice(0, maxObservations)
    } else {
      // Automatic selection - filter out results with very low discrimination power
      const usefulResults = entityProbabilities.filter(ep => ep.discriminationPower > 0.1)
      topEntities = usefulResults.slice(0, maxObservations)
    }
    
    const observations: BayesianObservation[] = topEntities.map(ep => {
      // Check if this entity has numeric stats and optimal thresholds
      if (ep.numericStats?.isNumeric && ep.optimalThresholds) {
        const observation: BayesianObservation = {
          entity_id: ep.entityId,
          platform: 'numeric_state',
          prob_given_true: ep.probGivenTrue,
          prob_given_false: ep.probGivenFalse
        }
        
        // Add the threshold values
        if (ep.optimalThresholds.above !== undefined) {
          observation.above = Math.round(ep.optimalThresholds.above * 100) / 100 // Round to 2 decimal places
        }
        if (ep.optimalThresholds.below !== undefined) {
          observation.below = Math.round(ep.optimalThresholds.below * 100) / 100 // Round to 2 decimal places
        }
        
        return observation
      } else {
        // Non-numeric entity - use state platform
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