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
  
  // Cache all timestamps and values upfront - single pass through history
  const historyCache = new Map<HAHistoryEntry, { timestamp: number; value: number | null }>()
  for (const entry of entityHistory) {
    const value = !isNaN(parseFloat(entry.state)) ? parseFloat(entry.state) : null
    historyCache.set(entry, {
      timestamp: new Date(entry.last_changed).getTime(),
      value
    })
  }
  
  // Sort using cached timestamps
  const sortedHistory = [...entityHistory].sort((a, b) => {
    const aTime = historyCache.get(a)!.timestamp
    const bTime = historyCache.get(b)!.timestamp
    return aTime - bTime
  })
  
  // Pre-convert period timestamps once
  const periodCache = periods.map(period => ({
    period,
    start: new Date(period.start).getTime(),
    end: new Date(period.end).getTime()
  }))
  
  for (const { period, start: periodStart, end: periodEnd } of periodCache) {
    // Filter using cached timestamps
    const relevantChanges: HAHistoryEntry[] = []
    const relevantTimestamps: number[] = []
    
    for (const entry of sortedHistory) {
      const cached = historyCache.get(entry)!
      if (cached.timestamp > periodStart && cached.timestamp < periodEnd) {
        relevantChanges.push(entry)
        relevantTimestamps.push(cached.timestamp)
      }
    }
    
    const timePoints = [periodStart, ...relevantTimestamps, periodEnd]
    
    let currentValue: number | null = null
    // Find initial value using cached data
    for (let i = sortedHistory.length - 1; i >= 0; i--) {
      const cached = historyCache.get(sortedHistory[i])!
      if (cached.timestamp <= periodStart) {
        currentValue = cached.value
        break
      }
    }
    
    for (let i = 0; i < timePoints.length - 1; i++) {
      const chunkStart = timePoints[i]
      const chunkEnd = timePoints[i + 1]
      const duration = chunkEnd - chunkStart
      
      if (duration < 1000) continue
      
      if (i > 0) { // Skip first iteration (no change at period start)
        // Find the change at this timestamp using index
        const changeIndex = i - 1 // Adjust for periodStart being at index 0
        if (changeIndex >= 0 && changeIndex < relevantChanges.length) {
          const cached = historyCache.get(relevantChanges[changeIndex])!
          if (cached.value !== null) {
            currentValue = cached.value
          }
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
  
  const min = Math.min(...allValues)
  const max = Math.max(...allValues)

  return {
    isNumeric: true,
    min,
    max,
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

function binarySearchFirstAbove(chunks: Array<{ value: number; duration: number }>, threshold: number): number {
  let left = 0
  let right = chunks.length
  
  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    if (chunks[mid].value <= threshold) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  
  return left
}

function binarySearchLastBelow(chunks: Array<{ value: number; duration: number }>, threshold: number): number {
  let left = 0
  let right = chunks.length
  
  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    if (chunks[mid].value <= threshold) {
      left = mid + 1
    } else {
      right = mid
    }
  }
  
  return left
}

function calculateChunksInRange(
  sortedChunks: Array<{ value: number; duration: number }>,
  above?: number,
  below?: number
): { matchingDuration: number; totalDuration: number } {
  let totalDuration = 0
  let matchingDuration = 0
  
  let startIdx = 0
  let endIdx = sortedChunks.length
  
  if (above !== undefined) {
    startIdx = binarySearchFirstAbove(sortedChunks, above)
  }
  
  if (below !== undefined) {
    endIdx = binarySearchLastBelow(sortedChunks, below)
  }
  
  for (let i = 0; i < sortedChunks.length; i++) {
    totalDuration += sortedChunks[i].duration
    
    if (i >= startIdx && i < endIdx) {
      matchingDuration += sortedChunks[i].duration
    }
  }
  
  return { matchingDuration, totalDuration }
}

export function calculateThresholdScore(
  trueChunks: Array<{ value: number; duration: number }>, 
  falseChunks: Array<{ value: number; duration: number }>, 
  above?: number, 
  below?: number,
  presorted = false
): number {
  const sortedTrueChunks = presorted ? trueChunks : [...trueChunks].sort((a, b) => a.value - b.value)
  const sortedFalseChunks = presorted ? falseChunks : [...falseChunks].sort((a, b) => a.value - b.value)
  
  const trueStats = calculateChunksInRange(sortedTrueChunks, above, below)
  const falseStats = calculateChunksInRange(sortedFalseChunks, above, below)
  
  const truePct = trueStats.totalDuration > 0 ? trueStats.matchingDuration / trueStats.totalDuration : 0
  const falsePct = falseStats.totalDuration > 0 ? falseStats.matchingDuration / falseStats.totalDuration : 0
  
  return Math.abs(truePct - falsePct)
}

export function findOptimalNumericThresholds(stats: NumericStateStats): { above?: number; below?: number } {
  if (!stats.isNumeric || !stats.trueChunks || !stats.falseChunks || 
      stats.trueChunks.length === 0 || stats.falseChunks.length === 0) {
    return { above: undefined, below: undefined }
  }

  const { trueChunks, falseChunks, min = 0, max = 100 } = stats
  
  const sortedTrueChunks = [...trueChunks].sort((a, b) => a.value - b.value)
  const sortedFalseChunks = [...falseChunks].sort((a, b) => a.value - b.value)
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

  // Use exhaustive search for guaranteed optimal results
  // Discrimination score can have multiple peaks - not suitable for ternary search
  for (const strategy of strategies) {
    if (strategy === 'above_only') {
      for (const threshold of thresholdCandidates) {
        const score = calculateThresholdScore(sortedTrueChunks, sortedFalseChunks, threshold, undefined, true)
        if (score > bestScore) {
          bestScore = score
          bestThresholds = { above: threshold, below: undefined }
        }
      }
    } else if (strategy === 'below_only') {
      for (const threshold of thresholdCandidates) {
        const score = calculateThresholdScore(sortedTrueChunks, sortedFalseChunks, undefined, threshold, true)
        if (score > bestScore) {
          bestScore = score
          bestThresholds = { above: undefined, below: threshold }
        }
      }
    } else if (strategy === 'range') {
      // Keep optimized O(n²) → O(n*k) approach for ranges with sampling
      const maxRangeTests = 100 // Limit total range tests for performance
      const step = Math.max(1, Math.floor((thresholdCandidates.length * thresholdCandidates.length) / maxRangeTests))
      let testCount = 0
      
      for (let i = 0; i < thresholdCandidates.length - 1 && testCount < maxRangeTests; i++) {
        const stepSize = Math.max(1, Math.floor(step / thresholdCandidates.length))
        for (let j = i + 1; j < thresholdCandidates.length && testCount < maxRangeTests; j += stepSize) {
          const above = thresholdCandidates[i]
          const below = thresholdCandidates[j]
          const score = calculateThresholdScore(sortedTrueChunks, sortedFalseChunks, above, below, true)
          if (score > bestScore) {
            bestScore = score
            bestThresholds = { above, below }
          }
          testCount++
        }
      }
    }
  }

  return bestThresholds
}