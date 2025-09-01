import { CachedBayesianSimulator } from '../services/cachedBayesianSimulator'
import { BufferBayesianSimulator } from '../services/bufferBayesianSimulator'
import type { BayesianObservation } from '../types/bayesian'
import type { SimulationSummary } from '../services/cachedBayesianSimulator'
import type { EntityBufferMetadata } from '../services/entityBuffer'

interface SimulationWorkerMessage {
  type: 'SIMULATE' | 'SIMULATE_WITH_BUFFERS'
  id: string
  data: {
    prior: number
    threshold: number
    observations: BayesianObservation[]
    cachedData?: Record<string, any[]>
    metadata?: EntityBufferMetadata[]
    bufferData?: Uint8Array[] // For buffer-based simulation
    timeRange: { start: string; end: string }
    sampleIntervalMinutes: number
  }
}

interface SimulationWorkerResponse {
  type: 'SIMULATION_RESULT' | 'SIMULATION_ERROR'
  id: string
  data?: SimulationSummary
  error?: string
}

self.onmessage = function(e: MessageEvent<SimulationWorkerMessage>) {
  const { type, data, id } = e.data

  try {
    if (type === 'SIMULATE') {
      // Legacy simulation with object data
      const { prior, threshold, observations, cachedData, timeRange, sampleIntervalMinutes } = data
      
      if (!cachedData) {
        throw new Error('cachedData is required for SIMULATE type')
      }
      
      // Convert cached data back to Map
      const cachedDataMap = new Map<string, any[]>(Object.entries(cachedData))
      
      // Convert string dates back to Date objects
      const periods = {
        start: new Date(timeRange.start),
        end: new Date(timeRange.end)
      }
      
      // Create simulator and run simulation
      const simulator = new CachedBayesianSimulator(
        prior,
        threshold,
        observations,
        cachedDataMap,
        periods
      )
      
      const result = simulator.simulate(sampleIntervalMinutes)
      
      const response: SimulationWorkerResponse = {
        type: 'SIMULATION_RESULT',
        id,
        data: result
      }
      
      self.postMessage(response)
      
    } else if (type === 'SIMULATE_WITH_BUFFERS') {
      // NEW: High-performance simulation with binary buffers
      const { prior, threshold, observations, metadata, bufferData, timeRange, sampleIntervalMinutes } = data
      
      if (!bufferData || !metadata) {
        throw new Error('bufferData and metadata are required for SIMULATE_WITH_BUFFERS type')
      }
      
      // Convert Uint8Arrays back to ArrayBuffers
      const buffers = bufferData.map(uint8Array => uint8Array.buffer.slice(
        uint8Array.byteOffset,
        uint8Array.byteOffset + uint8Array.byteLength
      ))
      
      // Convert string dates back to Date objects
      const periods = {
        start: new Date(timeRange.start),
        end: new Date(timeRange.end)
      }
      
      console.log(`Worker: Starting buffer simulation with ${buffers.length} buffers`)
      
      // Create buffer-based simulator
      const simulator = new BufferBayesianSimulator(
        prior,
        threshold,
        observations,
        buffers,
        metadata,
        periods
      )
      
      const result = simulator.simulate(sampleIntervalMinutes)
      
      // Log performance metrics
      const metrics = simulator.getPerformanceMetrics()
      console.log(`Worker: Buffer simulation complete`, metrics)
      
      const response: SimulationWorkerResponse = {
        type: 'SIMULATION_RESULT',
        id,
        data: result
      }
      
      self.postMessage(response)
    }
  } catch (error) {
    console.error('Simulation worker error:', error)
    const errorResponse: SimulationWorkerResponse = {
      type: 'SIMULATION_ERROR',
      id,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
    
    self.postMessage(errorResponse)
  }
}