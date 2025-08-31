use crate::types::{HAHistoryEntry, TimePeriod, SensorChunk};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct NumericStateStats {
    pub is_numeric: bool,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub true_chunks: Vec<ValueDuration>,
    pub false_chunks: Vec<ValueDuration>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ValueDuration {
    pub value: f64,
    pub duration: i64,
}

pub fn is_numeric_entity(entity_history: &[HAHistoryEntry]) -> bool {
    if entity_history.is_empty() {
        return false;
    }

    let sample_size = entity_history.len().min(10);
    let mut numeric_count = 0;

    for i in 0..sample_size {
        let state = &entity_history[i].state;
        if state != "unavailable" && state != "unknown" {
            if state.parse::<f64>().is_ok() {
                numeric_count += 1;
            }
        }
    }

    numeric_count >= (sample_size as f64 * 0.7) as usize
}

pub fn analyze_numeric_states(
    entity_history: &[HAHistoryEntry],
    periods: &[TimePeriod],
) -> Option<NumericStateStats> {
    let all_chunks = create_sensor_period_chunks(entity_history, periods);
    
    if all_chunks.is_empty() {
        return None;
    }

    let true_chunks: Vec<_> = all_chunks
        .iter()
        .filter(|chunk| chunk.desired_output)
        .map(|c| ValueDuration {
            value: c.sensor_value,
            duration: c.duration,
        })
        .collect();

    let false_chunks: Vec<_> = all_chunks
        .iter()
        .filter(|chunk| !chunk.desired_output)
        .map(|c| ValueDuration {
            value: c.sensor_value,
            duration: c.duration,
        })
        .collect();

    let all_values: Vec<f64> = all_chunks.iter().map(|c| c.sensor_value).collect();
    let min = all_values.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = all_values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

    Some(NumericStateStats {
        is_numeric: true,
        min: Some(min),
        max: Some(max),
        true_chunks,
        false_chunks,
    })
}

fn create_sensor_period_chunks(
    entity_history: &[HAHistoryEntry],
    periods: &[TimePeriod],
) -> Vec<SensorChunk> {
    if entity_history.is_empty() || periods.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();

    // Cache timestamps and values
    let mut history_cache: Vec<(i64, Option<f64>)> = Vec::with_capacity(entity_history.len());
    for entry in entity_history {
        let timestamp = parse_timestamp(&entry.last_changed);
        let value = entry.state.parse::<f64>().ok();
        history_cache.push((timestamp, value));
    }

    // Sort by timestamp
    history_cache.sort_by_key(|&(time, _)| time);

    // Process each period
    for period in periods {
        let period_start = parse_timestamp(&period.start);
        let period_end = parse_timestamp(&period.end);

        // Find relevant changes within the period
        let mut relevant_timestamps: Vec<i64> = Vec::new();

        for &(timestamp, _) in &history_cache {
            if timestamp > period_start && timestamp < period_end {
                relevant_timestamps.push(timestamp);
            }
        }

        // Build time points
        let mut time_points = vec![period_start];
        time_points.extend(&relevant_timestamps);
        time_points.push(period_end);

        // Find initial value
        let mut current_value: Option<f64> = None;
        for i in (0..history_cache.len()).rev() {
            if history_cache[i].0 <= period_start {
                current_value = history_cache[i].1;
                break;
            }
        }

        // Create chunks for this period
        for i in 0..time_points.len() - 1 {
            let chunk_start = time_points[i];
            let chunk_end = time_points[i + 1];
            let duration = chunk_end - chunk_start;

            if duration < 1000 {
                continue; // Skip chunks smaller than 1 second
            }

            // Update current value if there was a change
            if i > 0 {
                // Find the change at this timestamp
                for &(timestamp, value) in &history_cache {
                    if timestamp == time_points[i] {
                        if let Some(v) = value {
                            current_value = Some(v);
                        }
                        break;
                    }
                }
            }

            if let Some(value) = current_value {
                chunks.push(SensorChunk {
                    sensor_value: value,
                    duration,
                    desired_output: period.is_true_period,
                });
            }
        }
    }

    chunks
}

fn parse_timestamp(iso_string: &str) -> i64 {
    // Simple ISO 8601 parser for timestamps
    // Format: "2024-01-01T12:00:00.000Z" or similar
    chrono::DateTime::parse_from_rfc3339(iso_string)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

// Add chrono to dependencies for timestamp parsing
use chrono;