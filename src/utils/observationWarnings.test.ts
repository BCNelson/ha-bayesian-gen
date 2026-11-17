import { describe, it, expect } from 'vitest'
import { findObservationWarnings, toPercent } from './observationWarnings'
import type { BayesianObservation } from '../types/bayesian'

const obs = (o: Partial<BayesianObservation>): BayesianObservation => ({
  entity_id: 'binary_sensor.motion',
  platform: 'state',
  prob_given_true: 0.8,
  prob_given_false: 0.2,
  to_state: 'on',
  ...o
})

describe('findObservationWarnings', () => {
  it('returns nothing for a good set', () => {
    expect(findObservationWarnings([obs({}), obs({ entity_id: 'sensor.x', platform: 'numeric_state', to_state: undefined, above: 3 })])).toEqual([])
  })

  it('flags observations with equal probabilities', () => {
    const w = findObservationWarnings([obs({ prob_given_true: 0.4, prob_given_false: 0.41 })])
    expect(w).toHaveLength(1)
    expect(w[0].kind).toBe('no-effect')
    expect(w[0].indexes).toEqual([0])
  })

  it('flags mirrored on/off observations of the same entity', () => {
    const w = findObservationWarnings([
      obs({ to_state: 'on', prob_given_true: 0.9, prob_given_false: 0.3 }),
      obs({ entity_id: 'light.kitchen' }),
      obs({ to_state: 'off', prob_given_true: 0.1, prob_given_false: 0.7 })
    ])
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ kind: 'mirrored', indexes: [0, 2], entityId: 'binary_sensor.motion' })
  })

  it('does not flag non-mirrored multi-state observations', () => {
    const w = findObservationWarnings([
      obs({ entity_id: 'sensor.mode', to_state: 'home', prob_given_true: 0.6, prob_given_false: 0.2 }),
      obs({ entity_id: 'sensor.mode', to_state: 'away', prob_given_true: 0.1, prob_given_false: 0.5 })
    ])
    expect(w).toEqual([])
  })
})

describe('toPercent', () => {
  it('converts to HA UI percentages', () => {
    expect(toPercent(0.95)).toBe('95')
    expect(toPercent(0.123456)).toBe('12.35')
    expect(toPercent(0.07)).toBe('7')
  })
})
