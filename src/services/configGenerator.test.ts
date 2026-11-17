import { describe, it, expect } from 'vitest'
import {
  computePrior,
  generateBayesianConfig,
  informationScore,
  isMirror,
  limitObservationsByEntity,
  MIN_INFORMATION_SCORE
} from './configGenerator'
import type { EntityProbability, TimePeriod } from '../types/bayesian'

const period = (startH: number, endH: number, isTruePeriod: boolean): TimePeriod => ({
  id: `${startH}-${endH}`,
  start: new Date(Date.UTC(2024, 0, 1, startH)),
  end: new Date(Date.UTC(2024, 0, 1, endH)),
  isTruePeriod
})

const stateEp = (entityId: string, state: string, pt: number, pf: number, extra: Partial<EntityProbability> = {}): EntityProbability => ({
  entityId,
  state,
  probGivenTrue: pt,
  probGivenFalse: pf,
  discriminationPower: Math.abs(pt - pf),
  trueOccurrences: 1,
  falseOccurrences: 1,
  totalTruePeriods: 1,
  totalFalsePeriods: 1,
  ...extra
})

describe('computePrior', () => {
  it('is TRUE duration / total duration', () => {
    expect(computePrior([period(0, 2, true), period(2, 8, false)])).toBe(0.25)
    expect(computePrior([period(0, 1, true), period(1, 2, true), period(2, 4, false)])).toBe(0.5)
  })

  it('accepts ISO-string bounds', () => {
    const p = { ...period(0, 3, true), start: '2024-01-01T00:00:00Z', end: '2024-01-01T03:00:00Z' } as unknown as TimePeriod
    expect(computePrior([p, period(3, 4, false)])).toBe(0.75)
  })

  it('is clamped and falls back to 0.5 without usable periods', () => {
    expect(computePrior([period(0, 1000, true), period(0, 1, false)])).toBe(0.99)
    expect(computePrior([])).toBe(0.5)
    expect(computePrior(undefined)).toBe(0.5)
    expect(computePrior([period(2, 1, true)])).toBe(0.5)
  })
})

describe('informationScore', () => {
  it('prefers the engine-provided score', () => {
    expect(informationScore(stateEp('a', 'on', 0.9, 0.1, { informationScore: 42 }))).toBe(42)
  })

  it('falls back to the symmetric KL over match and non-match', () => {
    const pt = 0.9
    const pf = 0.2
    const expected = (pt - pf) * Math.log(pt / pf) + (pf - pt) * Math.log((1 - pt) / (1 - pf))
    expect(informationScore(stateEp('a', 'on', pt, pf))).toBeCloseTo(expected, 12)
  })

  it('rewards an informative non-match even when |p_t - p_f| is equal', () => {
    expect(informationScore(stateEp('a', 'x', 0.99, 0.89))).toBeGreaterThan(informationScore(stateEp('b', 'y', 0.2, 0.1)))
  })
})

describe('isMirror (HA Observation.is_mirror)', () => {
  it('detects complementary pairs using one-decimal rounding', () => {
    const a = { entity_id: 'x', platform: 'state' as const, to_state: 'on', prob_given_true: 0.8, prob_given_false: 0.3 }
    const b = { entity_id: 'x', platform: 'state' as const, to_state: 'off', prob_given_true: 0.21, prob_given_false: 0.68 }
    expect(isMirror(a, b)).toBe(true)
    expect(isMirror(a, { ...b, prob_given_true: 0.05 })).toBe(false)
  })
})

