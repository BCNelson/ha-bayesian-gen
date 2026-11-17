use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct TimePeriod {
    pub id: String,
    pub start: String, // ISO 8601 string
    pub end: String,   // ISO 8601 string
    pub is_true_period: bool,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct HAHistoryEntry {
    pub state: String,
    pub last_changed: String, // ISO 8601 string
    pub last_updated: String, // ISO 8601 string
    pub attributes: Option<serde_json::Value>,
}

/// One range of a multi-range `numeric_state` observation set.
///
/// When several `numeric_state` observations exist for the same entity, Home
/// Assistant treats them as mutually exclusive ranges matched as
/// `above < value <= below` (missing bound = unbounded) and ignores (does not
/// update on) the ranges that did not match.
#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct NumericRange {
    pub above: Option<f64>,
    pub below: Option<f64>,
    pub prob_given_true: f64,
    pub prob_given_false: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct EntityProbability {
    pub entity_id: String,
    pub state: String,
    pub prob_given_true: f64,
    pub prob_given_false: f64,
    /// Total-variation distance between the outcome distributions under TRUE
    /// and FALSE. For a single observation this is `|p_t - p_f|`.
    pub discrimination_power: f64,
    /// Ranking key; see `scoring::information_score`.
    pub information_score: f64,
    /// Number of TRUE periods in which the observation matched at some point.
    pub true_occurrences: usize,
    /// Number of FALSE periods in which the observation matched at some point.
    pub false_occurrences: usize,
    pub total_true_periods: usize,
    pub total_false_periods: usize,
    pub numeric_stats: Option<crate::segments::NumericStateStats>,
    pub optimal_thresholds: Option<crate::threshold::OptimalThresholds>,
    /// Present (with 3 entries) only when the entity is best described by a set
    /// of mutually exclusive numeric ranges instead of a single observation.
    pub ranges: Option<Vec<NumericRange>>,
}
