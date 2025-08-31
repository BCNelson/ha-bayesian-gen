import type { TimePeriod, EntityProbability } from '../types/bayesian'
import type { HAHistoryResponse } from '../types/homeAssistant'
import { initWasm, WasmBayesianCalculator } from '../wasm/bayesianCalculatorWasm'

interface WorkerMessage {
  type: 'ANALYZE_ENTITY' | 'INIT_WASM'
  id: string
  data?: {
    entityHistory: HAHistoryResponse
    periods: TimePeriod[]
  }
}

interface WorkerResponse {
  type: 'ANALYSIS_RESULT' | 'ANALYSIS_ERROR' | 'ANALYSIS_PROGRESS' | 'WASM_INITIALIZED'
  id: string
  data?: EntityProbability[]
  error?: string
  progress?: {
    entityId: string
    status: 'analyzing' | 'completed'
    message?: string
  }
}

let wasmCalculator: WasmBayesianCalculator | null = null
let isWasmInitialized = false

self.onmessage = async function(e: MessageEvent<WorkerMessage>) {
  const { type, data, id } = e.data

  try {
    if (type === 'INIT_WASM') {
      if (!isWasmInitialized) {
        await initWasm()
        wasmCalculator = new WasmBayesianCalculator()
        isWasmInitialized = true
      }
      
      const response: WorkerResponse = {
        type: 'WASM_INITIALIZED',
        id
      }
      
      self.postMessage(response)
    } else if (type === 'ANALYZE_ENTITY') {
      if (!wasmCalculator) {
        throw new Error('WASM not initialized. Send INIT_WASM message first.')
      }
      
      const { entityHistory, periods } = data!
      const result = wasmCalculator.calculateEntityProbabilities(entityHistory, periods)
      
      const response: WorkerResponse = {
        type: 'ANALYSIS_RESULT',
        id,
        data: result
      }
      
      self.postMessage(response)
    }
  } catch (error) {
    const errorResponse: WorkerResponse = {
      type: 'ANALYSIS_ERROR',
      id,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
    
    self.postMessage(errorResponse)
  }
}