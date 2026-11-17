import type { BayesianObservation } from '../types/bayesian'
import type { EntityBufferMetadata } from './entityBuffer'
import { computePosterior, countObservationsByEntity } from './haBayesian'

export interface SimulationPoint {
  timestamp: Date
  probability: number
  sensorState: boolean
  /** Entity ids with at least one observation that matched at this time. */
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

/** Looks up an entity's state at a given time (null = unknown at that time). */
export type StateLookup = (entityId: string, time: Date) => string | null

/**
 * Sample the HA posterior (see haBayesian.computePosterior) over a time range.
 * Pure: all data access goes through `getStateAt`.
 */
export function simulatePosterior(
  prior: number,
  threshold: number,
  observations: readonly BayesianObservation[],
  getStateAt: StateLookup,
  timeRange: { start: Date; end: Date },
  sampleIntervalMinutes: number = 5
): SimulationSummary {
  const points: SimulationPoint[] = []
  const intervalMs = Math.max(1, sampleIntervalMinutes) * 60 * 1000
  const entityCounts = countObservationsByEntity(observations)
  const startMs = timeRange.start.getTime()
  const endMs = timeRange.end.getTime()

  for (let t = startMs; t <= endMs; t += intervalMs) {
    const timestamp = new Date(t)
    const { probability, outcomes } = computePosterior(
      prior,
      observations,
      entityId => getStateAt(entityId, timestamp),
      entityCounts
    )
    const active = new Set<string>()
    outcomes.forEach((outcome, i) => {
      if (outcome === true) active.add(observations[i].entity_id)
    })
    points.push({
      timestamp,
      probability,
      sensorState: probability >= threshold, // HA: is_on = probability >= threshold
      activeObservations: Array.from(active)
    })
  }

  return {
    points,
    statistics: calculateStatistics(points, intervalMs, endMs - startMs),
    onPeriods: calculateOnPeriods(points)
  }
}

function calculateStatistics(
  points: SimulationPoint[],
  intervalMs: number,
  totalMs: number
): SimulationSummary['statistics'] {
  if (points.length === 0) {
    return { avgProbability: 0, maxProbability: 0, minProbability: 0, onTime: 0, onPercentage: 0, triggerCount: 0 }
  }

  let sum = 0
  let max = -Infinity
  let min = Infinity
  let onSamples = 0
  let triggerCount = 0
  let wasOn = false
  for (const p of points) {
    sum += p.probability
    if (p.probability > max) max = p.probability
    if (p.probability < min) min = p.probability
    if (p.sensorState) {
      onSamples++
      if (!wasOn) triggerCount++
    }
    wasOn = p.sensorState
  }

  const onTime = onSamples * intervalMs
  return {
    avgProbability: sum / points.length,
    maxProbability: max,
    minProbability: min,
    onTime,
    onPercentage: totalMs > 0 ? Math.min(100, (onTime / totalMs) * 100) : 0,
    triggerCount
  }
}

function calculateOnPeriods(points: SimulationPoint[]): Array<{ start: Date; end: Date }> {
  const periods: Array<{ start: Date; end: Date }> = []
  let start: Date | null = null
  for (const point of points) {
    if (point.sensorState && !start) {
      start = point.timestamp
    } else if (!point.sensorState && start) {
      periods.push({ start, end: point.timestamp })
      start = null
    }
  }
  if (start && points.length > 0) {
    periods.push({ start, end: points[points.length - 1].timestamp })
  }
  return periods
}

interface BufferEntityData {
  buffer: ArrayBuffer
  view: DataView
  pointCount: number
  stateMap: Map<number, string> // Reverse of encoding map
}

/**
 * BufferBayesianSimulator - simulates the sensor from the compact binary
 * entity buffers produced by StreamingEntityBuffer.
 */
export class BufferBayesianSimulator {
  private prior: number
  private threshold: number
  private observations: BayesianObservation[]
  private entityData: Map<string, BufferEntityData>
  private startTime: Date
  private endTime: Date

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

    for (let i = 0; i < buffers.length && i < metadata.length; i++) {
      const buffer = buffers[i]
      const meta = metadata[i]
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
   * State in effect at `targetTime` (last entry at or before it), or null if
   * the entity has no data or no entry before that time.
   * Buffers are time-sorted (StreamingEntityBuffer guarantees it).
   */
  getStateAtTime(entityId: string, targetTime: Date): string | null {
    const entityData = this.entityData.get(entityId)
    if (!entityData) return null

    const targetTimeSeconds = Math.floor(targetTime.getTime() / 1000)
    let lastStateId: number | null = null
    let left = 0
    let right = entityData.pointCount - 1

    while (left <= right) {
      const mid = (left + right) >> 1
      const offset = mid * 8 // 8 bytes per point
      const entryTimeSeconds = entityData.view.getUint32(offset, true)
      if (entryTimeSeconds <= targetTimeSeconds) {
        lastStateId = entityData.view.getUint32(offset + 4, true)
        left = mid + 1
      } else {
        right = mid - 1
      }
    }

    return lastStateId !== null ? entityData.stateMap.get(lastStateId) ?? null : null
  }

  simulate(sampleIntervalMinutes: number = 5): SimulationSummary {
    return simulatePosterior(
      this.prior,
      this.threshold,
      this.observations,
      (entityId, time) => this.getStateAtTime(entityId, time),
      { start: this.startTime, end: this.endTime },
      sampleIntervalMinutes
    )
  }

  getPerformanceMetrics(): {
    totalEntities: number
    totalDataPoints: number
    totalBufferSize: number
    averagePointsPerEntity: number
  } {
    let totalDataPoints = 0
    let totalBufferSize = 0
    for (const entityData of this.entityData.values()) {
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
