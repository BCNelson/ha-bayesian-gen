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
  mean?: number
  stdDev?: number
  trueChunks?: Array<{ value: number; duration: number }>
  falseChunks?: Array<{ value: number; duration: number }>
}

export interface EntityProbability {
  entityId: string
  state: string
  probGivenTrue: number
  probGivenFalse: number
  discriminationPower: number
  trueOccurrences: number
  falseOccurrences: number
  totalTruePeriods: number
  totalFalsePeriods: number
  numericStats?: NumericStateStats
  optimalThresholds?: { above?: number; below?: number }
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