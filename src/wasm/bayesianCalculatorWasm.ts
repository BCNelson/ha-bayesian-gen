import type { EntityProbability, TimePeriod } from '../types/bayesian'
import type { HAHistoryResponse } from '../types/homeAssistant'
// Import the generated WASM types
import type { 
  HAHistoryEntry as WasmHAHistoryEntry,
  TimePeriod as WasmTimePeriod
} from './pkg/bayesian_calculator'

let wasmModule: any = null
let BayesianCalculator: any = null

export async function initWasm(): Promise<void> {
  if (wasmModule) return

  // Dynamic import for WASM module
  wasmModule = await import('./pkg/bayesian_calculator.js')
  await wasmModule.default()
  
  BayesianCalculator = wasmModule.BayesianCalculator
}

export class WasmBayesianCalculator {
  private calculator: any

  constructor() {
    if (!BayesianCalculator) {
      throw new Error('WASM module not initialized. Call initWasm() first.')
    }
    this.calculator = new BayesianCalculator()
  }

  calculateEntityProbabilities(
    history: HAHistoryResponse,
    periods: TimePeriod[]
  ): EntityProbability[] {
    try {
      // Convert TypeScript types to WASM expected format
      // The WASM module expects camelCase for HAHistoryEntry fields
      const wasmHistory: Record<string, WasmHAHistoryEntry[]> = {}
      for (const [entityId, entries] of Object.entries(history)) {
        wasmHistory[entityId] = entries.map(entry => ({
          state: entry.state,
          lastChanged: entry.last_changed, // Convert snake_case to camelCase
          lastUpdated: entry.last_updated, // Convert snake_case to camelCase
          attributes: entry.attributes as any
        }))
      }

      // Convert periods to WASM format (Date to ISO string)
      const wasmPeriods: WasmTimePeriod[] = periods.map(p => ({
        id: p.id,
        start: p.start instanceof Date ? p.start.toISOString() : p.start,
        end: p.end instanceof Date ? p.end.toISOString() : p.end,
        isTruePeriod: p.isTruePeriod,
        label: p.label || null
      }))

      // Call WASM function with properly typed data
      const result = this.calculator.calculate_entity_probabilities(
        wasmHistory,
        wasmPeriods
      )

      // DEBUG: Log results for target entity
      const targetEntity = 'sensor.0xe406bffffe000eea_pm25'
      const targetResults = (result as EntityProbability[]).filter(r => r.entityId === targetEntity)
      if (targetResults.length > 0) {
        console.log(`WASM DEBUG - ${targetEntity} results from WASM:`, targetResults.map(r => ({
          state: r.state,
          probGivenTrue: r.probGivenTrue,
          probGivenFalse: r.probGivenFalse,
          discriminationPower: r.discriminationPower
        })))
      }

      return result as EntityProbability[]
    } catch (error) {
      console.error('WASM calculation error:', error)
      throw error
    }
  }

  destroy() {
    if (this.calculator && this.calculator.free) {
      this.calculator.free()
    }
  }
}