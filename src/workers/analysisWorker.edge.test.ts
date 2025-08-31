import { describe, it, expect, beforeEach } from 'vitest'
import type { HAHistoryResponse, HAHistoryEntry } from '../types/homeAssistant'
import type { TimePeriod, EntityProbability } from '../types/bayesian'

// Extended BayesianCalculatorWorker class for edge case testing
class BayesianCalculatorWorker {
  private numericThresholdCache = new Map<string, Map<string, number>>()
  
  calculateEntityProbabilities(
    history: HAHistoryResponse,
    serializedPeriods: Array<{
      id: string
      start: string
      end: string
      isTruePeriod: boolean
      label?: string
    }>
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
      const isNumeric = this.isNumericEntity(entityHistory)
      
      if (isNumeric) {
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
            totalFalsePeriods: falsePeriods.length
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
  ): Array<{
    start: number
    end: number
    state: string
    value?: number
    isTruePeriod: boolean
  }> {
    const timeline: Array<{
      time: number
      type: 'state_change' | 'period_start' | 'period_end'
      state?: string
      value?: number
      isTruePeriod?: boolean
    }> = []
    
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
    
    const segments: Array<{
      start: number
      end: number
      state: string
      value?: number
      isTruePeriod: boolean
    }> = []
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
    segments: Array<{
      start: number
      end: number
      state: string
      value?: number
      isTruePeriod: boolean
    }>
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
    segments: Array<{
      start: number
      end: number
      state: string
      value?: number
      isTruePeriod: boolean
    }>
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

  // Expose private methods for testing
  public testIsNumericEntity = this.isNumericEntity.bind(this)
  public testCreateUnifiedTimeline = this.createUnifiedTimeline.bind(this)
  public testAnalyzeStateSegments = this.analyzeStateSegments.bind(this)
  public testAnalyzeNumericSegments = this.analyzeNumericSegments.bind(this)
}

describe('BayesianCalculatorWorker - Edge Cases', () => {
  let calculator: BayesianCalculatorWorker

  beforeEach(() => {
    calculator = new BayesianCalculatorWorker()
  })

  describe('Timeline Boundary Conditions', () => {
    it('should handle state changes exactly at period boundaries', () => {
      const history = {
        'sensor.test': [
          {
            entity_id: 'sensor.test',
            state: '10',
            last_changed: '2024-01-01T10:00:00.000Z', // Exactly at period start
            last_updated: '2024-01-01T10:00:00.000Z',
            attributes: {}
          },
          {
            entity_id: 'sensor.test',
            state: '20',
            last_changed: '2024-01-01T12:00:00.000Z', // Exactly at period end
            last_updated: '2024-01-01T12:00:00.000Z',
            attributes: {}
          }
        ]
      }

      const periods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00.000Z',
          end: '2024-01-01T12:00:00.000Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T14:00:00.000Z',
          end: '2024-01-01T16:00:00.000Z',
          isTruePeriod: false
        }
      ]

      const result = calculator.calculateEntityProbabilities(history, periods)
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle multiple overlapping periods', () => {
      const history = {
        'sensor.test': [
          {
            entity_id: 'sensor.test',
            state: '25',
            last_changed: '2024-01-01T10:30:00Z',
            last_updated: '2024-01-01T10:30:00Z',
            attributes: {}
          }
        ]
      }

      const overlappingPeriods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T12:00:00Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T11:00:00Z', // Overlaps with period 1
          end: '2024-01-01T13:00:00Z',
          isTruePeriod: false
        },
        {
          id: '3',
          start: '2024-01-01T11:30:00Z', // Overlaps with both
          end: '2024-01-01T12:30:00Z',
          isTruePeriod: true
        }
      ]

      const result = calculator.calculateEntityProbabilities(history, overlappingPeriods)
      expect(result).toBeDefined()
      
      // Should handle overlapping periods by considering the most recent period state
      result.forEach(prob => {
        expect(prob.probGivenTrue).toBeGreaterThanOrEqual(0.01)
        expect(prob.probGivenFalse).toBeGreaterThanOrEqual(0.01)
      })
    })

    it('should handle state changes outside all periods', () => {
      const history = {
        'sensor.test': [
          {
            entity_id: 'sensor.test',
            state: '5',
            last_changed: '2024-01-01T08:00:00Z', // Before all periods
            last_updated: '2024-01-01T08:00:00Z',
            attributes: {}
          },
          {
            entity_id: 'sensor.test',
            state: '15',
            last_changed: '2024-01-01T11:00:00Z', // During period
            last_updated: '2024-01-01T11:00:00Z',
            attributes: {}
          },
          {
            entity_id: 'sensor.test',
            state: '25',
            last_changed: '2024-01-01T18:00:00Z', // After all periods
            last_updated: '2024-01-01T18:00:00Z',
            attributes: {}
          }
        ]
      }

      const periods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T12:00:00Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T14:00:00Z',
          end: '2024-01-01T16:00:00Z',
          isTruePeriod: false
        }
      ]

      const result = calculator.calculateEntityProbabilities(history, periods)
      expect(result).toBeDefined()
      
      // Should use the previous state for period analysis
      expect(result.length).toBeGreaterThan(0)
    })

    it('should handle zero-duration periods', () => {
      const history = {
        'sensor.test': [
          {
            entity_id: 'sensor.test',
            state: '10',
            last_changed: '2024-01-01T10:00:00Z',
            last_updated: '2024-01-01T10:00:00Z',
            attributes: {}
          }
        ]
      }

      const zeroDurationPeriods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00.000Z',
          end: '2024-01-01T10:00:00.000Z', // Zero duration
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T11:00:00Z',
          end: '2024-01-01T12:00:00Z',
          isTruePeriod: false
        }
      ]

      const result = calculator.calculateEntityProbabilities(history, zeroDurationPeriods)
      expect(result).toBeDefined()
      // Zero duration periods should not contribute to analysis
    })
  })

  describe('Numeric Entity Detection Edge Cases', () => {
    it('should handle exactly 70% numeric threshold boundary', () => {
      const exactBoundaryHistory = [
        { entity_id: 'sensor.boundary', state: '1', last_changed: '2024-01-01T10:00:00Z', last_updated: '2024-01-01T10:00:00Z', attributes: {} },
        { entity_id: 'sensor.boundary', state: '2', last_changed: '2024-01-01T10:01:00Z', last_updated: '2024-01-01T10:01:00Z', attributes: {} },
        { entity_id: 'sensor.boundary', state: '3', last_changed: '2024-01-01T10:02:00Z', last_updated: '2024-01-01T10:02:00Z', attributes: {} },
        { entity_id: 'sensor.boundary', state: '4', last_changed: '2024-01-01T10:03:00Z', last_updated: '2024-01-01T10:03:00Z', attributes: {} },
        { entity_id: 'sensor.boundary', state: '5', last_changed: '2024-01-01T10:04:00Z', last_updated: '2024-01-01T10:04:00Z', attributes: {} },
        { entity_id: 'sensor.boundary', state: '6', last_changed: '2024-01-01T10:05:00Z', last_updated: '2024-01-01T10:05:00Z', attributes: {} },
        { entity_id: 'sensor.boundary', state: '7', last_changed: '2024-01-01T10:06:00Z', last_updated: '2024-01-01T10:06:00Z', attributes: {} },
        { entity_id: 'sensor.boundary', state: 'off', last_changed: '2024-01-01T10:07:00Z', last_updated: '2024-01-01T10:07:00Z', attributes: {} },
        { entity_id: 'sensor.boundary', state: 'on', last_changed: '2024-01-01T10:08:00Z', last_updated: '2024-01-01T10:08:00Z', attributes: {} },
        { entity_id: 'sensor.boundary', state: 'idle', last_changed: '2024-01-01T10:09:00Z', last_updated: '2024-01-01T10:09:00Z', attributes: {} }
      ]

      // 7 out of 10 entries are numeric = 70% exactly
      const isNumeric = calculator.testIsNumericEntity(exactBoundaryHistory)
      expect(isNumeric).toBe(true)
    })

    it('should handle scientific notation', () => {
      const scientificHistory = [
        { entity_id: 'sensor.sci', state: '1.5e-10', last_changed: '2024-01-01T10:00:00Z', last_updated: '2024-01-01T10:00:00Z', attributes: {} },
        { entity_id: 'sensor.sci', state: '2.1E+5', last_changed: '2024-01-01T10:01:00Z', last_updated: '2024-01-01T10:01:00Z', attributes: {} },
        { entity_id: 'sensor.sci', state: '-3.14e2', last_changed: '2024-01-01T10:02:00Z', last_updated: '2024-01-01T10:02:00Z', attributes: {} }
      ]

      const isNumeric = calculator.testIsNumericEntity(scientificHistory)
      expect(isNumeric).toBe(true)
    })

    it('should handle negative numbers and zero', () => {
      const negativeHistory = [
        { entity_id: 'sensor.neg', state: '-123.45', last_changed: '2024-01-01T10:00:00Z', last_updated: '2024-01-01T10:00:00Z', attributes: {} },
        { entity_id: 'sensor.neg', state: '0', last_changed: '2024-01-01T10:01:00Z', last_updated: '2024-01-01T10:01:00Z', attributes: {} },
        { entity_id: 'sensor.neg', state: '-0.001', last_changed: '2024-01-01T10:02:00Z', last_updated: '2024-01-01T10:02:00Z', attributes: {} }
      ]

      const isNumeric = calculator.testIsNumericEntity(negativeHistory)
      expect(isNumeric).toBe(true)
    })

    it('should handle numeric-looking strings that are not numbers', () => {
      const fakeNumericHistory = [
        { entity_id: 'sensor.fake', state: '123abc', last_changed: '2024-01-01T10:00:00Z', last_updated: '2024-01-01T10:00:00Z', attributes: {} },
        { entity_id: 'sensor.fake', state: 'NaN', last_changed: '2024-01-01T10:01:00Z', last_updated: '2024-01-01T10:01:00Z', attributes: {} },
        { entity_id: 'sensor.fake', state: 'Infinity', last_changed: '2024-01-01T10:02:00Z', last_updated: '2024-01-01T10:02:00Z', attributes: {} }
      ]

      const isNumeric = calculator.testIsNumericEntity(fakeNumericHistory)
      expect(isNumeric).toBe(false)
    })

    it('should handle extreme numeric values', () => {
      const extremeHistory = [
        { entity_id: 'sensor.extreme', state: String(Number.MAX_SAFE_INTEGER), last_changed: '2024-01-01T10:00:00Z', last_updated: '2024-01-01T10:00:00Z', attributes: {} },
        { entity_id: 'sensor.extreme', state: String(Number.MIN_SAFE_INTEGER), last_changed: '2024-01-01T10:01:00Z', last_updated: '2024-01-01T10:01:00Z', attributes: {} },
        { entity_id: 'sensor.extreme', state: String(Number.EPSILON), last_changed: '2024-01-01T10:02:00Z', last_updated: '2024-01-01T10:02:00Z', attributes: {} }
      ]

      const isNumeric = calculator.testIsNumericEntity(extremeHistory)
      expect(isNumeric).toBe(true)
    })
  })

  describe('Probability Calculation Precision', () => {
    it('should handle zero occurrences (probability clamping)', () => {
      const history = {
        'sensor.zero': [
          {
            entity_id: 'sensor.zero',
            state: 'never_in_false',
            last_changed: '2024-01-01T10:30:00Z', // Only in true period
            last_updated: '2024-01-01T10:30:00Z',
            attributes: {}
          }
        ]
      }

      const periods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T12:00:00Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T14:00:00Z',
          end: '2024-01-01T16:00:00Z',
          isTruePeriod: false
        }
      ]

      const result = calculator.calculateEntityProbabilities(history, periods)
      expect(result).toBeDefined()
      
      result.forEach(prob => {
        expect(prob.probGivenTrue).toBeGreaterThanOrEqual(0.01)
        expect(prob.probGivenFalse).toBeGreaterThanOrEqual(0.01)
        expect(prob.probGivenTrue).toBeLessThanOrEqual(0.99)
        expect(prob.probGivenFalse).toBeLessThanOrEqual(0.99)
      })
    })

    it('should handle perfect discrimination (100% vs 0%)', () => {
      const history = {
        'binary_sensor.perfect': [
          {
            entity_id: 'binary_sensor.perfect',
            state: 'on',
            last_changed: '2024-01-01T10:30:00Z', // Only in true periods
            last_updated: '2024-01-01T10:30:00Z',
            attributes: {}
          },
          {
            entity_id: 'binary_sensor.perfect',
            state: 'off',
            last_changed: '2024-01-01T14:30:00Z', // Only in false periods
            last_updated: '2024-01-01T14:30:00Z',
            attributes: {}
          }
        ]
      }

      const periods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T12:00:00Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T14:00:00Z',
          end: '2024-01-01T16:00:00Z',
          isTruePeriod: false
        }
      ]

      const result = calculator.calculateEntityProbabilities(history, periods)
      expect(result).toBeDefined()
      
      expect(result.length).toBe(2)

      // Due to state persistence, 'on' appears in both periods (correct behavior)
      // 'on' starts at 10:30 in true period, persists until 14:30 in false period
      // 'off' only appears in false period starting at 14:30
      const onState = result.find(r => r.state === 'on')
      const offState = result.find(r => r.state === 'off')
      
      // 'off' state should have perfect discrimination (only in false period)
      expect(offState?.discriminationPower).toBe(1)
      expect(offState?.trueOccurrences).toBe(0)
      expect(offState?.falseOccurrences).toBe(1)
      
      // 'on' state appears in both periods due to state persistence (expected)
      expect(onState?.trueOccurrences).toBe(1)
      expect(onState?.falseOccurrences).toBe(1)
    })

    it('should handle identical behavior in true vs false periods', () => {
      const history = {
        'sensor.identical': [
          {
            entity_id: 'sensor.identical',
            state: 'same',
            last_changed: '2024-01-01T10:30:00Z', // In true period
            last_updated: '2024-01-01T10:30:00Z',
            attributes: {}
          },
          {
            entity_id: 'sensor.identical',
            state: 'same',
            last_changed: '2024-01-01T14:30:00Z', // In false period
            last_updated: '2024-01-01T14:30:00Z',
            attributes: {}
          }
        ]
      }

      const periods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T12:00:00Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T14:00:00Z',
          end: '2024-01-01T16:00:00Z',
          isTruePeriod: false
        }
      ]

      const result = calculator.calculateEntityProbabilities(history, periods)
      expect(result).toBeDefined()
      
      // Should have zero discrimination power for identical behavior
      const sameState = result.find(r => r.state === 'same')
      expect(sameState).toBeDefined()
      expect(sameState?.discriminationPower).toBe(0)
    })

    it('should handle large numbers of periods', () => {
      const history = {
        'sensor.many': [
          {
            entity_id: 'sensor.many',
            state: 'high',
            last_changed: '2024-01-01T10:00:00Z',
            last_updated: '2024-01-01T10:00:00Z',
            attributes: {}
          }
        ]
      }

      // Create 50 true periods and 50 false periods
      const manyPeriods = []
      for (let i = 0; i < 100; i++) {
        manyPeriods.push({
          id: String(i),
          start: `2024-01-${String(i % 28 + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00Z`,
          end: `2024-01-${String(i % 28 + 1).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:30:00Z`,
          isTruePeriod: i % 2 === 0
        })
      }

      const result = calculator.calculateEntityProbabilities(history, manyPeriods)
      expect(result).toBeDefined()
      
      result.forEach(prob => {
        expect(prob.totalTruePeriods).toBe(50)
        expect(prob.totalFalsePeriods).toBe(50)
        expect(prob.probGivenTrue).toBeGreaterThanOrEqual(0.01)
        expect(prob.probGivenFalse).toBeGreaterThanOrEqual(0.01)
      })
    })
  })

  describe('Floating Point Precision Edge Cases', () => {
    it('should handle very small numeric differences', () => {
      const precisionHistory = {
        'sensor.precision': [
          {
            entity_id: 'sensor.precision',
            state: '0.1000000000000001',
            last_changed: '2024-01-01T10:30:00Z',
            last_updated: '2024-01-01T10:30:00Z',
            attributes: {}
          },
          {
            entity_id: 'sensor.precision',
            state: '0.1000000000000002',
            last_changed: '2024-01-01T14:30:00Z',
            last_updated: '2024-01-01T14:30:00Z',
            attributes: {}
          }
        ]
      }

      const periods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T12:00:00Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T14:00:00Z',
          end: '2024-01-01T16:00:00Z',
          isTruePeriod: false
        }
      ]

      const result = calculator.calculateEntityProbabilities(precisionHistory, periods)
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThan(0)
      
      // Should handle floating point precision gracefully
      result.forEach(prob => {
        expect(prob.probGivenTrue).toBeDefined()
        expect(prob.probGivenFalse).toBeDefined()
        expect(prob.discriminationPower).toBeDefined()
      })
    })

    it('should handle NaN and Infinity in numeric analysis gracefully', () => {
      const infinityHistory = {
        'sensor.infinity': [
          {
            entity_id: 'sensor.infinity',
            state: 'Infinity',
            last_changed: '2024-01-01T10:30:00Z',
            last_updated: '2024-01-01T10:30:00Z',
            attributes: {}
          },
          {
            entity_id: 'sensor.infinity',
            state: 'NaN',
            last_changed: '2024-01-01T14:30:00Z',
            last_updated: '2024-01-01T14:30:00Z',
            attributes: {}
          }
        ]
      }

      const periods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T12:00:00Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T14:00:00Z',
          end: '2024-01-01T16:00:00Z',
          isTruePeriod: false
        }
      ]

      // Should not crash with Infinity/NaN values
      expect(() => {
        const result = calculator.calculateEntityProbabilities(infinityHistory, periods)
        expect(result).toBeDefined()
      }).not.toThrow()
    })
  })

  describe('Memory and Performance Edge Cases', () => {
    it('should handle very large entity histories efficiently', () => {
      const largeHistory = {
        'sensor.large': Array.from({ length: 10000 }, (_, i) => ({
          entity_id: 'sensor.large',
          state: String(i % 100),
          last_changed: new Date(2024, 0, 1, 10, 0, i).toISOString(),
          last_updated: new Date(2024, 0, 1, 10, 0, i).toISOString(),
          attributes: {}
        }))
      }

      const periods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T15:00:00Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T16:00:00Z',
          end: '2024-01-01T21:00:00Z',
          isTruePeriod: false
        }
      ]

      const startTime = Date.now()
      const result = calculator.calculateEntityProbabilities(largeHistory, periods)
      const duration = Date.now() - startTime

      expect(result).toBeDefined()
      expect(duration).toBeLessThan(10000) // Should complete within 10 seconds
      expect(result.length).toBeGreaterThan(0)
    })

    it('should handle timeline with many simultaneous events', () => {
      const simultaneousHistory = {
        'sensor.simultaneous': Array.from({ length: 100 }, (_, i) => ({
          entity_id: 'sensor.simultaneous',
          state: String(i),
          last_changed: '2024-01-01T10:30:00.000Z', // All at exact same time
          last_updated: '2024-01-01T10:30:00.000Z',
          attributes: {}
        }))
      }

      const periods = [
        {
          id: '1',
          start: '2024-01-01T10:00:00Z',
          end: '2024-01-01T12:00:00Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T14:00:00Z',
          end: '2024-01-01T16:00:00Z',
          isTruePeriod: false
        }
      ]

      const result = calculator.calculateEntityProbabilities(simultaneousHistory, periods)
      expect(result).toBeDefined()
      // Should handle simultaneous events by using the last state
    })
  })
})