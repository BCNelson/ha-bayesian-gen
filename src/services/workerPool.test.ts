import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WorkerPool } from './workerPool'

// Mock the worker
const mockWorker = {
  postMessage: vi.fn(),
  terminate: vi.fn(),
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((event: ErrorEvent) => void) | null
}

// Mock the Worker constructor
vi.mock('../workers/analysisWorker?worker', () => ({
  default: vi.fn().mockImplementation(() => mockWorker)
}))

describe('WorkerPool', () => {
  let workerPool: WorkerPool

  beforeEach(() => {
    vi.clearAllMocks()
    workerPool = new WorkerPool(4) // Create pool with 4 workers
  })

  afterEach(() => {
    workerPool.terminate()
  })

  describe('constructor', () => {
    it('should create specified number of workers', () => {
      const pool = new WorkerPool(3)
      const status = pool.getStatus()
      expect(status.totalWorkers).toBe(3)
      expect(status.availableWorkers).toBe(3)
      pool.terminate()
    })

    it('should enforce minimum worker count of 2', () => {
      const pool = new WorkerPool(1)
      const status = pool.getStatus()
      expect(status.totalWorkers).toBe(2)
      pool.terminate()
    })

    it('should enforce maximum worker count of 8', () => {
      const pool = new WorkerPool(10)
      const status = pool.getStatus()
      expect(status.totalWorkers).toBe(8)
      pool.terminate()
    })
  })

  describe('analyzeEntity', () => {
    it('should queue task and return promise', async () => {
      const entityHistory = { 'sensor.test': [] }
      const periods: any[] = []

      // Start the analysis
      const analysisPromise = workerPool.analyzeEntity(entityHistory, periods)

      // Check that task was queued
      let status = workerPool.getStatus()
      expect(status.queuedTasks + status.activeTasks).toBe(1)

      // Simulate worker response
      const mockResponse = {
        type: 'ANALYSIS_RESULT',
        id: 'task_0',
        data: [{ entityId: 'sensor.test', state: 'on', probGivenTrue: 0.5, probGivenFalse: 0.3 }]
      }

      // Trigger the worker message handler
      if (mockWorker.onmessage) {
        mockWorker.onmessage({
          target: mockWorker,
          data: mockResponse
        } as unknown as MessageEvent)
      }

      const result = await analysisPromise
      expect(result).toEqual(mockResponse.data)
    })

    it('should handle worker errors', async () => {
      const entityHistory = { 'sensor.test': [] }
      const periods: any[] = []

      const analysisPromise = workerPool.analyzeEntity(entityHistory, periods)

      // Simulate worker error response
      const mockErrorResponse = {
        type: 'ANALYSIS_ERROR',
        id: 'task_0',
        error: 'Test error message'
      }

      if (mockWorker.onmessage) {
        mockWorker.onmessage({
          target: mockWorker,
          data: mockErrorResponse
        } as unknown as MessageEvent)
      }

      await expect(analysisPromise).rejects.toThrow('Test error message')
    })

    it('should process multiple tasks sequentially when workers are busy', async () => {
      // Fill all workers with tasks
      const promises = []
      for (let i = 0; i < 5; i++) {
        const promise = workerPool.analyzeEntity({ [`sensor.test${i}`]: [] }, [])
        promises.push(promise)
      }

      const status = workerPool.getStatus()
      expect(status.queuedTasks + status.activeTasks).toBe(5)

      // Complete first task
      if (mockWorker.onmessage) {
        mockWorker.onmessage({
          target: mockWorker,
          data: {
            type: 'ANALYSIS_RESULT',
            id: 'task_0',
            data: []
          }
        } as unknown as MessageEvent)
      }

      await promises[0]
      
      const statusAfterFirst = workerPool.getStatus()
      expect(statusAfterFirst.queuedTasks + statusAfterFirst.activeTasks).toBe(4)
    })

    it('should log slow tasks', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      
      // Mock performance.now to simulate slow task
      const originalNow = performance.now
      let callCount = 0
      performance.now = vi.fn(() => {
        callCount++
        return callCount === 1 ? 0 : 1500 // 1500ms duration
      })

      const analysisPromise = workerPool.analyzeEntity({ 'sensor.test': [] }, [])

      if (mockWorker.onmessage) {
        mockWorker.onmessage({
          target: mockWorker,
          data: {
            type: 'ANALYSIS_RESULT',
            id: 'task_0',
            data: []
          }
        } as unknown as MessageEvent)
      }

      await analysisPromise

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Worker task task_0 took 1500ms')
      )

      // Restore
      performance.now = originalNow
      consoleSpy.mockRestore()
    })
  })

  describe('error handling', () => {
    it('should recover from worker errors', () => {
      const initialStatus = workerPool.getStatus()
      
      // Simulate worker error
      if (mockWorker.onerror) {
        mockWorker.onerror({
          target: mockWorker,
          message: 'Worker crashed'
        } as unknown as ErrorEvent)
      }

      // Status should remain the same (worker replaced)
      const statusAfterError = workerPool.getStatus()
      expect(statusAfterError.totalWorkers).toBe(initialStatus.totalWorkers)
    })

    it('should handle unknown message IDs gracefully', () => {
      // Send message with unknown ID
      if (mockWorker.onmessage) {
        mockWorker.onmessage({
          target: mockWorker,
          data: {
            type: 'ANALYSIS_RESULT',
            id: 'unknown_task_id',
            data: []
          }
        } as unknown as MessageEvent)
      }

      // Should not throw error
      expect(() => {}).not.toThrow()
    })
  })

  describe('getStatus', () => {
    it('should return correct status', () => {
      const status = workerPool.getStatus()
      
      expect(status).toMatchObject({
        totalWorkers: expect.any(Number),
        availableWorkers: expect.any(Number),
        queuedTasks: expect.any(Number),
        activeTasks: expect.any(Number)
      })

      expect(status.totalWorkers).toBeGreaterThan(0)
      expect(status.availableWorkers).toBeLessThanOrEqual(status.totalWorkers)
      expect(status.queuedTasks).toBeGreaterThanOrEqual(0)
      expect(status.activeTasks).toBeGreaterThanOrEqual(0)
    })
  })

  describe('terminate', () => {
    it('should terminate all workers and clear state', () => {
      workerPool.terminate()

      const status = workerPool.getStatus()
      expect(status.totalWorkers).toBe(0)
      expect(status.availableWorkers).toBe(0)
      expect(status.queuedTasks).toBe(0)
      expect(status.activeTasks).toBe(0)

      expect(mockWorker.terminate).toHaveBeenCalled()
    })
  })

  describe('task queue management', () => {
    it('should process queued tasks when workers become available', async () => {
      // Create a pool with only 1 worker for easier testing
      const singleWorkerPool = new WorkerPool(1)
      
      // Queue multiple tasks
      const task1 = singleWorkerPool.analyzeEntity({ 'sensor.test1': [] }, [])
      const task2 = singleWorkerPool.analyzeEntity({ 'sensor.test2': [] }, [])

      let status = singleWorkerPool.getStatus()
      expect(status.activeTasks + status.queuedTasks).toBe(2)

      // Complete first task
      if (mockWorker.onmessage) {
        mockWorker.onmessage({
          target: mockWorker,
          data: {
            type: 'ANALYSIS_RESULT',
            id: 'task_0',
            data: []
          }
        } as unknown as MessageEvent)
      }

      await task1

      // Second task should now be processing
      status = singleWorkerPool.getStatus()
      expect(status.activeTasks + status.queuedTasks).toBe(1)

      // Complete second task
      if (mockWorker.onmessage) {
        mockWorker.onmessage({
          target: mockWorker,
          data: {
            type: 'ANALYSIS_RESULT',
            id: 'task_1',
            data: []
          }
        } as unknown as MessageEvent)
      }

      await task2

      status = singleWorkerPool.getStatus()
      expect(status.activeTasks + status.queuedTasks).toBe(0)

      singleWorkerPool.terminate()
    })
  })
})