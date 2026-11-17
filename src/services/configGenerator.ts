/**
 * Builds a Home Assistant `bayesian` binary_sensor configuration from the
 * WASM engine's EntityProbability results.
 *
 * HA rules honoured here (homeassistant/components/bayesian/binary_sensor.py):
 *   - `prior` is required; we derive it from the labelled periods.
 *   - `state` observations need `to_state`; `numeric_state` ones need at least
 *     one of `above` / `below`, with `above <= below`.
 *   - `numeric_state` ranges of the same entity must not overlap
 *     (`no_overlapping` validator).
 *   - Exactly two observations of one entity whose probabilities sum to 1
 *     (`Observation.is_mirror`, rounded to 1 decimal) raise a "mirrored
 *     entries" repair. A mirrored pair is redundant with a single observation
 *     (HA already applies 1 - p on non-match), so we keep only one.
 */
import type {
  BayesianObservation,
  BayesianSensorConfig,
  EntityProbability,
  TimePeriod
} from '../types/bayesian'

export interface ConfigGeneratorOptions {
  /** Labelled periods; used to compute the prior when `prior` is not given. */
  periods?: TimePeriod[]
  /** Explicit prior; overrides the one computed from `periods`. */
  prior?: number
  /** Maximum number of EntityProbability entries to turn into observations. */
  maxObservations?: number
  /**
   * true: use exactly the given entities (user selection), in order.
   * false (default): rank by information score, drop weak candidates and keep
   * only the best observation per entity.
   */
  skipFiltering?: boolean
  probabilityThreshold?: number
}

export const DEFAULT_PRIOR = 0.5
export const MIN_PRIOR = 0.01
export const MAX_PRIOR = 0.99
/** Candidates below this information score (nats) are dropped in automatic mode. */
export const MIN_INFORMATION_SCORE = 0.05

const toMs = (d: Date | string) => (d instanceof Date ? d.getTime() : new Date(d).getTime())

/**
 * Prior = TRUE duration / (TRUE + FALSE duration) of the labelled periods,
 * clamped to [0.01, 0.99] so neither class is treated as impossible.
 * Returns DEFAULT_PRIOR when there is no usable duration.
 */
export function computePrior(periods: readonly TimePeriod[] | undefined): number {
  if (!periods || periods.length === 0) return DEFAULT_PRIOR
  let trueMs = 0
  let falseMs = 0
  for (const p of periods) {
    const duration = toMs(p.end) - toMs(p.start)
    if (!Number.isFinite(duration) || duration <= 0) continue
    if (p.isTruePeriod) trueMs += duration
    else falseMs += duration
  }
  const total = trueMs + falseMs
  if (total <= 0) return DEFAULT_PRIOR
  return round(Math.min(MAX_PRIOR, Math.max(MIN_PRIOR, trueMs / total)), 3)
}

/**
 * Jeffreys (symmetric KL) divergence, in nats, between the outcome
 * distributions under TRUE and FALSE:
 *
 *   J = Σ_o (P(o|T) − P(o|F)) · ln(P(o|T) / P(o|F))
 *
 * ln(P(o|T)/P(o|F)) is exactly the log-odds shift HA applies when outcome `o`
 * occurs, so J is the expected separation between the classes the
 * observation produces. For a single observation the outcomes are
 * {match: (p_t, p_f), non-match: (1 − p_t, 1 − p_f)} because HA also updates
 * on non-match; for a multi-range numeric entity the outcomes are the ranges.
 *
 * The WASM engine computes this as `informationScore`; this function is the
 * fallback for objects without it.
 */
export function informationScore(ep: EntityProbability): number {
  if (typeof ep.informationScore === 'number' && Number.isFinite(ep.informationScore)) {
    return ep.informationScore
  }
  if (ep.ranges && ep.ranges.length > 1) {
    return jeffreys(ep.ranges.map(r => [r.probGivenTrue, r.probGivenFalse] as const))
  }
  const pt = ep.probGivenTrue
  const pf = ep.probGivenFalse
  return jeffreys([[pt, pf], [1 - pt, 1 - pf]])
}

function jeffreys(outcomes: ReadonlyArray<readonly [number, number]>): number {
  let j = 0
  for (const [pt, pf] of outcomes) {
    if (pt > 0 && pf > 0) j += (pt - pf) * Math.log(pt / pf)
  }
  return j
}

