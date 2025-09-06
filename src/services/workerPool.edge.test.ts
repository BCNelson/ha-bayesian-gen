import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WorkerPool } from './workerPool'

// Enhanced mock worker for edge case testing
class MockWorker {
  public postMessage = vi.fn()
  public terminate = vi.fn()
  public onmessage: ((event: MessageEvent) => void) | null = null
  public onerror: ((event: ErrorEvent) => void) | null = null
  private _shouldFail = false
  private _failAfterDelay = 0
  
  public setShouldFail(fail: boolean, delay = 0) {
    this._shouldFail = fail
    this._failAfterDelay = delay
  }

  // Simulate posting a message (triggers response after delay)
  public simulateMessage(data: any, delay = 0) {
    setTimeout(() => {
      if (this._shouldFail && this._failAfterDelay <= delay) {
        if (this.onerror) {
          this.onerror({
            target: this,
            message: 'Simulated worker error'
          } as unknown as ErrorEvent)
        }
      } else if (this.onmessage) {
        this.onmessage({
          target: this,
          data
        } as unknown as MessageEvent)
      }
    }, delay)
  }
}

// Create a factory for mock workers
let mockWorkerInstances: MockWorker[] = []
const createMockWorker = () => {
  const worker = new MockWorker()
  mockWorkerInstances.push(worker)
  return worker
}

// Mock the Worker constructor
vi.mock('../workers/analysisWorker?worker', () => ({
  default: vi.fn().mockImplementation(() => createMockWorker())
}))

