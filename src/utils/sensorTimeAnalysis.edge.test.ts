import { describe, it, expect } from 'vitest'
import {
  createSensorPeriodChunks,
  analyzeNumericStates,
  calculateThresholdScore,
  findOptimalNumericThresholds
} from './sensorTimeAnalysis'
import type { TimePeriod, NumericStateStats } from '../types/bayesian'
import type { HAHistoryEntry } from '../types/homeAssistant'

describe('sensorTimeAnalysis - Edge Cases and Optimization Accuracy', () => {
  describe('Threshold Optimization Accuracy', () => {
    it('should find globally optimal threshold for well-separated bimodal distribution', () => {
      // Create a clear bimodal distribution where true values are around 80-90, false around 20-30
      const bimodalStats: NumericStateStats = {
        isNumeric: true,
        min: 15,
        max: 95,
        trueChunks: [
          { value: 80, duration: 1000 },
          { value: 85, duration: 1500 },
          { value: 90, duration: 1200 },
          { value: 82, duration: 800 },
          { value: 88, duration: 1100 }
        ],
        falseChunks: [
          { value: 20, duration: 1000 },
          { value: 25, duration: 1300 },
          { value: 30, duration: 900 },
          { value: 22, duration: 1100 },
          { value: 28, duration: 1200 }
        ]
      }

      const thresholds = findOptimalNumericThresholds(bimodalStats)
      
      // Should find an optimal threshold somewhere between 30 and 80
      expect(thresholds.above).toBeDefined()
      expect(thresholds.above!).toBeGreaterThanOrEqual(30)
      expect(thresholds.above!).toBeLessThanOrEqual(80)

      // Verify the threshold actually provides good discrimination
      const score = calculateThresholdScore(
        bimodalStats.trueChunks!,
        bimodalStats.falseChunks!,
        thresholds.above
      )
      expect(score).toBeGreaterThan(0.9) // Should achieve >90% discrimination
    })

    it('should find optimal threshold when false values are higher', () => {
      // Distribution where false values are higher - algorithm should find optimal strategy
      const reverseStats: NumericStateStats = {
        isNumeric: true,
        min: 15,
        max: 95,
        trueChunks: [
          { value: 20, duration: 1000 },
          { value: 25, duration: 1500 },
          { value: 30, duration: 1200 }
        ],
        falseChunks: [
          { value: 80, duration: 1000 },
          { value: 85, duration: 1300 },
          { value: 90, duration: 900 }
        ]
      }

      const thresholds = findOptimalNumericThresholds(reverseStats)
      
      // When true values (20-30) are lower than false values (80-90),
      // a below threshold strategy would work best (capturing true but not false)
      expect(thresholds.above !== undefined || thresholds.below !== undefined).toBe(true)
      
      // Verify the chosen strategy provides excellent discrimination
      const score = calculateThresholdScore(
        reverseStats.trueChunks!,
        reverseStats.falseChunks!,
        thresholds.above,
        thresholds.below
      )
      expect(score).toBeGreaterThan(0.9)
    })

    it('should find optimal range threshold for overlapping distributions', () => {
      // Create overlapping distributions where a range provides better discrimination
      const overlappingStats: NumericStateStats = {
        isNumeric: true,
        min: 0,
        max: 100,
        trueChunks: [
          { value: 30, duration: 1000 }, // Low end of true range
          { value: 35, duration: 1000 },
          { value: 40, duration: 1000 },
          { value: 45, duration: 1000 }, // High end of true range
          { value: 50, duration: 500 },  // Some overlap
          { value: 25, duration: 800 }   // Some low outliers
        ],
        falseChunks: [
          { value: 10, duration: 1000 }, // Low false values
          { value: 15, duration: 1000 },
          { value: 20, duration: 1000 },
          { value: 60, duration: 1000 }, // High false values
          { value: 65, duration: 1000 },
          { value: 70, duration: 1000 },
          { value: 45, duration: 500 }   // Some overlap in middle
        ]
      }

      const thresholds = findOptimalNumericThresholds(overlappingStats)
      
      // With false values at extremes (10-20, 60-70) and true in middle (25-50),
      // a range threshold (above > ~20, below <= ~55) could work well
      expect(thresholds.above !== undefined || thresholds.below !== undefined).toBe(true)
      
      // Calculate the discrimination score for the found thresholds
      const score = calculateThresholdScore(
        overlappingStats.trueChunks!,
        overlappingStats.falseChunks!,
        thresholds.above,
        thresholds.below
      )
      
      // Should achieve reasonable discrimination despite overlap
      expect(score).toBeGreaterThan(0.3)
    })

    it('should handle identical distributions correctly', () => {
      const identicalStats: NumericStateStats = {
        isNumeric: true,
        min: 50,
        max: 50,
        trueChunks: [
          { value: 50, duration: 1000 },
          { value: 50, duration: 1000 },
          { value: 50, duration: 1000 }
        ],
        falseChunks: [
          { value: 50, duration: 1000 },
          { value: 50, duration: 1000 },
          { value: 50, duration: 1000 }
        ]
      }

      const thresholds = findOptimalNumericThresholds(identicalStats)
      
      // Should still return valid thresholds even if discrimination is impossible
      expect(thresholds).toBeDefined()
      
      // Any threshold should yield zero discrimination
      const score = calculateThresholdScore(
        identicalStats.trueChunks!,
        identicalStats.falseChunks!,
        thresholds.above,
        thresholds.below
      )
      expect(score).toBe(0)
    })

    it('should handle single-value-per-group distributions', () => {
      const singleValueStats: NumericStateStats = {
        isNumeric: true,
        min: 10,
        max: 90,
        trueChunks: [
          { value: 80, duration: 5000 } // Single value, long duration
        ],
        falseChunks: [
          { value: 20, duration: 5000 } // Single value, long duration  
        ]
      }

      const thresholds = findOptimalNumericThresholds(singleValueStats)
      
      // Should find perfect discrimination threshold between 20 and 80
      expect(thresholds.above !== undefined || thresholds.below !== undefined).toBe(true)
      
      if (thresholds.above !== undefined) {
        // For above threshold: true values (80) should be > threshold, false values (20) should be <= threshold
        expect(thresholds.above).toBeGreaterThanOrEqual(20)
        expect(thresholds.above).toBeLessThan(80)
      }
      
      if (thresholds.below !== undefined) {
        // For below threshold: true values (80) should be <= threshold, false values (20) should be > threshold
        // This won't work well since true > false, so below threshold is not optimal here
        expect(thresholds.below).toBeGreaterThan(80)
      }
      
      // Should achieve perfect discrimination
      const score = calculateThresholdScore(
        singleValueStats.trueChunks!,
        singleValueStats.falseChunks!,
        thresholds.above,
        thresholds.below
      )
      expect(score).toBe(1) // Perfect discrimination
    })

    it('should handle multimodal distributions', () => {
      // Complex multimodal distribution
      const multimodalStats: NumericStateStats = {
        isNumeric: true,
        min: 0,
        max: 100,
        trueChunks: [
          // First mode around 20
          { value: 18, duration: 1000 },
          { value: 20, duration: 1500 },
          { value: 22, duration: 1000 },
          // Second mode around 80
          { value: 78, duration: 1000 },
          { value: 80, duration: 1500 },
          { value: 82, duration: 1000 }
        ],
        falseChunks: [
          // Single mode around 50
          { value: 48, duration: 1000 },
          { value: 50, duration: 2000 },
          { value: 52, duration: 1000 },
          { value: 49, duration: 1000 },
          { value: 51, duration: 1000 }
        ]
      }

      const thresholds = findOptimalNumericThresholds(multimodalStats)
      expect(thresholds).toBeDefined()
      
      // Should find some discriminating threshold (multimodal is challenging)
      const score = calculateThresholdScore(
        multimodalStats.trueChunks!,
        multimodalStats.falseChunks!,
        thresholds.above,
        thresholds.below
      )
      expect(score).toBeGreaterThanOrEqual(0.5) // Algorithm finds mathematically optimal result
    })
  })

  describe('Threshold Calculation Edge Cases', () => {
    it('should handle extreme value ranges', () => {
      const extremeStats: NumericStateStats = {
        isNumeric: true,
        min: -1e10,
        max: 1e10,
        trueChunks: [
          { value: -1e10, duration: 1000 },
          { value: 1e10, duration: 1000 }
        ],
        falseChunks: [
          { value: 0, duration: 2000 }
        ]
      }

      const thresholds = findOptimalNumericThresholds(extremeStats)
      expect(thresholds).toBeDefined()
      
      // Should not crash with extreme values
      const score = calculateThresholdScore(
        extremeStats.trueChunks!,
        extremeStats.falseChunks!,
        thresholds.above,
        thresholds.below
      )
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    })

    it('should handle floating point precision edge cases', () => {
      const precisionStats: NumericStateStats = {
        isNumeric: true,
        min: 0.1,
        max: 0.2,
        trueChunks: [
          { value: 0.1000000000000001, duration: 1000 },
          { value: 0.1000000000000002, duration: 1000 }
        ],
        falseChunks: [
          { value: 0.1999999999999999, duration: 1000 },
          { value: 0.2000000000000000, duration: 1000 }
        ]
      }

      const thresholds = findOptimalNumericThresholds(precisionStats)
      expect(thresholds).toBeDefined()
      
      // Should handle floating point precision issues gracefully
      const score = calculateThresholdScore(
        precisionStats.trueChunks!,
        precisionStats.falseChunks!,
        thresholds.above,
        thresholds.below
      )
      expect(score).toBeGreaterThan(0)
    })

    it('should verify threshold score calculation accuracy', () => {
      const chunks1 = [
        { value: 10, duration: 1000 },
        { value: 20, duration: 1000 }
      ]
      const chunks2 = [
        { value: 30, duration: 1000 },
        { value: 40, duration: 1000 }
      ]

      // Test above threshold of 25: values > 25 match
      // chunks1 (10, 20): neither > 25, so 0% match
      // chunks2 (30, 40): both > 25, so 100% match
      const score = calculateThresholdScore(chunks1, chunks2, 25)
      expect(score).toBe(1) // Perfect discrimination: |0% - 100%| = 1.0
      
      // Test below threshold of 25: values <= 25 match
      // chunks1 (10, 20): both <= 25, so 100% match
      // chunks2 (30, 40): neither <= 25, so 0% match
      const score2 = calculateThresholdScore(chunks1, chunks2, undefined, 25)
      expect(score2).toBe(1) // Perfect discrimination: |100% - 0%| = 1.0
      
      // Test above threshold of 15: values > 15 match
      // chunks1 (10, 20): 10 not > 15 (0%), 20 > 15 (50%), so 50% match overall
      // chunks2 (30, 40): both > 15, so 100% match
      const score3 = calculateThresholdScore(chunks1, chunks2, 15)
      expect(score3).toBe(0.5) // |50% - 100%| = 0.5 discrimination
    })

    it('should handle duration-weighted calculations correctly', () => {
      const unbalancedChunks1 = [
        { value: 10, duration: 100 },   // Short duration
        { value: 20, duration: 9900 }   // Long duration
      ]
      const unbalancedChunks2 = [
        { value: 30, duration: 5000 },
        { value: 40, duration: 5000 }
      ]

      const score = calculateThresholdScore(unbalancedChunks1, unbalancedChunks2, 25)
      
      // Should weight by duration - testing above threshold of 25:
      // chunks1: neither 10 nor 20 > 25, so 0% match (duration-weighted)
      // chunks2: both 30 and 40 > 25, so 100% match
      // Score = |0% - 100%| = 1.0 perfect discrimination
      expect(score).toBeCloseTo(1.0, 2)
    })
  })

  describe('Performance and Scalability', () => {
    it('should handle large datasets efficiently', () => {
      // Create large dataset
      const largeStats: NumericStateStats = {
        isNumeric: true,
        min: 0,
        max: 1000,
        trueChunks: Array.from({ length: 1000 }, (_, i) => ({
          value: i * 0.5 + Math.random() * 10,
          duration: 1000
        })),
        falseChunks: Array.from({ length: 1000 }, (_, i) => ({
          value: i * 0.5 + 500 + Math.random() * 10,
          duration: 1000
        }))
      }

      const startTime = Date.now()
      const thresholds = findOptimalNumericThresholds(largeStats)
      const duration = Date.now() - startTime

      expect(thresholds).toBeDefined()
      expect(duration).toBeLessThan(10000) // Should complete within 10 seconds
      
      // Should still find reasonable discrimination
      const score = calculateThresholdScore(
        largeStats.trueChunks!,
        largeStats.falseChunks!,
        thresholds.above,
        thresholds.below
      )
      expect(score).toBeGreaterThan(0.7)
    })

    it('should limit range testing for performance as documented', () => {
      // Test the performance limiting mechanism
      const manyValuesStats: NumericStateStats = {
        isNumeric: true,
        min: 0,
        max: 200,
        // Create many unique values to trigger performance limiting
        trueChunks: Array.from({ length: 100 }, (_, i) => ({
          value: i * 2,
          duration: 1000
        })),
        falseChunks: Array.from({ length: 100 }, (_, i) => ({
          value: i * 2 + 1,
          duration: 1000
        }))
      }

      const startTime = Date.now()
      const thresholds = findOptimalNumericThresholds(manyValuesStats)
      const duration = Date.now() - startTime

      expect(thresholds).toBeDefined()
      // Should complete quickly due to performance limiting
      expect(duration).toBeLessThan(5000) // Should complete within 5 seconds
    })

    it('should maintain accuracy with performance optimizations', () => {
      // Test that performance optimizations don't significantly hurt accuracy
      const testStats: NumericStateStats = {
        isNumeric: true,
        min: 0,
        max: 100,
        trueChunks: Array.from({ length: 50 }, () => ({
          value: 20 + Math.random() * 10, // True values around 20-30
          duration: 1000
        })),
        falseChunks: Array.from({ length: 50 }, () => ({
          value: 70 + Math.random() * 10, // False values around 70-80
          duration: 1000
        }))
      }

      const thresholds = findOptimalNumericThresholds(testStats)
      expect(thresholds).toBeDefined()
      
      // Should still achieve good discrimination despite optimization
      const score = calculateThresholdScore(
        testStats.trueChunks!,
        testStats.falseChunks!,
        thresholds.above,
        thresholds.below
      )
      expect(score).toBeGreaterThan(0.8)
    })
  })

  describe('Chunk Creation Edge Cases', () => {
    it('should handle out-of-order history entries', () => {
      const outOfOrderHistory: HAHistoryEntry[] = [
        {
          entity_id: 'sensor.test',
          state: '30',
          last_changed: '2024-01-01T12:00:00Z', // Later time
          last_updated: '2024-01-01T12:00:00Z',
          attributes: {}
        },
        {
          entity_id: 'sensor.test',
          state: '10',
          last_changed: '2024-01-01T10:00:00Z', // Earlier time
          last_updated: '2024-01-01T10:00:00Z',
          attributes: {}
        },
        {
          entity_id: 'sensor.test',
          state: '20',
          last_changed: '2024-01-01T11:00:00Z', // Middle time
          last_updated: '2024-01-01T11:00:00Z',
          attributes: {}
        }
      ]

      const periods: TimePeriod[] = [{
        id: '1',
        start: new Date('2024-01-01T09:00:00Z'),
        end: new Date('2024-01-01T13:00:00Z'),
        isTruePeriod: true
      }]

      const chunks = createSensorPeriodChunks(outOfOrderHistory, periods)
      
      // The implementation sorts entries internally before processing
      expect(chunks).toBeDefined()
      expect(chunks.length).toBeGreaterThan(0)
      
      // Verify chunks have reasonable durations
      chunks.forEach(chunk => {
        expect(chunk.duration).toBeGreaterThan(1000) // At least 1 second duration
        expect(chunk.sensorValue).toBeDefined()
        expect(chunk.desiredOutput).toBeDefined()
      })
      
      // Verify all the sensor values appear in the chunks
      const values = chunks.map(c => c.sensorValue)
      expect(values).toContain(10)
      expect(values).toContain(20) 
      expect(values).toContain(30)
    })

    it('should handle identical timestamps', () => {
      const identicalTimestamps: HAHistoryEntry[] = [
        {
          entity_id: 'sensor.test',
          state: '10',
          last_changed: '2024-01-01T10:00:00.000Z',
          last_updated: '2024-01-01T10:00:00.000Z',
          attributes: {}
        },
        {
          entity_id: 'sensor.test',
          state: '20',
          last_changed: '2024-01-01T10:00:00.000Z', // Exact same timestamp
          last_updated: '2024-01-01T10:00:00.000Z',
          attributes: {}
        }
      ]

      const periods: TimePeriod[] = [{
        id: '1',
        start: new Date('2024-01-01T09:00:00Z'),
        end: new Date('2024-01-01T11:00:00Z'),
        isTruePeriod: true
      }]

      const chunks = createSensorPeriodChunks(identicalTimestamps, periods)
      expect(chunks).toBeDefined()
      // Should handle identical timestamps gracefully (last one wins)
    })

    it('should handle periods with no overlapping history', () => {
      const historyBeforePeriods: HAHistoryEntry[] = [
        {
          entity_id: 'sensor.test',
          state: '10',
          last_changed: '2024-01-01T08:00:00Z', // Before all periods
          last_updated: '2024-01-01T08:00:00Z',
          attributes: {}
        }
      ]

      const laterPeriods: TimePeriod[] = [{
        id: '1',
        start: new Date('2024-01-01T10:00:00Z'),
        end: new Date('2024-01-01T11:00:00Z'),
        isTruePeriod: true
      }]

      const chunks = createSensorPeriodChunks(historyBeforePeriods, laterPeriods)
      
      // Should create chunks using the last known state
      expect(chunks).toBeDefined()
      if (chunks.length > 0) {
        expect(chunks[0].sensorValue).toBe(10)
      }
    })
  })

  describe('Statistical Edge Cases', () => {
    it('should handle zero variance distributions', () => {
      const constantHistory: HAHistoryEntry[] = [
        { entity_id: 'sensor.constant', state: '42', last_changed: '2024-01-01T10:00:00Z', last_updated: '2024-01-01T10:00:00Z', attributes: {} },
        { entity_id: 'sensor.constant', state: '42', last_changed: '2024-01-01T10:30:00Z', last_updated: '2024-01-01T10:30:00Z', attributes: {} },
        { entity_id: 'sensor.constant', state: '42', last_changed: '2024-01-01T11:00:00Z', last_updated: '2024-01-01T11:00:00Z', attributes: {} }
      ]

      const periods: TimePeriod[] = [{
        id: '1',
        start: new Date('2024-01-01T09:30:00Z'),
        end: new Date('2024-01-01T11:30:00Z'),
        isTruePeriod: true
      }]

      const stats = analyzeNumericStates(constantHistory, periods)
      
      expect(stats.isNumeric).toBe(true)
      expect(stats.min).toBe(42)
      expect(stats.max).toBe(42)
      // All values are identical
    })

    it('should handle very skewed distributions', () => {
      const skewedHistory: HAHistoryEntry[] = [
        // 99 small values
        ...Array.from({ length: 99 }, (_, i) => ({
          entity_id: 'sensor.skewed',
          state: '1',
          last_changed: `2024-01-01T10:${String(i % 60).padStart(2, '0')}:00Z`,
          last_updated: `2024-01-01T10:${String(i % 60).padStart(2, '0')}:00Z`,
          attributes: {}
        })),
        // 1 very large outlier
        {
          entity_id: 'sensor.skewed',
          state: '1000',
          last_changed: '2024-01-01T11:00:00Z',
          last_updated: '2024-01-01T11:00:00Z',
          attributes: {}
        }
      ]

      const periods: TimePeriod[] = [{
        id: '1',
        start: new Date('2024-01-01T10:00:00Z'),
        end: new Date('2024-01-01T12:00:00Z'),
        isTruePeriod: true
      }]

      const stats = analyzeNumericStates(skewedHistory, periods)
      
      expect(stats.isNumeric).toBe(true)
      expect(stats.min).toBe(1)
      expect(stats.max).toBe(1000)
      // Extreme outlier affects min/max but chunks are preserved for threshold optimization
    })
  })
})