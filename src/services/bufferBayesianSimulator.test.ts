import { describe, it, expect } from 'vitest'
import { BufferBayesianSimulator, simulatePosterior } from './bufferBayesianSimulator'
import { StreamingEntityBuffer } from './entityBuffer'
import { computePosterior, updateProbability } from './haBayesian'
import { handleSimulationMessage } from '../workers/simulationWorker'
import type { BayesianObservation } from '../types/bayesian'
import type { HAHistoryEntry } from '../types/homeAssistant'

const t = (minutes: number) => new Date(Date.UTC(2024, 0, 1, 0, minutes))
const entry = (state: string, minutes: number): HAHistoryEntry => ({
  entity_id: '',
  state,
  last_changed: t(minutes).toISOString(),
  last_updated: t(minutes).toISOString(),
  attributes: {}
} as unknown as HAHistoryEntry)

const observations: BayesianObservation[] = [
  { entity_id: 'binary_sensor.motion', platform: 'state', to_state: 'on', prob_given_true: 0.9, prob_given_false: 0.2 },
  { entity_id: 'sensor.temp', platform: 'numeric_state', below: 18, prob_given_true: 0.6, prob_given_false: 0.1 },
  { entity_id: 'sensor.temp', platform: 'numeric_state', above: 18, below: 24, prob_given_true: 0.3, prob_given_false: 0.5 },
  { entity_id: 'sensor.temp', platform: 'numeric_state', above: 24, prob_given_true: 0.1, prob_given_false: 0.4 }
]

const histories: Record<string, HAHistoryEntry[]> = {
  // deliberately unsorted: the buffer must sort it
  'binary_sensor.motion': [entry('off', 20), entry('on', 0), entry('unavailable', 40)],
  'sensor.temp': [entry('16', 0), entry('20', 10), entry('30', 30)]
}

function buildSimulator(range = { start: t(0), end: t(50) }) {
  const buffer = new StreamingEntityBuffer()
  for (const [id, h] of Object.entries(histories)) buffer.loadEntityHistory(id, h)
  const { buffers, metadata } = buffer.getTransferableBuffers(Object.keys(histories))
  return { buffer, buffers, metadata, sim: new BufferBayesianSimulator(0.3, 0.5, observations, buffers, metadata, range) }
}

describe('StreamingEntityBuffer + BufferBayesianSimulator', () => {
  it('looks up the state in effect at a time (sorted history, null before first entry)', () => {
    const { sim } = buildSimulator()
    expect(sim.getStateAtTime('binary_sensor.motion', t(5))).toBe('on')
    expect(sim.getStateAtTime('binary_sensor.motion', t(20))).toBe('off')
    expect(sim.getStateAtTime('binary_sensor.motion', t(45))).toBe('unavailable')
    expect(sim.getStateAtTime('binary_sensor.motion', new Date(t(0).getTime() - 60_000))).toBeNull()
    expect(sim.getStateAtTime('sensor.missing', t(5))).toBeNull()
  })

  it('produces exactly the HA posterior at every sample', () => {
    const { sim } = buildSimulator()
    const result = sim.simulate(10)
    expect(result.points.map(p => p.timestamp.getTime())).toEqual([0, 10, 20, 30, 40, 50].map(m => t(m).getTime()))

    // t=0: motion on (match), temp 16 -> range 1
    let p0 = updateProbability(0.3, 0.9, 0.2)
    p0 = updateProbability(p0, 0.6, 0.1)
    expect(result.points[0].probability).toBeCloseTo(p0, 12)
    expect(result.points[0].activeObservations.sort()).toEqual(['binary_sensor.motion', 'sensor.temp'])

    // t=20: motion off (non-match -> 1-p), temp 20 -> range 2
    let p20 = updateProbability(0.3, 0.1, 0.8)
    p20 = updateProbability(p20, 0.3, 0.5)
    expect(result.points[2].probability).toBeCloseTo(p20, 12)
    expect(result.points[2].activeObservations).toEqual(['sensor.temp'])

    // t=40: motion unavailable (ignored), temp 30 -> range 3
    expect(result.points[4].probability).toBeCloseTo(updateProbability(0.3, 0.1, 0.4), 12)

    // every point agrees with the shared pure function
    for (const point of result.points) {
      const expected = computePosterior(0.3, observations, id => sim.getStateAtTime(id, point.timestamp)).probability
      expect(point.probability).toBe(expected)
      expect(point.sensorState).toBe(point.probability >= 0.5)
    }
  })

  it('computes on-periods and statistics from the samples', () => {
    const { sim } = buildSimulator()
    const result = sim.simulate(10)
    const on = result.points.filter(p => p.sensorState).length
    expect(result.statistics.onTime).toBe(on * 10 * 60_000)
    expect(result.statistics.maxProbability).toBe(Math.max(...result.points.map(p => p.probability)))
    expect(result.onPeriods.length).toBe(result.statistics.triggerCount)
  })

  it('simulatePosterior works with any state lookup', () => {
    const res = simulatePosterior(0.5, 0.5, observations.slice(0, 1), () => 'on', { start: t(0), end: t(4) }, 1)
    expect(res.points).toHaveLength(5)
    expect(res.statistics.triggerCount).toBe(1)
    expect(res.onPeriods).toEqual([{ start: t(0), end: t(4) }])
  })
})

describe('simulation worker message handler', () => {
  it('runs a buffer simulation from a transferable message', () => {
    const { buffers, metadata, sim } = buildSimulator()
    const response = handleSimulationMessage({
      type: 'SIMULATE_WITH_BUFFERS',
      id: 'sim_1',
      data: {
        prior: 0.3,
        threshold: 0.5,
        observations,
        metadata,
        bufferData: buffers.map(b => new Uint8Array(b)),
        timeRange: { start: t(0).toISOString(), end: t(50).toISOString() },
        sampleIntervalMinutes: 10
      }
    })
    expect(response.type).toBe('SIMULATION_RESULT')
    expect(response.data!.points.map(p => p.probability)).toEqual(sim.simulate(10).points.map(p => p.probability))
  })

  it('reports errors instead of throwing', () => {
    const response = handleSimulationMessage({ type: 'NOPE', id: 'x', data: {} } as any)
    expect(response).toMatchObject({ type: 'SIMULATION_ERROR', id: 'x' })
  })
})