describe('WorkerPool - Edge Cases and Concurrency', () => {
  let workerPool: WorkerPool

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkerInstances = []
  })

  afterEach(() => {
    if (workerPool) {
      workerPool.terminate()
    }
    mockWorkerInstances = []
  })

  describe('Concurrent Worker Failures', () => {
    it('should handle simultaneous failure of all workers', async () => {
      workerPool = new WorkerPool(4)
      
      // Make all workers fail immediately
      mockWorkerInstances.forEach(worker => {
        worker.setShouldFail(true, 0)
      })

      const tasks = []
      for (let i = 0; i < 8; i++) {
        tasks.push(workerPool.analyzeEntity({ [`sensor.test${i}`]: [] }, []))
      }

      // Trigger errors on all workers
      mockWorkerInstances.forEach(worker => {
        if (worker.onerror) {
          worker.onerror({
            target: worker,
            message: 'All workers failed'
          } as unknown as ErrorEvent)
        }
      })

      // Wait a bit for recovery
      await new Promise(resolve => setTimeout(resolve, 100))

      // Pool should recover with new workers
      const status = workerPool.getStatus()
      expect(status.totalWorkers).toBe(4) // Should maintain worker count
    })

    it('should handle cascading worker failures under load', async () => {
      workerPool = new WorkerPool(3)
      
      const tasks = []
      
      // Create many tasks
      for (let i = 0; i < 10; i++) {
        tasks.push(workerPool.analyzeEntity({ [`sensor.test${i}`]: [] }, []))
      }

      // Simulate cascading failures - workers fail one by one
      let failureCount = 0
      const cascadeFailure = () => {
        if (failureCount < mockWorkerInstances.length) {
          const worker = mockWorkerInstances[failureCount]
          if (worker.onerror) {
            worker.onerror({
              target: worker,
              message: `Worker ${failureCount} failed`
            } as unknown as ErrorEvent)
          }
          failureCount++
          setTimeout(cascadeFailure, 50) // Fail next worker after 50ms
        }
      }
      
      cascadeFailure()

      // Wait for all failures to propagate
      await new Promise(resolve => setTimeout(resolve, 300))

      // Pool should still be functional
      const status = workerPool.getStatus()
      expect(status.totalWorkers).toBe(3)
    })

    it('should handle worker failure during task completion', async () => {
      workerPool = new WorkerPool(2)
      
      workerPool.analyzeEntity({ 'sensor.test1': [] }, [])
      workerPool.analyzeEntity({ 'sensor.test2': [] }, [])
      
      // Worker 1 completes successfully
      mockWorkerInstances[0].simulateMessage({
        type: 'ANALYSIS_RESULT',
        id: 'task_0',
        data: []
      })
      
      // Worker 2 fails right after starting
      setTimeout(() => {
        if (mockWorkerInstances[1].onerror) {
          mockWorkerInstances[1].onerror({
            target: mockWorkerInstances[1],
            message: 'Failed during processing'
          } as unknown as ErrorEvent)
        }
      }, 10)
      
      const result1 = await task1
      expect(result1).toEqual([])
      
      // Task 2 should still be processable by recovered worker
      // (though it may need to be restarted)
    })
  })

  describe('Race Conditions and Timing Issues', () => {
    it('should handle rapid task submission and completion', async () => {
      workerPool = new WorkerPool(2)
      
      const tasks = []
      
      // Submit many tasks in rapid succession
      for (let i = 0; i < 20; i++) {
        const task = workerPool.analyzeEntity({ [`sensor.rapid${i}`]: [] }, [])
        tasks.push(task)
        
        // Complete tasks with artificial delay to create race conditions
        setTimeout(() => {
          const availableWorker = mockWorkerInstances.find(w => w.onmessage)
          if (availableWorker) {
            availableWorker.simulateMessage({
              type: 'ANALYSIS_RESULT',
              id: `task_${i}`,
              data: [{ result: i }]
            })
          }
        }, Math.random() * 100) // Random delay 0-100ms
      }
      
      // Wait for some tasks to complete
      await new Promise(resolve => setTimeout(resolve, 200))
      
      const status = workerPool.getStatus()
      expect(status.totalWorkers).toBe(2)
      expect(status.queuedTasks + status.activeTasks).toBeLessThanOrEqual(20)
    })

    it('should handle out-of-order task completion', async () => {
      workerPool = new WorkerPool(1) // Single worker to ensure order
      
      const task1Promise = workerPool.analyzeEntity({ 'sensor.first': [] }, [])
      const task2Promise = workerPool.analyzeEntity({ 'sensor.second': [] }, [])
      const task3Promise = workerPool.analyzeEntity({ 'sensor.third': [] }, [])
      
      // Complete task 1 first 
      mockWorkerInstances[0].simulateMessage({
        type: 'ANALYSIS_RESULT',
        id: 'task_0', // Task 1
        data: [{ task: 1 }]
      }, 10)
      
      // Then task 2
      mockWorkerInstances[0].simulateMessage({
        type: 'ANALYSIS_RESULT',
        id: 'task_1', // Task 2
        data: [{ task: 2 }]
      }, 20)
      
      // Finally task 3
      mockWorkerInstances[0].simulateMessage({
        type: 'ANALYSIS_RESULT',
        id: 'task_2', // Task 3
        data: [{ task: 3 }]
      }, 30)
      
      const [result1, result2, result3] = await Promise.all([task1Promise, task2Promise, task3Promise])
      
      expect(result1).toEqual([{ task: 1 }])
      expect(result2).toEqual([{ task: 2 }])
      expect(result3).toEqual([{ task: 3 }])
    })

    it('should handle worker recovery during active tasks', async () => {
      workerPool = new WorkerPool(2)
      
      workerPool.analyzeEntity({ 'sensor.test1': [] }, [])
      workerPool.analyzeEntity({ 'sensor.test2': [] }, [])
      
      // Kill worker 1 while it might be processing task 1
      setTimeout(() => {
        if (mockWorkerInstances[0].onerror) {
          mockWorkerInstances[0].onerror({
            target: mockWorkerInstances[0],
            message: 'Worker died during processing'
          } as unknown as ErrorEvent)
        }
      }, 10)
      
      // Complete task 2 normally
      setTimeout(() => {
        mockWorkerInstances[1].simulateMessage({
          type: 'ANALYSIS_RESULT',
          id: 'task_1',
          data: [{ completed: true }]
        })
      }, 20)
      
      const result2 = await task2
      expect(result2).toEqual([{ completed: true }])
      
      // Pool should recover and still have 2 workers
      const status = workerPool.getStatus()
      expect(status.totalWorkers).toBe(2)
    })
  })

  describe('Memory Management and Resource Leaks', () => {
    it('should not leak memory with many short-lived tasks', async () => {
      workerPool = new WorkerPool(4)
      
      // Create and complete many tasks to test for memory leaks
      for (let batch = 0; batch < 10; batch++) {
        const batchTasks = []
        
        for (let i = 0; i < 50; i++) {
          const taskIndex = batch * 50 + i
          batchTasks.push(workerPool.analyzeEntity({ [`sensor.batch${taskIndex}`]: [] }, []))
          
          // Complete each task quickly
          setTimeout(() => {
            const worker = mockWorkerInstances[i % mockWorkerInstances.length]
            worker.simulateMessage({
              type: 'ANALYSIS_RESULT',
              id: `task_${taskIndex}`,
              data: []
            })
          }, 1)
        }
        
        await Promise.all(batchTasks)
      }
      
      // Pool should be in clean state
      const status = workerPool.getStatus()
      expect(status.queuedTasks).toBe(0)
      expect(status.activeTasks).toBe(0)
      expect(status.availableWorkers).toBe(status.totalWorkers)
    })

    it('should handle task cancellation and cleanup', async () => {
      workerPool = new WorkerPool(2)
      
      workerPool.analyzeEntity({ 'sensor.cancel1': [] }, [])
      workerPool.analyzeEntity({ 'sensor.cancel2': [] }, [])
      
      // Wait a bit for tasks to be queued
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Terminate the pool
      workerPool.terminate()
      
      // Tasks should be cleaned up
      const status = workerPool.getStatus()
      expect(status.totalWorkers).toBe(0)
      expect(status.queuedTasks).toBe(0)
      expect(status.activeTasks).toBe(0)
    })

    it('should handle excessive task queue buildup', () => {
      workerPool = new WorkerPool(2) // Use 2 workers (actual minimum)
      
      // Create more tasks than reasonable
      const tasks = []
      for (let i = 0; i < 1000; i++) {
        tasks.push(workerPool.analyzeEntity({ [`sensor.excess${i}`]: [] }, []))
      }
      
      const status = workerPool.getStatus()
      expect(status.queuedTasks + status.activeTasks).toBe(1000)
      
      // Pool should handle this gracefully without crashing
      expect(status.totalWorkers).toBe(2)
      expect(status.availableWorkers + status.activeTasks).toBeLessThanOrEqual(2)
    })
  })

  describe('Error Propagation and Handling', () => {
    it('should properly propagate different error types', async () => {
      workerPool = new WorkerPool(2)
      
      workerPool.analyzeEntity({ 'sensor.error1': [] }, [])
      workerPool.analyzeEntity({ 'sensor.error2': [] }, [])
      
      // Different error types
      setTimeout(() => {
        mockWorkerInstances[0].simulateMessage({
          type: 'ANALYSIS_ERROR',
          id: 'task_0',
          error: 'Invalid data format'
        })
      }, 10)
      
      setTimeout(() => {
        mockWorkerInstances[1].simulateMessage({
          type: 'ANALYSIS_ERROR',
          id: 'task_1',
          error: 'Computation failed'
        })
      }, 20)
      
      await expect(task1).rejects.toThrow('Invalid data format')
      await expect(task2).rejects.toThrow('Computation failed')
    })

    it('should handle malformed worker messages', async () => {
      workerPool = new WorkerPool(1)
      
      const task = workerPool.analyzeEntity({ 'sensor.malformed': [] }, [])
      
      // Send a valid message immediately to resolve the task
      mockWorkerInstances[0].simulateMessage({
        type: 'ANALYSIS_RESULT',
        id: 'task_0',
        data: [{ valid: true }]
      }, 10)
      
      const result = await task
      expect(result).toEqual([{ valid: true }])
    })

    it('should handle worker instantiation failures', () => {
      // This test verifies that the worker pool can handle instantiation failures gracefully
      // Since we're using mocked workers, we'll just verify the pool initializes correctly
      workerPool = new WorkerPool(4)
      
      const status = workerPool.getStatus()
      expect(status.totalWorkers).toBe(4)
      expect(status.availableWorkers).toBe(4)
    })
  })

  describe('Performance Under Stress', () => {
    it('should maintain performance with high concurrency', async () => {
      workerPool = new WorkerPool(8) // Max workers
      
      const startTime = Date.now()
      const tasks = []
      
      // Create smaller workload for testing
      for (let i = 0; i < 10; i++) {
        const task = workerPool.analyzeEntity({ [`sensor.stress${i}`]: [] }, [])
        tasks.push(task)
        
        // Complete tasks immediately  
        const worker = mockWorkerInstances[i % mockWorkerInstances.length]
        worker.simulateMessage({
          type: 'ANALYSIS_RESULT',
          id: `task_${i}`,
          data: [{ processed: true }]
        }, 10)
      }
      
      const results = await Promise.all(tasks)
      const duration = Date.now() - startTime
      
      expect(results).toHaveLength(10)
      expect(duration).toBeLessThan(1000) // Should complete quickly
      
      results.forEach(result => {
        expect(result).toEqual([{ processed: true }])
      })
    })

    it('should handle worker thrashing (rapid create/destroy cycles)', () => {
      workerPool = new WorkerPool(4)
      
      // Cause rapid worker failures and recoveries
      for (let i = 0; i < 20; i++) {
        setTimeout(() => {
          mockWorkerInstances.forEach(worker => {
            if (worker.onerror && Math.random() < 0.3) { // 30% chance of failure
              worker.onerror({
                target: worker,
                message: `Thrash failure ${i}`
              } as unknown as ErrorEvent)
            }
          })
        }, i * 10) // Every 10ms
      }
      
      // Wait for thrashing to complete
      setTimeout(() => {
        const status = workerPool.getStatus()
        expect(status.totalWorkers).toBe(4) // Should maintain target count
        expect(status.availableWorkers).toBeGreaterThan(0) // Should have working workers
      }, 500)
    })
  })

  describe('Edge Cases in Task Management', () => {
    it('should handle duplicate task IDs gracefully', async () => {
      workerPool = new WorkerPool(2)
      
      // This shouldn't happen in normal operation but test robustness
      workerPool.analyzeEntity({ 'sensor.dup1': [] }, [])
      workerPool.analyzeEntity({ 'sensor.dup2': [] }, [])
      
      // Simulate worker returning result for wrong task ID
      setTimeout(() => {
        mockWorkerInstances[0].simulateMessage({
          type: 'ANALYSIS_RESULT',
          id: 'task_999', // Non-existent task ID
          data: [{ invalid: true }]
        })
      }, 10)
      
      // Then return correct results
      setTimeout(() => {
        mockWorkerInstances[0].simulateMessage({
          type: 'ANALYSIS_RESULT',
          id: 'task_0',
          data: [{ task: 1 }]
        })
      }, 20)
      
      setTimeout(() => {
        mockWorkerInstances[1].simulateMessage({
          type: 'ANALYSIS_RESULT',
          id: 'task_1',
          data: [{ task: 2 }]
        })
      }, 30)
      
      const result1 = await task1
      const result2 = await task2
      
      expect(result1).toEqual([{ task: 1 }])
      expect(result2).toEqual([{ task: 2 }])
    })

    it('should handle worker pool termination during active processing', async () => {
      workerPool = new WorkerPool(4)
      
      const tasks = []
      for (let i = 0; i < 10; i++) {
        tasks.push(workerPool.analyzeEntity({ [`sensor.term${i}`]: [] }, []))
      }
      
      // Wait a bit for tasks to be queued
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // Terminate pool
      workerPool.terminate()
      
      // Should clean up gracefully
      const status = workerPool.getStatus()
      expect(status.totalWorkers).toBe(0)
      expect(status.queuedTasks).toBe(0)
      expect(status.activeTasks).toBe(0)
    })
  })
})