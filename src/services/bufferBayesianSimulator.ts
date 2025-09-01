import type { BayesianObservation } from '../types/bayesian'
import type { EntityBufferMetadata } from './entityBuffer'

export interface BufferHistoryPoint {
  timestamp: Date
  state: string
}

export interface SimulationPoint {
  timestamp: Date
  probability: number
  sensorState: boolean
  activeObservations: string[]
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

interface BufferEntityData {
  buffer: ArrayBuffer
  view: DataView
  pointCount: number
  stateMap: Map<number, string> // Reverse of encoding map
}

/**
 * BufferBayesianSimulator - Processes binary buffer data for simulation
 * 
 * Designed for maximum performance with pre-compressed entity buffers
 */
export class BufferBayesianSimulator {
  private prior: number
  private threshold: number
  private observations: BayesianObservation[]
  private entityData: Map<string, BufferEntityData>
  private startTime: Date
  private endTime: Date
  private debugCount = 0

  constructor(
    prior: number,
    threshold: number,
    observations: BayesianObservation[],
    buffers: ArrayBuffer[],
    metadata: EntityBufferMetadata[],
    timeRange: { start: Date; end: Date }
  ) {
    this.prior = prior
    this.threshold = threshold
    this.observations = observations
    this.startTime = timeRange.start
    this.endTime = timeRange.end
    
    this.entityData = new Map()
    
    // Process buffers and metadata
    for (let i = 0; i < buffers.length && i < metadata.length; i++) {
      const buffer = buffers[i]
      const meta = metadata[i]
      
      // Create reverse state mapping (number → string)
      const stateMap = new Map<number, string>()
      for (const [state, id] of Object.entries(meta.stateMap)) {
        stateMap.set(id, state)
      }
      
      this.entityData.set(meta.entityId, {
        buffer,
        view: new DataView(buffer),
        pointCount: meta.pointCount,
        stateMap
      })
    }
  }

  /**
   * Get state at specific time using binary buffer data
   */
  private getStateAtTime(entityId: string, targetTime: Date): string | null {
    const entityData = this.entityData.get(entityId)
    if (!entityData) return null

    const targetTimeSeconds = Math.floor(targetTime.getTime() / 1000)
    
    // Binary search through time-sorted buffer data
    let lastStateId: number | null = null
    let left = 0
    let right = entityData.pointCount - 1

    // Find the last entry before or at target time
    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const offset = mid * 8 // 8 bytes per point
      
      const entryTimeSeconds = entityData.view.getUint32(offset, true)
      
      if (entryTimeSeconds <= targetTimeSeconds) {
        lastStateId = entityData.view.getUint32(offset + 4, true)
        left = mid + 1
      } else {
        right = mid - 1
      }
    }

    return lastStateId !== null ? entityData.stateMap.get(lastStateId) || null : null
  }

  /**
   * Evaluate observations at a specific time
   */
  private evaluateObservationsAtTime(targetTime: Date): Map<string, boolean> {
    const observationStates = new Map<string, boolean>()

    for (const obs of this.observations) {
      if (!this.entityData.has(obs.entity_id)) {
        if (this.debugCount < 2) {
          console.log(`❌ ${obs.entity_id}: no entity data`)
          this.debugCount++
        }
        continue
      }
      
      const state = this.getStateAtTime(obs.entity_id, targetTime)
      if (state === null) {
        if (this.debugCount < 2) {
          console.log(`❌ ${obs.entity_id}: no state at time`)
          this.debugCount++
        }
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
          
          if (this.debugCount < 2) {
            console.log(`${obs.entity_id}: state=${state}, above=${obs.above}, below=${obs.below}, active=${isActive}`)
            this.debugCount++
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
    let debugCount = 0

    for (const obs of this.observations) {
      const isActive = observationStates.get(obs.entity_id)
      
      if (isActive === undefined) {
        continue
      }
      
      const oldProbability = probability
      
      if (isActive === true) {
        probability = this.updateProbability(
          probability,
          obs.prob_given_true,
          obs.prob_given_false
        )
      } else if (isActive === false) {
        probability = this.updateProbability(
          probability,
          1 - obs.prob_given_true,
          1 - obs.prob_given_false
        )
      }
      
      // Only log first few calculations
      if (debugCount < 3 && probability !== oldProbability) {
        console.log(`${obs.entity_id}: ${isActive} -> ${oldProbability.toFixed(3)} → ${probability.toFixed(3)}`)
        debugCount++
      }
    }

    return probability
  }

  /**
   * Run simulation over the time range
   */
  simulate(sampleIntervalMinutes: number = 5): SimulationSummary {
    const points: SimulationPoint[] = []
    const currentTime = new Date(this.startTime)
    const intervalMs = sampleIntervalMinutes * 60 * 1000

    console.log(`Buffer simulation: ${this.entityData.size} entities, ${this.observations.length} observations, prior=${this.prior}`)
    console.log('Observations with probabilities:', this.observations.map(obs => 
      `${obs.entity_id}: P(true)=${obs.prob_given_true}, P(false)=${obs.prob_given_false}`
    ).join(' | '))

    while (currentTime <= this.endTime) {
      const observationStates = this.evaluateObservationsAtTime(currentTime)
      const probability = this.calculateProbability(observationStates)
      const sensorState = probability >= this.threshold
      
      const activeObservations = Array.from(observationStates.entries())
        .filter(([_, isActive]) => isActive)
        .map(([entityId, _]) => entityId)

      points.push({
        timestamp: new Date(currentTime),
        probability,
        sensorState,
        activeObservations
      })

      currentTime.setTime(currentTime.getTime() + intervalMs)
    }

    const statistics = this.calculateStatistics(points)
    const onPeriods = this.calculateOnPeriods(points)

    console.log(`Buffer simulation complete: ${points.length} points, ${statistics.triggerCount} triggers`)

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

    let onTime = 0
    let triggerCount = 0
    let wasOn = false

    for (const point of points) {
      if (point.sensorState && !wasOn) {
        triggerCount++
      }
      wasOn = point.sensorState
    }

    const sampleInterval = points.length > 1 
      ? points[1].timestamp.getTime() - points[0].timestamp.getTime()
      : 5 * 60 * 1000

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
        currentPeriodStart = point.timestamp
      } else if (!point.sensorState && wasOn && currentPeriodStart) {
        periods.push({
          start: currentPeriodStart,
          end: point.timestamp
        })
        currentPeriodStart = null
      }
    }

    if (currentPeriodStart && points.length > 0 && points[points.length - 1].sensorState) {
      periods.push({
        start: currentPeriodStart,
        end: points[points.length - 1].timestamp
      })
    }

    return periods
  }

  /**
   * Get buffer performance metrics
   */
  getPerformanceMetrics(): {
    totalEntities: number
    totalDataPoints: number
    totalBufferSize: number
    averagePointsPerEntity: number
  } {
    let totalDataPoints = 0
    let totalBufferSize = 0

    for (const [_, entityData] of this.entityData) {
      totalDataPoints += entityData.pointCount
      totalBufferSize += entityData.buffer.byteLength
    }

    return {
      totalEntities: this.entityData.size,
      totalDataPoints,
      totalBufferSize,
      averagePointsPerEntity: this.entityData.size > 0 ? totalDataPoints / this.entityData.size : 0
    }
  }
}