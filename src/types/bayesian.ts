export interface TimePeriod {
  id: string
  start: Date
  end: Date
  isTruePeriod: boolean
  label?: string
}

export interface NumericStateStats {
  isNumeric: boolean
  min?: number
  max?: number
  trueChunks?: Array<{ value: number; duration: number }>
  falseChunks?: Array<{ value: number; duration: number }>
}

/**
 * One of several mutually exclusive `numeric_state` ranges for the same entity.
 * Home Assistant matches these as `above < value <= below` (a missing bound is
 * unbounded) and ignores the ranges that did not match.
 */
export interface NumericRange {
  above?: number
  below?: number
  probGivenTrue: number
  probGivenFalse: number
}

export interface EntityProbability {
  entityId: string
  state: string
  probGivenTrue: number
  probGivenFalse: number
  /** Total-variation distance between TRUE/FALSE outcome distributions (|p_t - p_f| for a single observation). */
  discriminationPower: number
  /**
   * Ranking key: Jeffreys divergence (nats) over the outcomes HA updates on.
   * See `informationScore()` in services/configGenerator.ts for the formula.
   */
  informationScore?: number
  trueOccurrences: number
  falseOccurrences: number
  totalTruePeriods: number
  totalFalsePeriods: number
  numericStats?: NumericStateStats
  optimalThresholds?: { above?: number; below?: number }
  /** Present when a numeric entity is best modelled by several exclusive ranges. */
  ranges?: NumericRange[]
}

export interface BayesianObservation {
  entity_id: string
  platform: 'state' | 'numeric_state' | 'template'
  prob_given_true: number
  prob_given_false: number
  to_state?: string
  above?: number
  below?: number
  value_template?: string
}

export interface BayesianSensorConfig {
  platform: 'bayesian'
  name: string
  unique_id?: string
  prior: number
  probability_threshold: number
  observations: BayesianObservation[]
}

export interface AnalysisResult {
  entityProbabilities: EntityProbability[]
  suggestedConfig: BayesianSensorConfig
  analysisTimestamp: Date
}