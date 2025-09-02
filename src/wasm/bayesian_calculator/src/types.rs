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

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct EntityProbability {
    pub entity_id: String,
    pub state: String,
    pub prob_given_true: f64,
    pub prob_given_false: f64,
    pub discrimination_power: f64,
    pub true_occurrences: usize,
    pub false_occurrences: usize,
    pub total_true_periods: usize,
    pub total_false_periods: usize,
    pub numeric_stats: Option<crate::sensor_analysis::NumericStateStats>,
    pub optimal_thresholds: Option<crate::threshold::OptimalThresholds>,
}

#[derive(Debug, Clone)]
pub struct TimelineEntry {
    pub time: i64, // Unix timestamp in milliseconds
    pub entry_type: TimelineEntryType,
    pub state: Option<String>,
    pub value: Option<f64>,
    pub is_true_period: Option<bool>,
}

#[derive(Debug, Clone)]
pub enum TimelineEntryType {
    StateChange,
    PeriodStart,
    PeriodEnd,
}

#[derive(Debug, Clone)]
pub struct StateSegment {
    pub start: i64,
    pub end: i64,
    pub state: String,
    pub value: Option<f64>,
    pub is_true_period: bool,
}

#[derive(Debug, Clone)]
pub struct StateAnalysis {
    pub true_occurrences: usize,
    pub false_occurrences: usize,
}

pub struct SensorChunk {
    pub sensor_value: f64,
    pub duration: i64,
    pub desired_output: bool,
}

#[derive(Debug, Clone)]
pub struct StateChunk {
    pub state: String,
    pub duration: i64,
    pub desired_output: bool,
}

#[derive(Debug, Clone)]
pub struct StateDurationStats {
    pub state: String,
    pub true_duration: i64,
    pub false_duration: i64,
}