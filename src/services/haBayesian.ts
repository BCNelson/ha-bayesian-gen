/**
 * A faithful TypeScript port of Home Assistant's bayesian binary_sensor
 * posterior computation, shared by every simulator in the app.
 *
 * Source: homeassistant/components/bayesian/binary_sensor.py (HA core, dev):
 *   - `update_probability()`               -> updateProbability()
 *   - `_process_state()`                   -> evaluateObservation() for 'state'
 *   - `_process_numeric_state()`           -> evaluateObservation() for 'numeric_state'
 *   - `_build_observations_by_entity()`    -> `multi` flag (>1 observation per entity)
 *   - `_calculate_new_probability()`       -> computePosterior()
 */
import type { BayesianObservation } from '../types/bayesian'

/** Outcome of evaluating one observation: matched, did not match, or no information. */
export type ObservationOutcome = true | false | null

/** HA `update_probability`: one step of Bayes' rule. */
export function updateProbability(prior: number, probGivenTrue: number, probGivenFalse: number): number {
  const numerator = probGivenTrue * prior
  const denominator = numerator + probGivenFalse * (1 - prior)
  // HA would raise ZeroDivisionError here (only possible with 0 likelihoods,
  // which HA's docs warn against); keep the prior instead of producing NaN.
  return denominator === 0 ? prior : numerator / denominator
}

const IGNORED_STATES = new Set(['unavailable', 'unknown'])

/** Python `float(state)`-like parse; returns null when HA would raise. */
function parseNumericState(state: string): number | null {
  const trimmed = state.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isNaN(value) ? null : value
}

/**
 * Evaluate a single observation against an entity state exactly like HA.
 *
 * @param state  current state string, or null/undefined if the entity is unknown at that time
 * @param multi  true when the entity has more than one observation in the config
 */
export function evaluateObservation(
  obs: Pick<BayesianObservation, 'platform' | 'to_state' | 'above' | 'below'>,
  state: string | null | undefined,
  multi: boolean
): ObservationOutcome {
  if (state === null || state === undefined) return null
  if (IGNORED_STATES.has(state)) return null

  if (obs.platform === 'state') {
    const result = state === obs.to_state
    // multi-state: a non-matching state carries no information
    if (multi && !result) return null
    return result
  }

  if (obs.platform === 'numeric_state') {
    const value = parseNumericState(state)
    if (value === null) return null // ConditionError -> None
    // condition.async_numeric_state: `below` and `above` are both exclusive
    let result = true
    if (obs.below !== undefined && obs.below !== null && value >= obs.below) result = false
    if (obs.above !== undefined && obs.above !== null && value <= obs.above) result = false
    if (result) return true
    if (multi) {
      // multi-range: `below` is inclusive, other non-matches are ignored
      if (obs.below !== undefined && obs.below !== null && value === obs.below) return true
      return null
    }
    return false
  }

  // 'template' observations cannot be evaluated from entity history.
  return null
}

/** Number of observations per entity (HA sets `multi` when this is > 1). */
export function countObservationsByEntity(observations: readonly BayesianObservation[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const obs of observations) {
    if (!obs.entity_id) continue
    counts.set(obs.entity_id, (counts.get(obs.entity_id) ?? 0) + 1)
  }
  return counts
}

export interface PosteriorResult {
  probability: number
  /** Outcome per observation, index-aligned with the input array. */
  outcomes: ObservationOutcome[]
}

/**
 * HA `_calculate_new_probability`: starting from the prior, apply
 * `(p_t, p_f)` for every matched observation and `(1 - p_t, 1 - p_f)` for
 * every observation that evaluated to False. Observations evaluating to None
 * (unavailable/unknown state, non-matching member of a multi-observation
 * entity, unparsable number, missing entity) are skipped.
 *
 * Pass `entityCounts` (from countObservationsByEntity) when calling in a loop
 * to avoid recomputing it.
 */
export function computePosterior(
  prior: number,
  observations: readonly BayesianObservation[],
  getState: (entityId: string) => string | null | undefined,
  entityCounts: Map<string, number> = countObservationsByEntity(observations)
): PosteriorResult {
  let probability = prior
  const outcomes: ObservationOutcome[] = []
  for (const obs of observations) {
    const multi = (entityCounts.get(obs.entity_id) ?? 0) > 1
    const outcome = evaluateObservation(obs, getState(obs.entity_id), multi)
    outcomes.push(outcome)
    if (outcome === true) {
      probability = updateProbability(probability, obs.prob_given_true, obs.prob_given_false)
    } else if (outcome === false) {
      probability = updateProbability(probability, 1 - obs.prob_given_true, 1 - obs.prob_given_false)
    }
  }
  return { probability, outcomes }
}
