import { describe, it, expect } from 'vitest'
import {
  updateProbability,
  evaluateObservation,
  computePosterior,
  countObservationsByEntity
} from './haBayesian'
import type { BayesianObservation } from '../types/bayesian'

const stateObs = (entity_id: string, to_state: string, pt: number, pf: number): BayesianObservation => ({
  entity_id,
  platform: 'state',
  to_state,
  prob_given_true: pt,
  prob_given_false: pf
})

const numObs = (entity_id: string, above: number | undefined, below: number | undefined, pt: number, pf: number): BayesianObservation => ({
  entity_id,
  platform: 'numeric_state',
  ...(above !== undefined ? { above } : {}),
  ...(below !== undefined ? { below } : {}),
  prob_given_true: pt,
  prob_given_false: pf
})

describe('updateProbability (HA update_probability)', () => {
  it('applies Bayes rule', () => {
    // 0.9*0.3 / (0.9*0.3 + 0.2*0.7)
    expect(updateProbability(0.3, 0.9, 0.2)).toBeCloseTo(0.27 / 0.41, 12)
  })

  it('returns the prior instead of NaN for a zero denominator', () => {
    expect(updateProbability(0.4, 0, 0)).toBe(0.4)
  })
})

describe('evaluateObservation', () => {
  it('state: match / non-match for a single observation', () => {
    const o = stateObs('a', 'on', 0.9, 0.1)
    expect(evaluateObservation(o, 'on', false)).toBe(true)
    expect(evaluateObservation(o, 'off', false)).toBe(false)
  })

  it('state: non-match is ignored (None) in multi-state mode', () => {
    const o = stateObs('a', 'on', 0.9, 0.1)
    expect(evaluateObservation(o, 'off', true)).toBeNull()
    expect(evaluateObservation(o, 'on', true)).toBe(true)
  })

  it('unavailable / unknown / missing states give no information', () => {
    const o = stateObs('a', 'on', 0.9, 0.1)
    for (const s of ['unavailable', 'unknown', null, undefined]) {
      expect(evaluateObservation(o, s as any, false)).toBeNull()
    }
    expect(evaluateObservation(numObs('a', 1, undefined, 0.9, 0.1), 'unknown', false)).toBeNull()
  })

  it('numeric_state: both bounds are exclusive for a single observation', () => {
    const o = numObs('t', 20, 25, 0.8, 0.2)
    expect(evaluateObservation(o, '22', false)).toBe(true)
    expect(evaluateObservation(o, '20', false)).toBe(false)
    expect(evaluateObservation(o, '25', false)).toBe(false)
    expect(evaluateObservation(o, '30', false)).toBe(false)
  })

  it('numeric_state: below is inclusive and non-matches are ignored in multi mode', () => {
    const o = numObs('t', 20, 25, 0.8, 0.2)
    expect(evaluateObservation(o, '25', true)).toBe(true)
    expect(evaluateObservation(o, '20', true)).toBeNull()
    expect(evaluateObservation(o, '30', true)).toBeNull()
  })

  it('numeric_state: non-numeric states give no information', () => {
    const o = numObs('t', 20, undefined, 0.8, 0.2)
    expect(evaluateObservation(o, 'abc', false)).toBeNull()
    expect(evaluateObservation(o, '', false)).toBeNull()
    expect(evaluateObservation(o, ' 21.5 ', false)).toBe(true)
  })

  it('template observations cannot be evaluated from history', () => {
    const o: BayesianObservation = { entity_id: '', platform: 'template', value_template: '{{ true }}', prob_given_true: 0.9, prob_given_false: 0.1 }
    expect(evaluateObservation(o, 'on', false)).toBeNull()
  })
})

describe('computePosterior (HA _calculate_new_probability)', () => {
  it('applies the non-match update (1 - p) for single observations', () => {
    const obs = [stateObs('motion', 'on', 0.9, 0.2)]
    const { probability, outcomes } = computePosterior(0.3, obs, () => 'off')
    expect(outcomes).toEqual([false])
    expect(probability).toBeCloseTo(updateProbability(0.3, 0.1, 0.8), 12)
  })

  it('combines several entities exactly like HA', () => {
    const obs = [
      stateObs('motion', 'on', 0.9, 0.2),
      numObs('lux', undefined, 50, 0.7, 0.4),
      stateObs('door', 'open', 0.3, 0.6)
    ]
    const states: Record<string, string> = { motion: 'on', lux: '80', door: 'unavailable' }
    const { probability, outcomes } = computePosterior(0.25, obs, id => states[id])

    let expected = updateProbability(0.25, 0.9, 0.2) // motion matched
    expected = updateProbability(expected, 0.3, 0.6) // lux non-match: 1 - p
    // door unavailable: skipped
    expect(outcomes).toEqual([true, false, null])
    expect(probability).toBeCloseTo(expected, 12)
  })

  it('multi-state entity: only the matching state updates', () => {
    const obs = [
      stateObs('person', 'home', 0.8, 0.3),
      stateObs('person', 'work', 0.1, 0.5),
      stateObs('person', 'away', 0.1, 0.2)
    ]
    const { probability, outcomes } = computePosterior(0.5, obs, () => 'work')
    expect(outcomes).toEqual([null, true, null])
    expect(probability).toBeCloseTo(updateProbability(0.5, 0.1, 0.5), 12)

    // a state not listed at all gives no information
    expect(computePosterior(0.5, obs, () => 'gym').probability).toBe(0.5)
  })

  it('multi-range numeric entity: exactly one range applies, boundary goes to the lower range', () => {
    const obs = [
      numObs('temp', undefined, 18, 0.6, 0.1),
      numObs('temp', 18, 24, 0.3, 0.5),
      numObs('temp', 24, undefined, 0.1, 0.4)
    ]
    const at = (v: string) => computePosterior(0.5, obs, () => v)
    expect(at('18').outcomes).toEqual([true, null, null])
    expect(at('18.01').outcomes).toEqual([null, true, null])
    expect(at('24').outcomes).toEqual([null, true, null])
    expect(at('30').outcomes).toEqual([null, null, true])
    expect(at('18').probability).toBeCloseTo(updateProbability(0.5, 0.6, 0.1), 12)
  })

  it('a numeric observation alone on its entity is not in multi mode even when other entities have several', () => {
    const obs = [stateObs('p', 'home', 0.8, 0.3), stateObs('p', 'away', 0.2, 0.7), numObs('t', 20, undefined, 0.7, 0.3)]
    const counts = countObservationsByEntity(obs)
    expect(counts.get('p')).toBe(2)
    expect(counts.get('t')).toBe(1)
    const { outcomes } = computePosterior(0.5, obs, id => (id === 't' ? '20' : 'home'), counts)
    expect(outcomes).toEqual([true, null, false])
  })
})