describe('generateBayesianConfig', () => {
  const periods = [period(0, 1, true), period(1, 4, false)]

  it('uses the prior computed from periods and HA-valid observation shapes', () => {
    const numeric: EntityProbability = {
      ...stateEp('sensor.temp', '> 20', 0.8, 0.1),
      numericStats: { isNumeric: true },
      optimalThresholds: { above: 20 }
    }
    const config = generateBayesianConfig(
      [stateEp('binary_sensor.motion', 'on', 0.9, 0.2), numeric],
      'Office',
      { periods }
    )
    expect(config.prior).toBe(0.25)
    expect(config.platform).toBe('bayesian')
    expect(config.unique_id).toBe('bayesian_office')
    expect(config.observations).toEqual(expect.arrayContaining([
      { entity_id: 'binary_sensor.motion', platform: 'state', to_state: 'on', prob_given_true: 0.9, prob_given_false: 0.2 },
      { entity_id: 'sensor.temp', platform: 'numeric_state', above: 20, prob_given_true: 0.8, prob_given_false: 0.1 }
    ]))
  })

  it('explicit prior overrides periods', () => {
    expect(generateBayesianConfig([], 'x', { periods, prior: 0.6 }).prior).toBe(0.6)
  })

  it('automatic mode ranks by information score, drops weak candidates and keeps one state per entity', () => {
    const config = generateBayesianConfig(
      [
        stateEp('a', 'on', 0.55, 0.5), // weak
        stateEp('b', 'home', 0.9, 0.1),
        stateEp('b', 'away', 0.1, 0.85),
        stateEp('c', 'on', 0.7, 0.2)
      ],
      'Auto'
    )
    expect(informationScore(stateEp('a', 'on', 0.55, 0.5))).toBeLessThan(MIN_INFORMATION_SCORE)
    expect(config.observations.map(o => `${o.entity_id}:${o.to_state}`)).toEqual(['b:home', 'c:on'])
  })

  it('respects maxObservations', () => {
    const eps = ['a', 'b', 'c', 'd'].map(id => stateEp(id, 'on', 0.9, 0.1))
    expect(generateBayesianConfig(eps, 'x', { maxObservations: 2 }).observations).toHaveLength(2)
  })

  it('user selections keep multiple states of one entity grouped together', () => {
    const config = generateBayesianConfig(
      [
        stateEp('person.me', 'home', 0.8, 0.3),
        stateEp('light.desk', 'on', 0.7, 0.2),
        stateEp('person.me', 'work', 0.1, 0.4),
        stateEp('person.me', 'gym', 0.05, 0.2)
      ],
      'Sel',
      { skipFiltering: true, maxObservations: 4 }
    )
    expect(config.observations.map(o => o.entity_id)).toEqual(['person.me', 'person.me', 'person.me', 'light.desk'])
  })

  it('collapses a mirrored pair to the single more informative observation', () => {
    const config = generateBayesianConfig(
      [
        stateEp('binary_sensor.door', 'on', 0.8, 0.3, { informationScore: 1 }),
        stateEp('binary_sensor.door', 'off', 0.2, 0.7, { informationScore: 0.9 })
      ],
      'Door',
      { skipFiltering: true }
    )
    expect(config.observations).toHaveLength(1)
    expect(config.observations[0].to_state).toBe('on')
  })

  it('expands numeric ranges into non-overlapping numeric_state observations', () => {
    const ep: EntityProbability = {
      ...stateEp('sensor.temp', 'ranges', 0.6, 0.1, { informationScore: 2 }),
      numericStats: { isNumeric: true },
      optimalThresholds: { below: 18 },
      ranges: [
        { below: 18, probGivenTrue: 0.6, probGivenFalse: 0.1 },
        { above: 18, below: 24, probGivenTrue: 0.3, probGivenFalse: 0.5 },
        { above: 24, probGivenTrue: 0.1, probGivenFalse: 0.4 }
      ]
    }
    const config = generateBayesianConfig([ep], 'Temp', { periods })
    expect(config.observations).toEqual([
      { entity_id: 'sensor.temp', platform: 'numeric_state', below: 18, prob_given_true: 0.6, prob_given_false: 0.1 },
      { entity_id: 'sensor.temp', platform: 'numeric_state', above: 18, below: 24, prob_given_true: 0.3, prob_given_false: 0.5 },
      { entity_id: 'sensor.temp', platform: 'numeric_state', above: 24, prob_given_true: 0.1, prob_given_false: 0.4 }
    ])
  })

  it('drops overlapping numeric observations and invalid thresholds', () => {
    const mk = (state: string, t: { above?: number; below?: number }, score: number): EntityProbability => ({
      ...stateEp('sensor.x', state, 0.8, 0.2, { informationScore: score }),
      numericStats: { isNumeric: true },
      optimalThresholds: t
    })
    const config = generateBayesianConfig(
      [mk('a', { above: 10 }, 2), mk('b', { above: 5, below: 15 }, 1), mk('c', {}, 3), mk('d', { above: 9, below: 3 }, 3)],
      'X',
      { skipFiltering: true }
    )
    expect(config.observations).toEqual([
      { entity_id: 'sensor.x', platform: 'numeric_state', above: 10, prob_given_true: 0.8, prob_given_false: 0.2 }
    ])
  })

  it('de-duplicates repeated selections', () => {
    const ep = stateEp('a', 'on', 0.9, 0.1)
    expect(generateBayesianConfig([ep, ep], 'x', { skipFiltering: true }).observations).toHaveLength(1)
  })
})

describe('limitObservationsByEntity', () => {
  it('never splits an entity group', () => {
    const o = (entity_id: string) => ({ entity_id, platform: 'state' as const, to_state: 's', prob_given_true: 0.5, prob_given_false: 0.4 })
    const result = limitObservationsByEntity([o('a'), o('a'), o('b'), o('c'), o('a')], 2)
    expect(result.map(r => r.entity_id)).toEqual(['a', 'a', 'b', 'a'])
  })
})
