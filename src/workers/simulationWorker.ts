import { BufferBayesianSimulator } from '../services/bufferBayesianSimulator'
import type { SimulationSummary } from '../services/bufferBayesianSimulator'
import type { BayesianObservation } from '../types/bayesian'
import type { EntityBufferMetadata } from '../services/entityBuffer'

export interface SimulationWorkerMessage {
  type: 'SIMULATE_WITH_BUFFERS'
  id: string
  data: {
    prior: number
    threshold: number
    observations: BayesianObservation[]
    metadata: EntityBufferMetadata[]
    bufferData: Uint8Array[]
    timeRange: { start: string; end: string }
    sampleIntervalMinutes: number
  }
}

export interface SimulationWorkerResponse {
  type: 'SIMULATION_RESULT' | 'SIMULATION_ERROR'
  id: string
  data?: SimulationSummary
  error?: string
}

/** Run one simulation request; exported for unit testing. */
export function handleSimulationMessage(message: SimulationWorkerMessage): SimulationWorkerResponse {
  const { type, data, id } = message
  try {
    if (type !== 'SIMULATE_WITH_BUFFERS') {
      throw new Error(`Unknown simulation message type: ${String(type)}`)
    }
    const { prior, threshold, observations, metadata, bufferData, timeRange, sampleIntervalMinutes } = data
    if (!bufferData || !metadata) {
      throw new Error('bufferData and metadata are required for SIMULATE_WITH_BUFFERS')
    }

    const buffers = bufferData.map(u8 =>
      u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
    )
    const simulator = new BufferBayesianSimulator(
      prior,
      threshold,
      observations,
      buffers,
      metadata,
      { start: new Date(timeRange.start), end: new Date(timeRange.end) }
    )
    return { type: 'SIMULATION_RESULT', id, data: simulator.simulate(sampleIntervalMinutes) }
  } catch (error) {
    return {
      type: 'SIMULATION_ERROR',
      id,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

self.onmessage = function (e: MessageEvent<SimulationWorkerMessage>) {
  self.postMessage(handleSimulationMessage(e.data))
}
