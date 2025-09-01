import { CachedBayesianSimulator } from '../services/cachedBayesianSimulator'
import type { BayesianObservation } from '../types/bayesian'
import type { SimulationSummary } from '../services/cachedBayesianSimulator'

interface SimulationWorkerMessage {
  type: 'SIMULATE'
  id: string
  data: {
    prior: number
    threshold: number
    observations: BayesianObservation[]
    cachedData: Record<string, any[]>
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
      const { prior, threshold, observations, cachedData, timeRange, sampleIntervalMinutes } = data
      
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
    }
  } catch (error) {
    const errorResponse: SimulationWorkerResponse = {
      type: 'SIMULATION_ERROR',
      id,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
    
    self.postMessage(errorResponse)
  }
}