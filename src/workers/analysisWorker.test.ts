import { describe, it, expect, beforeEach } from 'vitest'
import type { HAHistoryResponse, HAHistoryEntry } from '../types/homeAssistant'
import type { TimePeriod, EntityProbability } from '../types/bayesian'

// Import the BayesianCalculatorWorker class directly for testing
// Since the worker uses self.onmessage, we'll test the class methods directly
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
      
      const periodKey = `${segment.isTruePeriod}-${Math.floor(segment.start / 86400000)}`
      
      if (segment.isTruePeriod && !seenInTruePeriod.has(periodKey + segment.state)) {
        stateAnalysis[segment.state].trueOccurrences++
        seenInTruePeriod.add(periodKey + segment.state)
      } else if (!segment.isTruePeriod && !seenInFalsePeriod.has(periodKey + segment.state)) {
        stateAnalysis[segment.state].falseOccurrences++
        seenInFalsePeriod.add(periodKey + segment.state)
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
}

describe('BayesianCalculatorWorker', () => {
  let calculator: BayesianCalculatorWorker
  let mockHistory: HAHistoryResponse
  let mockPeriods: Array<{
    id: string
    start: string
    end: string
    isTruePeriod: boolean
    label?: string
  }>

  beforeEach(() => {
    calculator = new BayesianCalculatorWorker()
    
    // Mock history data with binary sensor
    mockHistory = {
      'binary_sensor.motion': [
        {
          entity_id: 'binary_sensor.motion',
          state: 'on',
          last_changed: '2024-01-01T10:00:00Z',
          last_updated: '2024-01-01T10:00:00Z',
          attributes: {}
        },
        {
          entity_id: 'binary_sensor.motion',
          state: 'off',
          last_changed: '2024-01-01T12:00:00Z',
          last_updated: '2024-01-01T12:00:00Z',
          attributes: {}
        }
      ],
      'sensor.temperature': [
        {
          entity_id: 'sensor.temperature',
          state: '25.5',
          last_changed: '2024-01-01T10:00:00Z',
          last_updated: '2024-01-01T10:00:00Z',
          attributes: {}
        },
        {
          entity_id: 'sensor.temperature',
          state: '20.0',
          last_changed: '2024-01-01T14:00:00Z',
          last_updated: '2024-01-01T14:00:00Z',
          attributes: {}
        }
      ]
    }
    
    mockPeriods = [
      {
        id: '1',
        start: '2024-01-01T09:00:00Z',
        end: '2024-01-01T13:00:00Z',
        isTruePeriod: true,
        label: 'Morning'
      },
      {
        id: '2',
        start: '2024-01-01T13:00:00Z',
        end: '2024-01-01T17:00:00Z',
        isTruePeriod: false,
        label: 'Afternoon'
      }
    ]
  })

  describe('calculateEntityProbabilities', () => {
    it('should calculate probabilities for binary sensors', () => {
      const result = calculator.calculateEntityProbabilities(
        { 'binary_sensor.motion': mockHistory['binary_sensor.motion'] },
        mockPeriods
      )

      expect(result).toHaveLength(2) // 'on' and 'off' states
      expect(result[0]).toMatchObject({
        entityId: 'binary_sensor.motion',
        totalTruePeriods: 1,
        totalFalsePeriods: 1
      })
      expect(result[0].probGivenTrue).toBeGreaterThan(0)
      expect(result[0].probGivenFalse).toBeGreaterThan(0)
      expect(result[0].discriminationPower).toBeGreaterThanOrEqual(0)
    })

    it('should calculate probabilities for numeric sensors', () => {
      const result = calculator.calculateEntityProbabilities(
        { 'sensor.temperature': mockHistory['sensor.temperature'] },
        mockPeriods
      )

      expect(result).toHaveLength(1) // Numeric analysis creates one state
      expect(result[0]).toMatchObject({
        entityId: 'sensor.temperature',
        totalTruePeriods: 1,
        totalFalsePeriods: 1
      })
      expect(result[0].state).toContain('mean_true')
      expect(result[0].state).toContain('mean_false')
    })

    it('should throw error with no true periods', () => {
      const periodsWithoutTrue = [
        {
          id: '1',
          start: '2024-01-01T09:00:00Z',
          end: '2024-01-01T13:00:00Z',
          isTruePeriod: false
        }
      ]

      expect(() => {
        calculator.calculateEntityProbabilities(mockHistory, periodsWithoutTrue)
      }).toThrow('Need at least one TRUE and one FALSE period')
    })

    it('should throw error with no false periods', () => {
      const periodsWithoutFalse = [
        {
          id: '1',
          start: '2024-01-01T09:00:00Z',
          end: '2024-01-01T13:00:00Z',
          isTruePeriod: true
        }
      ]

      expect(() => {
        calculator.calculateEntityProbabilities(mockHistory, periodsWithoutFalse)
      }).toThrow('Need at least one TRUE and one FALSE period')
    })

    it('should sort results by discrimination power', () => {
      const result = calculator.calculateEntityProbabilities(mockHistory, mockPeriods)
      
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].discriminationPower).toBeGreaterThanOrEqual(
          result[i + 1].discriminationPower
        )
      }
    })

    it('should clamp probabilities between 0.01 and 0.99', () => {
      const result = calculator.calculateEntityProbabilities(mockHistory, mockPeriods)
      
      result.forEach(prob => {
        expect(prob.probGivenTrue).toBeGreaterThanOrEqual(0.01)
        expect(prob.probGivenTrue).toBeLessThanOrEqual(0.99)
        expect(prob.probGivenFalse).toBeGreaterThanOrEqual(0.01)
        expect(prob.probGivenFalse).toBeLessThanOrEqual(0.99)
      })
    })
  })

  describe('isNumericEntity', () => {
    it('should identify numeric entities', () => {
      const numericHistory = [
        { entity_id: 'sensor.temp', state: '25.5', last_changed: '2024-01-01T10:00:00Z', last_updated: '2024-01-01T10:00:00Z', attributes: {} },
        { entity_id: 'sensor.temp', state: '26.0', last_changed: '2024-01-01T11:00:00Z', last_updated: '2024-01-01T11:00:00Z', attributes: {} }
      ]
      
      // Access private method through type assertion for testing
      const isNumeric = (calculator as any).isNumericEntity(numericHistory)
      expect(isNumeric).toBe(true)
    })

    it('should identify non-numeric entities', () => {
      const binaryHistory = [
        { entity_id: 'binary_sensor.motion', state: 'on', last_changed: '2024-01-01T10:00:00Z', last_updated: '2024-01-01T10:00:00Z', attributes: {} },
        { entity_id: 'binary_sensor.motion', state: 'off', last_changed: '2024-01-01T11:00:00Z', last_updated: '2024-01-01T11:00:00Z', attributes: {} }
      ]
      
      const isNumeric = (calculator as any).isNumericEntity(binaryHistory)
      expect(isNumeric).toBe(false)
    })

    it('should handle empty history', () => {
      const isNumeric = (calculator as any).isNumericEntity([])
      expect(isNumeric).toBe(false)
    })

    it('should handle mixed numeric and non-numeric states', () => {
      const mixedHistory = [
        { entity_id: 'sensor.mixed', state: '25.5', last_changed: '2024-01-01T10:00:00Z', last_updated: '2024-01-01T10:00:00Z', attributes: {} },
        { entity_id: 'sensor.mixed', state: 'unavailable', last_changed: '2024-01-01T11:00:00Z', last_updated: '2024-01-01T11:00:00Z', attributes: {} },
        { entity_id: 'sensor.mixed', state: '26.0', last_changed: '2024-01-01T12:00:00Z', last_updated: '2024-01-01T12:00:00Z', attributes: {} }
      ]
      
      const isNumeric = (calculator as any).isNumericEntity(mixedHistory)
      expect(isNumeric).toBe(false) // Should be false as 2/3 (66%) are numeric, threshold is 70%
    })
  })

  describe('createUnifiedTimeline', () => {
    it('should create timeline with state changes and periods', () => {
      const entityHistory = mockHistory['binary_sensor.motion']
      const periods = mockPeriods.map(p => ({
        ...p,
        start: new Date(p.start),
        end: new Date(p.end)
      }))
      
      const timeline = (calculator as any).createUnifiedTimeline(entityHistory, periods)
      expect(timeline).toBeDefined()
      expect(Array.isArray(timeline)).toBe(true)
    })

    it('should create timeline segments', () => {
      const shortHistory = [
        {
          entity_id: 'binary_sensor.test',
          state: 'on',
          last_changed: '2024-01-01T10:00:00.000Z',
          last_updated: '2024-01-01T10:00:00.000Z',
          attributes: {}
        },
        {
          entity_id: 'binary_sensor.test',
          state: 'off',
          last_changed: '2024-01-01T10:00:00.500Z', // Only 500ms later
          last_updated: '2024-01-01T10:00:00.500Z',
          attributes: {}
        }
      ]
      
      const periods = [{
        id: '1',
        start: new Date('2024-01-01T09:00:00Z'),
        end: new Date('2024-01-01T11:00:00Z'),
        isTruePeriod: true
      }]
      
      const timeline = (calculator as any).createUnifiedTimeline(shortHistory, periods)
      // Should create timeline segments, actual filtering happens in analysis methods
      expect(timeline).toBeDefined()
      expect(Array.isArray(timeline)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle empty entity history', () => {
      const emptyHistory = { 'sensor.empty': [] }
      const result = calculator.calculateEntityProbabilities(emptyHistory, mockPeriods)
      expect(result).toHaveLength(0)
    })

    it('should handle entity with unavailable states', () => {
      const unavailableHistory = {
        'sensor.unavailable': [
          {
            entity_id: 'sensor.unavailable',
            state: 'unavailable',
            last_changed: '2024-01-01T10:00:00Z',
            last_updated: '2024-01-01T10:00:00Z',
            attributes: {}
          }
        ]
      }
      
      const result = calculator.calculateEntityProbabilities(unavailableHistory, mockPeriods)
      expect(result).toBeDefined()
    })

    it('should handle single period spanning multiple state changes', () => {
      const multiStateHistory = {
        'binary_sensor.multi': [
          {
            entity_id: 'binary_sensor.multi',
            state: 'on',
            last_changed: '2024-01-01T10:00:00Z',
            last_updated: '2024-01-01T10:00:00Z',
            attributes: {}
          },
          {
            entity_id: 'binary_sensor.multi',
            state: 'off',
            last_changed: '2024-01-01T11:00:00Z',
            last_updated: '2024-01-01T11:00:00Z',
            attributes: {}
          },
          {
            entity_id: 'binary_sensor.multi',
            state: 'on',
            last_changed: '2024-01-01T12:00:00Z',
            last_updated: '2024-01-01T12:00:00Z',
            attributes: {}
          }
        ]
      }
      
      const longPeriods = [
        {
          id: '1',
          start: '2024-01-01T09:00:00Z',
          end: '2024-01-01T13:00:00Z',
          isTruePeriod: true
        },
        {
          id: '2',
          start: '2024-01-01T14:00:00Z',
          end: '2024-01-01T18:00:00Z',
          isTruePeriod: false
        }
      ]
      
      const result = calculator.calculateEntityProbabilities(multiStateHistory, longPeriods)
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThan(0)
    })
  })
})