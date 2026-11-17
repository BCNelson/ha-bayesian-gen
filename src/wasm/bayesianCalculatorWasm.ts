import type { EntityProbability, TimePeriod } from '../types/bayesian'
import type { HAHistoryResponse } from '../types/homeAssistant'
// Import the generated WASM types
import type { 
  HAHistoryEntry as WasmHAHistoryEntry,
  TimePeriod as WasmTimePeriod
} from './pkg/bayesian_calculator'

let wasmModule: any = null
let BayesianCalculator: any = null

/**
 * Load the WASM engine. `moduleOrPath` is forwarded to wasm-bindgen's init
 * (e.g. the raw .wasm bytes in Node tests); in the browser it is omitted and
 * the module is fetched next to the JS glue.
 */
export async function initWasm(moduleOrPath?: unknown): Promise<void> {
  if (wasmModule) return

  // Dynamic import for WASM module
  const mod = await import('./pkg/bayesian_calculator.js')
  await mod.default(moduleOrPath === undefined ? undefined : { module_or_path: moduleOrPath as any })

  BayesianCalculator = mod.BayesianCalculator
  wasmModule = mod
}

export class WasmBayesianCalculator {
  private calculator: any

  constructor() {
    if (!BayesianCalculator) {
      throw new Error('WASM module not initialized. Call initWasm() first.')
    }
    this.calculator = new BayesianCalculator()
  }

  /**
   * Analyse entity histories against the labelled periods. Results are sorted
   * by `informationScore` (descending). `periods` may carry Date or ISO-string
   * bounds.
   */
  calculateEntityProbabilities(
    history: HAHistoryResponse,
    periods: Array<Omit<TimePeriod, 'start' | 'end'> & { start: Date | string; end: Date | string }>
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