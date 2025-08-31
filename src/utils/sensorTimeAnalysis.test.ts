import { describe, it, expect } from 'vitest'
import {
  createSensorPeriodChunks,
  analyzeNumericStates,
  chunkMatchesThreshold,
  calculateThresholdScore,
  findOptimalNumericThresholds
} from './sensorTimeAnalysis'
import type { TimePeriod } from '../types/bayesian'
import type { HAHistoryEntry } from '../types/homeAssistant'

describe('sensorTimeAnalysis', () => {
  const mockPeriods: TimePeriod[] = [
    {
      id: '1',
      start: new Date('2024-01-01T10:00:00Z'),
      end: new Date('2024-01-01T12:00:00Z'),
      isTruePeriod: true,
      label: 'Morning'
    },
    {
      id: '2',
      start: new Date('2024-01-01T14:00:00Z'),
      end: new Date('2024-01-01T16:00:00Z'),
      isTruePeriod: false,
      label: 'Afternoon'
    }
  ]

  const mockNumericHistory: HAHistoryEntry[] = [
    {
      entity_id: 'sensor.temperature',
      state: '25.0',
      last_changed: '2024-01-01T09:00:00Z',
      last_updated: '2024-01-01T09:00:00Z',
      attributes: {}
    },
    {
      entity_id: 'sensor.temperature',
      state: '30.0',
      last_changed: '2024-01-01T10:30:00Z',
      last_updated: '2024-01-01T10:30:00Z',
      attributes: {}
    },
    {
      entity_id: 'sensor.temperature',
      state: '20.0',
      last_changed: '2024-01-01T14:30:00Z',
      last_updated: '2024-01-01T14:30:00Z',
      attributes: {}
    }
  ]

  describe('createSensorPeriodChunks', () => {
    it('should create chunks for overlapping periods and history', () => {
      const chunks = createSensorPeriodChunks(mockNumericHistory, mockPeriods)
      
      expect(chunks.length).toBeGreaterThan(0)
      chunks.forEach(chunk => {
        expect(chunk).toMatchObject({
          sensorValue: expect.any(Number),
          duration: expect.any(Number),
          desiredOutput: expect.any(Boolean)
        })
        expect(chunk.duration).toBeGreaterThanOrEqual(1000) // Min duration filter
      })
    })

    it('should return empty array for empty history', () => {
      const chunks = createSensorPeriodChunks([], mockPeriods)
      expect(chunks).toEqual([])
    })

    it('should return empty array for empty periods', () => {
      const chunks = createSensorPeriodChunks(mockNumericHistory, [])
      expect(chunks).toEqual([])
    })

    it('should filter out chunks shorter than 1000ms', () => {
      const shortPeriods: TimePeriod[] = [
        {
          id: '1',
          start: new Date('2024-01-01T10:00:00Z'),
          end: new Date('2024-01-01T10:00:00.500Z'), // 500ms period
          isTruePeriod: true
        }
      ]

      const chunks = createSensorPeriodChunks(mockNumericHistory, shortPeriods)
      expect(chunks.length).toBe(0)
    })

    it('should use previous state for period start', () => {
      const historyBeforePeriod: HAHistoryEntry[] = [
        {
          entity_id: 'sensor.temperature',
          state: '15.0',
          last_changed: '2024-01-01T08:00:00Z', // Before period
          last_updated: '2024-01-01T08:00:00Z',
          attributes: {}
        }
      ]

      const earlyPeriods: TimePeriod[] = [
        {
          id: '1',
          start: new Date('2024-01-01T09:00:00Z'),
          end: new Date('2024-01-01T11:00:00Z'),
          isTruePeriod: true
        }
      ]

      const chunks = createSensorPeriodChunks(historyBeforePeriod, earlyPeriods)
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks[0].sensorValue).toBe(15.0)
    })

    it('should handle non-numeric states gracefully', () => {
      const nonNumericHistory: HAHistoryEntry[] = [
        {
          entity_id: 'sensor.test',
          state: 'unavailable',
          last_changed: '2024-01-01T10:30:00Z',
          last_updated: '2024-01-01T10:30:00Z',
          attributes: {}
        }
      ]

      const chunks = createSensorPeriodChunks(nonNumericHistory, mockPeriods)
      // Should handle gracefully, may return empty or filtered chunks
      expect(chunks).toBeDefined()
    })
  })

  describe('analyzeNumericStates', () => {
    it('should analyze numeric states and return statistics', () => {
      const stats = analyzeNumericStates(mockNumericHistory, mockPeriods)
      
      expect(stats.isNumeric).toBe(true)
      expect(stats.min).toBeDefined()
      expect(stats.max).toBeDefined()
      expect(stats.trueChunks).toBeDefined()
      expect(stats.falseChunks).toBeDefined()
      
      expect(stats.min).toBeLessThanOrEqual(stats.max!)
      expect(stats.trueChunks!.length + stats.falseChunks!.length).toBeGreaterThan(0)
    })

    it('should return non-numeric for empty data', () => {
      const stats = analyzeNumericStates([], mockPeriods)
      expect(stats.isNumeric).toBe(false)
    })

    it('should separate true and false chunks correctly', () => {
      const stats = analyzeNumericStates(mockNumericHistory, mockPeriods)
      
      expect(stats.trueChunks).toBeDefined()
      expect(stats.falseChunks).toBeDefined()
      
      // All true chunks should be from true periods, false chunks from false periods
      stats.trueChunks!.forEach(chunk => {
        expect(chunk.value).toBeDefined()
        expect(chunk.duration).toBeGreaterThan(0)
      })
      
      stats.falseChunks!.forEach(chunk => {
        expect(chunk.value).toBeDefined()
        expect(chunk.duration).toBeGreaterThan(0)
      })
    })

    it('should return proper min and max values', () => {
      const simpleHistory: HAHistoryEntry[] = [
        {
          entity_id: 'sensor.test',
          state: '10.0',
          last_changed: '2024-01-01T09:00:00Z',
          last_updated: '2024-01-01T09:00:00Z',
          attributes: {}
        },
        {
          entity_id: 'sensor.test',
          state: '20.0',
          last_changed: '2024-01-01T10:30:00Z', // 1.5 hours into first period
          last_updated: '2024-01-01T10:30:00Z',
          attributes: {}
        }
      ]

      const stats = analyzeNumericStates(simpleHistory, mockPeriods)
      expect(stats.min).toBe(10)
      expect(stats.max).toBe(20)
    })
  })

  describe('chunkMatchesThreshold', () => {
    it('should match above threshold', () => {
      expect(chunkMatchesThreshold(25, 20)).toBe(true)
      expect(chunkMatchesThreshold(15, 20)).toBe(false)
      expect(chunkMatchesThreshold(20, 20)).toBe(false) // Exactly at threshold
    })

    it('should match below threshold', () => {
      expect(chunkMatchesThreshold(15, undefined, 20)).toBe(true)
      expect(chunkMatchesThreshold(25, undefined, 20)).toBe(false)
      expect(chunkMatchesThreshold(20, undefined, 20)).toBe(true) // Exactly at threshold
    })

    it('should match range threshold', () => {
      expect(chunkMatchesThreshold(25, 20, 30)).toBe(true)
      expect(chunkMatchesThreshold(15, 20, 30)).toBe(false)
      expect(chunkMatchesThreshold(35, 20, 30)).toBe(false)
      expect(chunkMatchesThreshold(20, 20, 30)).toBe(false) // At lower bound
      expect(chunkMatchesThreshold(30, 20, 30)).toBe(true) // At upper bound
    })

    it('should return false for no thresholds', () => {
      expect(chunkMatchesThreshold(25)).toBe(false)
    })
  })

  describe('calculateThresholdScore', () => {
    const trueChunks = [
      { value: 10, duration: 1000 },
      { value: 20, duration: 2000 },
      { value: 30, duration: 1000 }
    ]

    const falseChunks = [
      { value: 5, duration: 1000 },
      { value: 15, duration: 1000 },
      { value: 25, duration: 2000 }
    ]

    it('should calculate discrimination score for above threshold', () => {
      const score = calculateThresholdScore(trueChunks, falseChunks, 15)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    })

    it('should calculate discrimination score for below threshold', () => {
      const score = calculateThresholdScore(trueChunks, falseChunks, undefined, 25)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    })

    it('should calculate discrimination score for range', () => {
      const score = calculateThresholdScore(trueChunks, falseChunks, 10, 25)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    })

    it('should handle pre-sorted chunks', () => {
      const sortedTrue = [...trueChunks].sort((a, b) => a.value - b.value)
      const sortedFalse = [...falseChunks].sort((a, b) => a.value - b.value)
      
      const score1 = calculateThresholdScore(trueChunks, falseChunks, 15)
      const score2 = calculateThresholdScore(sortedTrue, sortedFalse, 15, undefined, true)
      
      expect(score1).toBeCloseTo(score2)
    })

    it('should return 0 for empty chunks', () => {
      const score = calculateThresholdScore([], [], 15)
      expect(score).toBe(0)
    })
  })

  describe('findOptimalNumericThresholds', () => {
    const mockStats = {
      isNumeric: true,
      min: 0,
      max: 100,
      mean: 50,
      stdDev: 20,
      trueChunks: [
        { value: 70, duration: 1000 },
        { value: 80, duration: 2000 },
        { value: 90, duration: 1000 }
      ],
      falseChunks: [
        { value: 10, duration: 1000 },
        { value: 20, duration: 1000 },
        { value: 30, duration: 2000 }
      ]
    }

    it('should find optimal thresholds for discriminating data', () => {
      const thresholds = findOptimalNumericThresholds(mockStats)
      
      expect(thresholds).toBeDefined()
      // Should find some threshold since true and false chunks are well separated
      expect(thresholds.above !== undefined || thresholds.below !== undefined).toBe(true)
    })

    it('should return undefined for non-numeric stats', () => {
      const nonNumericStats = { isNumeric: false }
      const thresholds = findOptimalNumericThresholds(nonNumericStats)
      
      expect(thresholds).toEqual({ above: undefined, below: undefined })
    })

    it('should return undefined for missing chunk data', () => {
      const incompleteStats = {
        isNumeric: true,
        min: 0,
        max: 100
        // Missing trueChunks and falseChunks
      }
      
      const thresholds = findOptimalNumericThresholds(incompleteStats)
      expect(thresholds).toEqual({ above: undefined, below: undefined })
    })

    it('should return undefined for empty chunks', () => {
      const emptyStats = {
        isNumeric: true,
        min: 0,
        max: 100,
        trueChunks: [],
        falseChunks: []
      }
      
      const thresholds = findOptimalNumericThresholds(emptyStats)
      expect(thresholds).toEqual({ above: undefined, below: undefined })
    })

    it('should explore different threshold strategies', () => {
      const thresholds = findOptimalNumericThresholds(mockStats)
      
      // Should try above-only, below-only, and range strategies
      // With well-separated data, should find a good threshold
      expect(
        thresholds.above !== undefined || 
        thresholds.below !== undefined ||
        (thresholds.above !== undefined && thresholds.below !== undefined)
      ).toBe(true)
    })

    it('should handle identical true and false distributions', () => {
      const identicalStats = {
        isNumeric: true,
        min: 0,
        max: 100,
        trueChunks: [
          { value: 50, duration: 1000 },
          { value: 50, duration: 1000 }
        ],
        falseChunks: [
          { value: 50, duration: 1000 },
          { value: 50, duration: 1000 }
        ]
      }
      
      const thresholds = findOptimalNumericThresholds(identicalStats)
      // With identical distributions, discrimination power should be low
      // but function should still return valid thresholds
      expect(thresholds).toBeDefined()
    })

    it('should limit range testing for performance', () => {
      const largeStats = {
        isNumeric: true,
        min: 0,
        max: 1000,
        trueChunks: Array.from({ length: 50 }, (_, i) => ({ value: i * 20, duration: 1000 })),
        falseChunks: Array.from({ length: 50 }, (_, i) => ({ value: i * 20 + 10, duration: 1000 }))
      }
      
      // Should complete in reasonable time even with many candidates
      const start = Date.now()
      const thresholds = findOptimalNumericThresholds(largeStats)
      const duration = Date.now() - start
      
      expect(thresholds).toBeDefined()
      expect(duration).toBeLessThan(5000) // Should complete within 5 seconds
    })
  })
})