import SimulationWorker from '../workers/simulationWorker?worker'
import type { BayesianObservation } from '../types/bayesian'
import type { SimulationSummary } from './cachedBayesianSimulator'
import type { EntityBufferMetadata } from './entityBuffer'

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

  /**
   * NEW: Efficient simulation using pre-compressed buffers
   */
  async simulateWithBuffers(
    prior: number,
    threshold: number,
    observations: BayesianObservation[],
    buffers: ArrayBuffer[],
    metadata: EntityBufferMetadata[],
    timeRange: { start: Date; end: Date },
    sampleIntervalMinutes: number = 5
  ): Promise<SimulationSummary> {
    this.ensureWorker()
    
    return new Promise((resolve, reject) => {
      const taskId = `sim_${this.nextTaskId++}`
      
      const task = { id: taskId, resolve, reject }
      this.activeTasks.set(taskId, task)
      
      try {
        // Convert ArrayBuffers to Uint8Arrays for safe transfer
        const bufferData = buffers.map(buffer => new Uint8Array(buffer))
        
        // Sanitize observations for cloning
        const sanitizedObservations = observations.map(obs => {
          // DEBUG: Only log our target entity or all if target is selected
          const targetEntity = 'sensor.0xe406bffffe000eea_pm25'
          const hasTargetEntity = observations.some(o => o.entity_id === targetEntity)
          
          if (!hasTargetEntity || obs.entity_id === targetEntity) {
            console.log(`SIMULATION DEBUG - ${obs.entity_id} observation:`, {
              prob_given_true: obs.prob_given_true,
              prob_given_false: obs.prob_given_false,
              platform: obs.platform
            })
          }
          
          return {
            entity_id: obs.entity_id,
            platform: obs.platform,
            prob_given_true: obs.prob_given_true,
            prob_given_false: obs.prob_given_false,
            to_state: obs.to_state,
            above: obs.above,
            below: obs.below
          }
        })
        
        // Sanitize metadata for cloning  
        const sanitizedMetadata = metadata.map(meta => ({
          entityId: meta.entityId,
          pointCount: meta.pointCount,
          startTime: meta.startTime,
          endTime: meta.endTime,
          stateMap: { ...meta.stateMap }
        }))
        
        // Create final message
        const finalMessage = {
          type: 'SIMULATE_WITH_BUFFERS',
          id: taskId,
          data: {
            prior,
            threshold,
            observations: sanitizedObservations,
            metadata: sanitizedMetadata,
            bufferData,
            timeRange: {
              start: timeRange.start.toISOString(),
              end: timeRange.end.toISOString()
            },
            sampleIntervalMinutes
          }
        }
        
        this.worker!.postMessage(finalMessage)
      } catch (error) {
        console.error('Failed to prepare buffer simulation data:', error)
        throw error
      }
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