import type { BayesianObservation } from '../types/bayesian'

export interface HistoryPoint {
  timestamp: Date
  state: string
}

export interface SimulationPoint {
  timestamp: Date
  probability: number
  sensorState: boolean
  activeObservations: string[]
}

export interface CompressedHistoryPoint {
  t: number // timestamp in minutes since start
  s: string // state
}

export interface SimulationSummary {
  points: SimulationPoint[]
  statistics: {
    avgProbability: number
    maxProbability: number
    minProbability: number
    onTime: number // milliseconds
    onPercentage: number
    triggerCount: number
  }
  onPeriods: Array<{ start: Date; end: Date }>
}

export class CachedBayesianSimulator {
  private prior: number
  private threshold: number
  private observations: BayesianObservation[]
  private compressedData: Map<string, CompressedHistoryPoint[]>
  private startTime: Date
  private endTime: Date

  constructor(
    prior: number,
    threshold: number,
    observations: BayesianObservation[],
    cachedData: Map<string, any[]>,
    periods: { start: Date; end: Date }
  ) {
    this.prior = prior
    this.threshold = threshold
    this.observations = observations
    this.startTime = periods.start
    this.endTime = periods.end
    
    // Compress historical data for memory efficiency
    this.compressedData = this.compressHistoricalData(cachedData)
  }

  /**
   * Process historical data to keep only what's needed for simulation
   */
  private compressHistoricalData(
    cachedData: Map<string, any[]>
  ): Map<string, CompressedHistoryPoint[]> {
    const processed = new Map<string, CompressedHistoryPoint[]>()
    const startTimeMs = this.startTime.getTime()

    for (const [entityId, history] of cachedData.entries()) {
      if (!history || history.length === 0) continue

      const processedHistory: CompressedHistoryPoint[] = []
      let lastState = ''

      for (const entry of history) {
        const timestamp = new Date(entry.last_changed).getTime()
        const minutesSinceStart = Math.floor((timestamp - startTimeMs) / (1000 * 60))
        
        // Only store state changes to save memory
        if (entry.state !== lastState) {
          processedHistory.push({
            t: minutesSinceStart,
            s: entry.state
          })
          lastState = entry.state
        }
      }

      if (processedHistory.length > 0) {
        processed.set(entityId, processedHistory)
      }
    }

    return processed
  }

  /**
   * Get state at specific time using compressed data
   */
  private getStateAtTime(entityId: string, targetTime: Date): string | null {
    const history = this.compressedData.get(entityId)
    if (!history || history.length === 0) return null

    const targetMinutes = Math.floor((targetTime.getTime() - this.startTime.getTime()) / (1000 * 60))
    
    // Find the last state before or at target time
    let lastState: string | null = null
    for (const point of history) {
      if (point.t <= targetMinutes) {
        lastState = point.s
      } else {
        break
      }
    }

    return lastState
  }

  /**
   * Evaluate observations at a specific time
   */
  private evaluateObservationsAtTime(targetTime: Date): Map<string, boolean> {
    const observationStates = new Map<string, boolean>()

    for (const obs of this.observations) {
      // Skip entities that don't have cached data yet
      if (!this.compressedData.has(obs.entity_id)) {
        continue
      }
      
      const state = this.getStateAtTime(obs.entity_id, targetTime)
      if (state === null) {
        observationStates.set(obs.entity_id, false)
        continue
      }

      let isActive = false

      if (obs.platform === 'state' && obs.to_state) {
        isActive = state === obs.to_state
      } else if (obs.platform === 'numeric_state') {
        const numValue = parseFloat(state)
        if (!isNaN(numValue)) {
          isActive = true
          if (obs.above !== undefined) {
            isActive = isActive && numValue > obs.above
          }
          if (obs.below !== undefined) {
            isActive = isActive && numValue < obs.below
          }
        }
      }

      observationStates.set(obs.entity_id, isActive)
    }

    return observationStates
  }

  /**
   * Calculate Bayesian probability using Home Assistant's formula
   */
  private updateProbability(
    prior: number,
    probGivenTrue: number,
    probGivenFalse: number
  ): number {
    const numerator = probGivenTrue * prior
    const denominator = numerator + probGivenFalse * (1 - prior)
    return denominator === 0 ? prior : numerator / denominator
  }

  /**
   * Calculate probability based on observation states
   */
  private calculateProbability(observationStates: Map<string, boolean>): number {
    let probability = this.prior

    for (const obs of this.observations) {
      const isActive = observationStates.get(obs.entity_id)
      
      // Skip observations that don't have data yet (not in the map)
      if (isActive === undefined) {
        continue
      }
      
      if (isActive === true) {
        // Observation is true/active
        probability = this.updateProbability(
          probability,
          obs.prob_given_true,
          obs.prob_given_false
        )
      } else if (isActive === false) {
        // Observation is false/inactive
        probability = this.updateProbability(
          probability,
          1 - obs.prob_given_true,
          1 - obs.prob_given_false
        )
      }
      // If isActive is undefined/null, skip this observation
    }

    return probability
  }