/** HA `Observation.is_mirror` (rounded to one decimal, like `round(x, 1)`). */
export function isMirror(a: BayesianObservation, b: BayesianObservation): boolean {
  return (
    a.platform === b.platform &&
    round(a.prob_given_true + b.prob_given_true, 1) === 1 &&
    round(a.prob_given_false + b.prob_given_false, 1) === 1
  )
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

interface ScoredObservation {
  obs: BayesianObservation
  score: number
}

function toObservations(ep: EntityProbability): ScoredObservation[] {
  const score = informationScore(ep)
  const prob = (p: number) => round(p, 4)

  if (ep.numericStats?.isNumeric && ep.ranges && ep.ranges.length > 1) {
    return ep.ranges.map(r => {
      const obs: BayesianObservation = {
        entity_id: ep.entityId,
        platform: 'numeric_state',
        prob_given_true: prob(r.probGivenTrue),
        prob_given_false: prob(r.probGivenFalse)
      }
      if (r.above !== undefined && r.above !== null) obs.above = round(r.above, 6)
      if (r.below !== undefined && r.below !== null) obs.below = round(r.below, 6)
      return { obs, score }
    })
  }

  if (ep.numericStats?.isNumeric && ep.optimalThresholds) {
    const { above, below } = ep.optimalThresholds
    const hasAbove = above !== undefined && above !== null
    const hasBelow = below !== undefined && below !== null
    if (!hasAbove && !hasBelow) return []
    if (hasAbove && hasBelow && above! > below!) return []
    const obs: BayesianObservation = {
      entity_id: ep.entityId,
      platform: 'numeric_state',
      prob_given_true: prob(ep.probGivenTrue),
      prob_given_false: prob(ep.probGivenFalse)
    }
    if (hasAbove) obs.above = round(above!, 6)
    if (hasBelow) obs.below = round(below!, 6)
    return [{ obs, score }]
  }

  return [
    {
      obs: {
        entity_id: ep.entityId,
        platform: 'state',
        prob_given_true: prob(ep.probGivenTrue),
        prob_given_false: prob(ep.probGivenFalse),
        to_state: ep.state
      },
      score
    }
  ]
}

const interval = (o: BayesianObservation) => ({
  above: o.above ?? -Infinity,
  below: o.below ?? Infinity
})

/** HA `no_overlapping`: sorted by `above`, each `below` must be <= next `above`. */
function overlaps(a: BayesianObservation, b: BayesianObservation): boolean {
  const [lo, hi] = [interval(a), interval(b)].sort((x, y) => x.above - y.above)
  return lo.below > hi.above
}

/** Apply HA's per-entity validity rules to the observations of one entity. */
function sanitizeEntityObservations(items: ScoredObservation[]): BayesianObservation[] {
  // Drop numeric ranges that would overlap an already accepted one
  // (items arrive in priority order).
  const kept: ScoredObservation[] = []
  for (const item of items) {
    if (
      item.obs.platform === 'numeric_state' &&
      kept.some(k => k.obs.platform === 'numeric_state' && overlaps(k.obs, item.obs))
    ) {
      continue
    }
    kept.push(item)
  }

  if (kept.length === 2 && isMirror(kept[0].obs, kept[1].obs)) {
    const best = kept[0].score >= kept[1].score ? kept[0] : kept[1]
    return [best.obs]
  }
  return kept.map(k => k.obs)
}

/**
 * Generate a Home Assistant bayesian sensor config.
 *
 * @example
 *   generateBayesianConfig(selected, 'Office occupied', { periods, skipFiltering: true })
 */
export function generateBayesianConfig(
  entityProbabilities: EntityProbability[],
  sensorName: string,
  opts: ConfigGeneratorOptions = {}
): BayesianSensorConfig {
  const maxObservations = opts.maxObservations ?? 10
  const skipFiltering = opts.skipFiltering ?? false

  // De-duplicate (same entity + state selected twice).
  const seen = new Set<string>()
  let candidates = entityProbabilities.filter(ep => {
    const key = `${ep.entityId}\u0000${ep.state}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (!skipFiltering) {
    // Automatic mode: strongest first, one observation per entity (a lone
    // observation already uses both the match and the non-match update;
    // adding more states of the same entity would switch HA to multi-state
    // mode, where non-matches are ignored).
    const bestPerEntity = new Set<string>()
    candidates = [...candidates]
      .sort((a, b) => informationScore(b) - informationScore(a))
      .filter(ep => informationScore(ep) >= MIN_INFORMATION_SCORE)
      .filter(ep => {
        if (bestPerEntity.has(ep.entityId)) return false
        bestPerEntity.add(ep.entityId)
        return true
      })
  }
  candidates = candidates.slice(0, maxObservations)

  // Group by entity, preserving first-appearance order; within an entity,
  // higher-scoring candidates take precedence.
  const byEntity = new Map<string, ScoredObservation[]>()
  for (const ep of candidates) {
    const list = byEntity.get(ep.entityId) ?? []
    list.push(...toObservations(ep))
    byEntity.set(ep.entityId, list)
  }

  const observations: BayesianObservation[] = []
  for (const items of byEntity.values()) {
    items.sort((a, b) => b.score - a.score)
    observations.push(...sanitizeEntityObservations(items))
  }

  const prior = opts.prior !== undefined
    ? Math.min(MAX_PRIOR, Math.max(MIN_PRIOR, opts.prior))
    : computePrior(opts.periods)

  return {
    platform: 'bayesian',
    name: sensorName,
    unique_id: `bayesian_${sensorName.toLowerCase().replace(/\s+/g, '_')}`,
    prior,
    probability_threshold: opts.probabilityThreshold ?? 0.5,
    observations
  }
}

/**
 * Keep the observations of the first `maxEntities` distinct entities.
 * Slicing a flat observation list could split a multi-range / multi-state
 * entity, which changes how HA evaluates the remaining observations.
 */
export function limitObservationsByEntity(
  observations: BayesianObservation[],
  maxEntities: number
): BayesianObservation[] {
  const allowed = new Set<string>()
  return observations.filter(obs => {
    if (allowed.has(obs.entity_id)) return true
    if (allowed.size >= maxEntities) return false
    allowed.add(obs.entity_id)
    return true
  })
}
