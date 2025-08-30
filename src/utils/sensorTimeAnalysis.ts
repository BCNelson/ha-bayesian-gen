import type { TimePeriod, NumericStateStats } from '../types/bayesian'
import type { HAHistoryEntry } from '../types/homeAssistant'

export interface SensorChunk {
  sensorValue: number
  duration: number
  desiredOutput: boolean
}

export function createSensorPeriodChunks(
  entityHistory: HAHistoryEntry[],
  periods: TimePeriod[]
): SensorChunk[] {
  if (entityHistory.length === 0 || periods.length === 0) return []

  const chunks: SensorChunk[] = []
  
  const sortedHistory = [...entityHistory].sort((a, b) => 
    new Date(a.last_changed).getTime() - new Date(b.last_changed).getTime()
  )
  
  for (const period of periods) {
    const periodStart = new Date(period.start).getTime()
    const periodEnd = new Date(period.end).getTime()
    
    const relevantChanges = sortedHistory.filter(entry => {
      const entryTime = new Date(entry.last_changed).getTime()
      return entryTime > periodStart && entryTime < periodEnd
    })
    
    const timePoints = [periodStart]
    relevantChanges.forEach(entry => {
      timePoints.push(new Date(entry.last_changed).getTime())
    })
    timePoints.push(periodEnd)
    
    let currentValue: number | null = null
    for (let i = sortedHistory.length - 1; i >= 0; i--) {
      const entryTime = new Date(sortedHistory[i].last_changed).getTime()
      if (entryTime <= periodStart) {
        const state = sortedHistory[i].state
        if (!isNaN(parseFloat(state))) {
          currentValue = parseFloat(state)
        }
        break
      }
    }
    
    for (let i = 0; i < timePoints.length - 1; i++) {
      const chunkStart = timePoints[i]
      const chunkEnd = timePoints[i + 1]
      const duration = chunkEnd - chunkStart
      
      if (duration < 1000) continue
      
      if (i > 0) { // Skip first iteration (no change at period start)
        const changeAtThisTime = relevantChanges.find(entry => 
          new Date(entry.last_changed).getTime() === chunkStart
        )
        if (changeAtThisTime && !isNaN(parseFloat(changeAtThisTime.state))) {
          currentValue = parseFloat(changeAtThisTime.state)
        }
      }
      
      if (currentValue !== null) {
        chunks.push({
          sensorValue: currentValue,
          duration,
          desiredOutput: period.isTruePeriod
        })
      }
    }
  }

  return chunks
}

export function analyzeNumericStates(
  entityHistory: HAHistoryEntry[],
  periods: TimePeriod[]
): NumericStateStats {
  const allChunks = createSensorPeriodChunks(entityHistory, periods)
  
  const trueChunks = allChunks.filter(chunk => chunk.desiredOutput === true)
  const falseChunks = allChunks.filter(chunk => chunk.desiredOutput === false)

  const isNumeric = allChunks.length > 0

  if (!isNumeric) {
    return { isNumeric: false }
  }

  const allValues = allChunks.map(chunk => chunk.sensorValue)
  const totalDuration = allChunks.reduce((sum, chunk) => sum + chunk.duration, 0)
  
  const min = Math.min(...allValues)
  const max = Math.max(...allValues)
  
  const mean = allChunks.reduce((sum, chunk) => sum + (chunk.sensorValue * chunk.duration), 0) / totalDuration
  
  const variance = allChunks.reduce((sum, chunk) => 
    sum + (Math.pow(chunk.sensorValue - mean, 2) * chunk.duration), 0) / totalDuration
  const stdDev = Math.sqrt(variance)

  return {
    isNumeric: true,
    min,
    max,
    mean,
    stdDev,
    trueChunks: trueChunks.map(c => ({ value: c.sensorValue, duration: c.duration })),
    falseChunks: falseChunks.map(c => ({ value: c.sensorValue, duration: c.duration }))
  }
}