  /**
   * Run simulation over the cached time period
   */
  simulate(sampleIntervalMinutes: number = 5): SimulationSummary {
    const points: SimulationPoint[] = []
    const currentTime = new Date(this.startTime)
    const intervalMs = sampleIntervalMinutes * 60 * 1000

    while (currentTime <= this.endTime) {
      // Evaluate observations at this time
      const observationStates = this.evaluateObservationsAtTime(currentTime)
      
      // Calculate probability
      const probability = this.calculateProbability(observationStates)
      const sensorState = probability >= this.threshold
      
      // Get active observations
      const activeObservations = Array.from(observationStates.entries())
        .filter(([_, isActive]) => isActive)
        .map(([entityId, _]) => entityId)

      points.push({
        timestamp: new Date(currentTime),
        probability,
        sensorState,
        activeObservations
      })

      // Move to next sample
      currentTime.setTime(currentTime.getTime() + intervalMs)
    }

    // Calculate statistics and ON periods
    const statistics = this.calculateStatistics(points)
    const onPeriods = this.calculateOnPeriods(points)

    return {
      points,
      statistics,
      onPeriods
    }
  }

  /**
   * Calculate simulation statistics
   */
  private calculateStatistics(points: SimulationPoint[]): {
    avgProbability: number
    maxProbability: number
    minProbability: number
    onTime: number
    onPercentage: number
    triggerCount: number
  } {
    if (points.length === 0) {
      return {
        avgProbability: 0,
        maxProbability: 0,
        minProbability: 0,
        onTime: 0,
        onPercentage: 0,
        triggerCount: 0
      }
    }

    const probabilities = points.map(p => p.probability)
    const avgProbability = probabilities.reduce((a, b) => a + b, 0) / probabilities.length
    const maxProbability = Math.max(...probabilities)
    const minProbability = Math.min(...probabilities)

    // Calculate ON time
    let onTime = 0
    let triggerCount = 0
    let wasOn = false

    for (const point of points) {
      if (point.sensorState && !wasOn) {
        triggerCount++
      }
      wasOn = point.sensorState
    }

    // Estimate ON time based on sample intervals
    const sampleInterval = points.length > 1 
      ? points[1].timestamp.getTime() - points[0].timestamp.getTime()
      : 5 * 60 * 1000 // 5 minutes default

    onTime = points.filter(p => p.sensorState).length * sampleInterval
    const totalTime = this.endTime.getTime() - this.startTime.getTime()
    const onPercentage = (onTime / totalTime) * 100

    return {
      avgProbability,
      maxProbability,
      minProbability,
      onTime,
      onPercentage,
      triggerCount
    }
  }

  /**
   * Calculate periods when sensor was ON
   */
  private calculateOnPeriods(points: SimulationPoint[]): Array<{ start: Date; end: Date }> {
    const periods: Array<{ start: Date; end: Date }> = []
    let currentPeriodStart: Date | null = null

    for (let i = 0; i < points.length; i++) {
      const point = points[i]
      const wasOn = i > 0 && points[i - 1].sensorState

      if (point.sensorState && !wasOn) {
        // Sensor turned ON
        currentPeriodStart = point.timestamp
      } else if (!point.sensorState && wasOn && currentPeriodStart) {
        // Sensor turned OFF
        periods.push({
          start: currentPeriodStart,
          end: point.timestamp
        })
        currentPeriodStart = null
      }
    }

    // If sensor is still ON at the end
    if (currentPeriodStart && points.length > 0 && points[points.length - 1].sensorState) {
      periods.push({
        start: currentPeriodStart,
        end: points[points.length - 1].timestamp
      })
    }

    return periods
  }

  /**
   * Get memory usage information
   */
  getMemoryUsage(): {
    originalDataPoints: number
    compressedDataPoints: number
    compressionRatio: number
  } {
    let originalPoints = 0
    let compressedPoints = 0

    for (const [_, history] of this.compressedData.entries()) {
      compressedPoints += history.length
      // Estimate original points (assuming 1 point per minute on average)
      const durationMinutes = (this.endTime.getTime() - this.startTime.getTime()) / (1000 * 60)
      originalPoints += Math.floor(durationMinutes)
    }

    const compressionRatio = originalPoints > 0 ? compressedPoints / originalPoints : 1

    return {
      originalDataPoints: originalPoints,
      compressedDataPoints: compressedPoints,
      compressionRatio
    }
  }
}