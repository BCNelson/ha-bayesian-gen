// @vitest-environment node
/**
 * Integration test of the real WASM engine through its TypeScript wrapper
 * (requires `npm run build:wasm`). Verifies the TS <-> Rust contract and that
 * the engine output feeds the config generator and HA posterior correctly.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initWasm, WasmBayesianCalculator } from './bayesianCalculatorWasm'
import { generateBayesianConfig } from '../services/configGenerator'
import type { HAHistoryResponse } from '../types/homeAssistant'
import type { TimePeriod } from '../types/bayesian'

const hour = (h: number) => new Date(Date.UTC(2024, 0, 1 + Math.floor(h / 24), h % 24))
const entry = (state: string, h: number) => ({
  entity_id: '',
  state,
  last_changed: hour(h).toISOString(),
  last_updated: hour(h).toISOString(),
  attributes: {}
})

let calc: WasmBayesianCalculator

beforeAll(async () => {
  const wasmPath = fileURLToPath(new URL('./pkg/bayesian_calculator_bg.wasm', import.meta.url))
  await initWasm(readFileSync(wasmPath))
  calc = new WasmBayesianCalculator()
})

describe('WASM engine', () => {
  // TRUE: hours 0-2 (2h); FALSE: hours 2-8 (6h) -> prior 0.25
  const periods: TimePeriod[] = [
    { id: 't', start: hour(0), end: hour(2), isTruePeriod: true },
    { id: 'f', start: hour(2), end: hour(8), isTruePeriod: false }
  ]
  const history = {
    'binary_sensor.motion': [entry('on', 0), entry('off', 2), entry('unavailable', 5), entry('off', 6)],
    'sensor.temp': [entry('25', 0), entry('15', 2)]
  } as unknown as HAHistoryResponse

  it('returns HA-semantics probabilities sorted by informationScore', () => {
    const results = calc.calculateEntityProbabilities(history, periods)
    expect(results.length).toBeGreaterThan(0)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].informationScore!).toBeGreaterThanOrEqual(results[i].informationScore!)
    }
    expect(results.some(r => r.state === 'unavailable')).toBe(false)

    const temp = results.find(r => r.entityId === 'sensor.temp')!
    expect(temp.optimalThresholds).toEqual({ above: 20 })
    expect(temp.probGivenTrue).toBeCloseTo(0.99)
    expect(temp.probGivenFalse).toBeCloseTo(0.01)
    expect(temp.ranges).toBeUndefined()
    expect(temp.numericStats?.isNumeric).toBe(true)

    const motionOn = results.find(r => r.entityId === 'binary_sensor.motion' && r.state === 'on')!
    expect(motionOn.probGivenTrue).toBeCloseTo(0.99)
    expect(motionOn.probGivenFalse).toBeCloseTo(0.01)
  })

  it('accepts ISO string period bounds (as sent by the worker pool)', () => {
    const serialized = periods.map(p => ({ ...p, start: p.start.toISOString(), end: p.end.toISOString() }))
    expect(calc.calculateEntityProbabilities(history, serialized)).toEqual(calc.calculateEntityProbabilities(history, periods))
  })

  it('rejects period sets without both labels', () => {
    expect(() => calc.calculateEntityProbabilities(history, [periods[0]])).toThrow()
  })

  it('emits exclusive numeric ranges for three-regime data and they round-trip into a valid config', () => {
    const entries = []
    const regimePeriods: TimePeriod[] = []
    let h = 0
    const add = (value: number, isTruePeriod: boolean) => {
      entries.push(entry(String(value), h))
      regimePeriods.push({ id: String(h), start: hour(h), end: hour(h + 1), isTruePeriod })
      h++
    }
    for (let v = 0; v < 10; v++) add(v, true)
    for (let v = 10; v < 20; v++) add(v, false)
    for (let v = 20; v < 30; v++) {
      add(v, v % 2 === 0)
      add(v + 0.5, v % 2 === 1)
    }
    const results = calc.calculateEntityProbabilities({ 'sensor.x': entries } as unknown as HAHistoryResponse, regimePeriods)
    const x = results[0]
    expect(x.ranges).toHaveLength(3)

    const config = generateBayesianConfig(results, 'X', { periods: regimePeriods })
    expect(config.prior).toBe(0.5)
    const obs = config.observations
    expect(obs).toHaveLength(3)
    expect(obs.every(o => o.platform === 'numeric_state')).toBe(true)
    expect(obs[0].above).toBeUndefined()
    expect(obs[0].below).toBe(obs[1].above)
    expect(obs[1].below).toBe(obs[2].above)
    expect(obs[2].below).toBeUndefined()
  })
})