export function chunkMatchesThreshold(value: number, above?: number, below?: number): boolean {
  if (above !== undefined && below !== undefined) {
    return value > above && value <= below
  } else if (above !== undefined) {
    return value > above
  } else if (below !== undefined) {
    return value <= below
  }
  return false
}

export function calculateThresholdScore(
  trueChunks: Array<{ value: number; duration: number }>, 
  falseChunks: Array<{ value: number; duration: number }>, 
  above?: number, 
  below?: number
): number {
  
  let trueMatchingDuration = 0
  let trueTotalDuration = 0
  
  for (const chunk of trueChunks) {
    trueTotalDuration += chunk.duration
    
    const matches = chunkMatchesThreshold(chunk.value, above, below)
    if (matches) {
      trueMatchingDuration += chunk.duration
    }
  }
  
  let falseMatchingDuration = 0
  let falseTotalDuration = 0
  
  for (const chunk of falseChunks) {
    falseTotalDuration += chunk.duration
    
    const matches = chunkMatchesThreshold(chunk.value, above, below)
    if (matches) {
      falseMatchingDuration += chunk.duration
    }
  }

  const truePct = trueTotalDuration > 0 ? trueMatchingDuration / trueTotalDuration : 0
  const falsePct = falseTotalDuration > 0 ? falseMatchingDuration / falseTotalDuration : 0
  
  return Math.abs(truePct - falsePct)
}

export function findOptimalNumericThresholds(stats: NumericStateStats): { above?: number; below?: number } {
  if (!stats.isNumeric || !stats.trueChunks || !stats.falseChunks || 
      stats.trueChunks.length === 0 || stats.falseChunks.length === 0) {
    return { above: undefined, below: undefined }
  }

  const { trueChunks, falseChunks, min = 0, max = 100 } = stats
  const allValues = [...trueChunks.map(c => c.value), ...falseChunks.map(c => c.value)].sort((a, b) => a - b)
  
  const candidates = new Set<number>()
  
  allValues.forEach(val => candidates.add(val))
  
  for (let i = 0; i < allValues.length - 1; i++) {
    const midpoint = (allValues[i] + allValues[i + 1]) / 2
    candidates.add(midpoint)
  }
  
  const range = max - min
  const step = range / 20 // 20 steps across the range
  for (let i = 0; i <= 20; i++) {
    candidates.add(min + (step * i))
  }

  const thresholdCandidates = Array.from(candidates).sort((a, b) => a - b)
  
  let bestScore = -1
  let bestThresholds = { above: undefined as number | undefined, below: undefined as number | undefined }

  const strategies = [
    'above_only',   // Only use "above" threshold
    'below_only',   // Only use "below" threshold  
    'range'         // Use both "above" and "below" (inclusive range per HA docs)
  ]

  for (const strategy of strategies) {
    if (strategy === 'above_only') {
      for (const threshold of thresholdCandidates) {
        const score = calculateThresholdScore(trueChunks, falseChunks, threshold, undefined)
        if (score > bestScore) {
          bestScore = score
          bestThresholds = { above: threshold, below: undefined }
        }
      }
    } else if (strategy === 'below_only') {
      for (const threshold of thresholdCandidates) {
        const score = calculateThresholdScore(trueChunks, falseChunks, undefined, threshold)
        if (score > bestScore) {
          bestScore = score
          bestThresholds = { above: undefined, below: threshold }
        }
      }
    } else if (strategy === 'range') {
      for (let i = 0; i < thresholdCandidates.length - 1; i++) {
        for (let j = i + 1; j < thresholdCandidates.length; j++) {
          const above = thresholdCandidates[i]
          const below = thresholdCandidates[j]
          const score = calculateThresholdScore(trueChunks, falseChunks, above, below)
          if (score > bestScore) {
            bestScore = score
            bestThresholds = { above, below }
          }
        }
      }
    }
  }

  return bestThresholds
}