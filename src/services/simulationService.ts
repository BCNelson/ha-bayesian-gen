import SimulationWorker from '../workers/simulationWorker?worker'
import type { BayesianObservation } from '../types/bayesian'
import type { SimulationSummary } from './cachedBayesianSimulator'

interface SimulationTask {
  id: string
  resolve: (result: SimulationSummary) => void
  reject: (error: Error) => void
}

export class SimulationService {
  private worker: Worker | null = null
  private activeTasks = new Map<string, SimulationTask>()
  private nextTaskId = 0

  private ensureWorker() {
    if (!this.worker) {
      this.worker = new SimulationWorker()
      this.worker.onmessage = this.handleWorkerMessage.bind(this)
      this.worker.onerror = this.handleWorkerError.bind(this)
    }
  }

  private handleWorkerMessage(e: MessageEvent) {
    const { type, id, data, error } = e.data
    const task = this.activeTasks.get(id)
    
    if (!task) return

    this.activeTasks.delete(id)

    if (type === 'SIMULATION_RESULT') {
      task.resolve(data)
    } else if (type === 'SIMULATION_ERROR') {
      task.reject(new Error(error))
    }
  }

  private handleWorkerError(error: ErrorEvent) {
    console.error('Simulation worker error:', error)
    // Reject all pending tasks
    for (const task of this.activeTasks.values()) {
      task.reject(new Error('Worker error occurred'))
    }
    this.activeTasks.clear()
    
    // Terminate and recreate worker
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
  }

  async simulate(
    prior: number,
    threshold: number,
    observations: BayesianObservation[],
    cachedData: Map<string, any[]>,
    timeRange: { start: Date; end: Date },
    sampleIntervalMinutes: number = 5
  ): Promise<SimulationSummary> {
    this.ensureWorker()
    
    return new Promise((resolve, reject) => {
      const taskId = `sim_${this.nextTaskId++}`
      
      // Convert Map to object for worker transfer
      const cachedDataObj = Object.fromEntries(cachedData.entries())
      
      const task = { id: taskId, resolve, reject }
      this.activeTasks.set(taskId, task)
      
      this.worker!.postMessage({
        type: 'SIMULATE',
        id: taskId,
        data: {
          prior,
          threshold,
          observations,
          cachedData: cachedDataObj,
          timeRange: {
            start: timeRange.start.toISOString(),
            end: timeRange.end.toISOString()
          },
          sampleIntervalMinutes
        }
      })
    })
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.activeTasks.clear()
  }
}