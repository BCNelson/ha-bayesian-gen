import type { BayesianObservation } from '../types/bayesian'

export interface ObservationWarning {
  /** Indexes into the observations array this warning refers to */
  indexes: number[]
  entityId: string
  kind: 'no-effect' | 'mirrored'
  message: string
}

const DEFAULT_TOLERANCE = 0.025

/**
 * Flag observations Home Assistant will complain about:
 *  - prob_given_true ≈ prob_given_false: the observation can have no effect
 *    (HA's config flow rejects exactly equal values).
 *  - Two `state` observations of the same entity whose probabilities mirror each
 *    other (p_t1 ≈ 1 − p_t2 and p_f1 ≈ 1 − p_f2). Since 2024.x HA also updates
 *    the probability when an observation does *not* match, so the second one is
 *    redundant and HA raises a "Redundant mirrored observations" repair.
 */
export function findObservationWarnings(
  observations: BayesianObservation[],
  tolerance = DEFAULT_TOLERANCE
): ObservationWarning[] {
  const warnings: ObservationWarning[] = []
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerance

  observations.forEach((obs, i) => {
    if (near(obs.prob_given_true, obs.prob_given_false)) {
      warnings.push({
        indexes: [i],
        entityId: obs.entity_id,
        kind: 'no-effect',
        message:
          `${describe(obs)}: P(true) ${pct(obs.prob_given_true)} ≈ P(false) ${pct(obs.prob_given_false)} — ` +
          'this observation has (almost) no effect. Consider removing it.'
      })
    }
  })

  const byEntity = new Map<string, number[]>()
  observations.forEach((obs, i) => {
    if (obs.platform !== 'state') return
    const list = byEntity.get(obs.entity_id) ?? []
    list.push(i)
    byEntity.set(obs.entity_id, list)
  })

  for (const [entityId, idx] of byEntity) {
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const o1 = observations[idx[a]]
        const o2 = observations[idx[b]]
        if (o1.to_state === o2.to_state) continue
        if (near(o1.prob_given_true, 1 - o2.prob_given_true) && near(o1.prob_given_false, 1 - o2.prob_given_false)) {
          warnings.push({
            indexes: [idx[a], idx[b]],
            entityId,
            kind: 'mirrored',
            message:
              `${entityId}: "${o1.to_state}" and "${o2.to_state}" are mirrored observations. ` +
              'Home Assistant already updates the probability when an observation does not match, ' +
              'so keep only one of them (HA raises a repair otherwise).'
          })
        }
      }
    }
  }

  return warnings
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`

const describe = (obs: BayesianObservation) => {
  if (obs.to_state !== undefined) return `${obs.entity_id} = ${obs.to_state}`
  if (obs.above !== undefined || obs.below !== undefined) {
    const parts = []
    if (obs.above !== undefined) parts.push(`> ${obs.above}`)
    if (obs.below !== undefined) parts.push(`< ${obs.below}`)
    return `${obs.entity_id} ${parts.join(' and ')}`
  }
  return obs.entity_id
}

/** 0–1 probability → HA UI percentage (0–100), trimmed to 2 decimals. */
export function toPercent(p: number): string {
  return String(Math.round(p * 10000) / 100)
}
