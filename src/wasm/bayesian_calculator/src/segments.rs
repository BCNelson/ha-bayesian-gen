//! Turns an entity's state history plus the user's TRUE/FALSE periods into
//! duration-weighted segments ("the entity was in state S for D ms during a
//! TRUE/FALSE period").
//!
//! Home Assistant's bayesian sensor ignores observations whose entity is
//! `unavailable` / `unknown` (the observation evaluates to `None` and is
//! skipped), so time spent in those states is excluded from all statistics.

use crate::types::{HAHistoryEntry, TimePeriod};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct NumericStateStats {
    pub is_numeric: bool,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Time (ms) spent at each distinct value during TRUE periods, sorted by value.
    pub true_chunks: Vec<ValueDuration>,
    /// Time (ms) spent at each distinct value during FALSE periods, sorted by value.
    pub false_chunks: Vec<ValueDuration>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct ValueDuration {
    pub value: f64,
    pub duration: i64,
}

/// A stretch of time inside one labelled period during which the entity held
/// a single (available) state.
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub state: String,
    pub duration_ms: i64,
    pub is_true: bool,
    /// Index into the `periods` slice the segment came from.
    pub period_index: usize,
}

/// States Home Assistant's bayesian integration treats as "no observation".
pub fn is_ignored_state(state: &str) -> bool {
    state == "unavailable" || state == "unknown"
}

/// Parse a state the way HA's `numeric_state` condition does (`float(state)`);
/// non-finite values are rejected because they cannot be thresholded usefully.
pub fn parse_numeric(state: &str) -> Option<f64> {
    let v = state.trim().parse::<f64>().ok()?;
    if v.is_finite() {
        Some(v)
    } else {
        None
    }
}

/// An entity is numeric when at least 70% of its available history entries
/// parse as finite numbers.
pub fn is_numeric_entity(entity_history: &[HAHistoryEntry]) -> bool {
    let mut available = 0usize;
    let mut numeric = 0usize;
    for entry in entity_history {
        if is_ignored_state(&entry.state) {
            continue;
        }
        available += 1;
        if parse_numeric(&entry.state).is_some() {
            numeric += 1;
        }
    }
    available > 0 && (numeric as f64) >= (available as f64) * 0.7
}

pub fn parse_timestamp(iso_string: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso_string)
        .map(|dt| dt.timestamp_millis())
        .ok()
}

/// Build duration-weighted segments for every period.
///
/// The state in effect at a period's start is the last history entry at or
/// before that start; time before the first known entry is treated as unknown
/// and therefore excluded.
pub fn build_segments(entity_history: &[HAHistoryEntry], periods: &[TimePeriod]) -> Vec<Segment> {
    let mut history: Vec<(i64, &str)> = entity_history
        .iter()
        .filter_map(|e| parse_timestamp(&e.last_changed).map(|t| (t, e.state.as_str())))
        .collect();
    // Stable sort keeps the original order of entries sharing a timestamp, so
    // the last one wins below.
    history.sort_by_key(|&(t, _)| t);

    let mut segments = Vec::new();
    if history.is_empty() {
        return segments;
    }

    for (period_index, period) in periods.iter().enumerate() {
        let (start, end) = match (parse_timestamp(&period.start), parse_timestamp(&period.end)) {
            (Some(s), Some(e)) if e > s => (s, e),
            _ => continue,
        };

        let mut emit = |state: Option<&str>, duration: i64| {
            if let Some(state) = state {
                if duration > 0 && !is_ignored_state(state) {
                    segments.push(Segment {
                        state: state.to_string(),
                        duration_ms: duration,
                        is_true: period.is_true_period,
                        period_index,
                    });
                }
            }
        };

        let first_after_start = history.partition_point(|&(t, _)| t <= start);
        let mut current: Option<&str> = if first_after_start > 0 {
            Some(history[first_after_start - 1].1)
        } else {
            None
        };
        let mut cursor = start;

        for &(t, state) in &history[first_after_start..] {
            if t >= end {
                break;
            }
            if t > cursor {
                emit(current, t - cursor);
                cursor = t;
            }
            current = Some(state);
        }
        emit(current, end - cursor);
    }

    segments
}

/// A distinct numeric value with the time spent at it in TRUE / FALSE periods.
#[derive(Debug, Clone, PartialEq)]
pub struct WeightedValue {
    pub value: f64,
    pub true_ms: f64,
    pub false_ms: f64,
}

/// Aggregate numeric segments by value (sorted ascending). Segments whose state
/// is not numeric are dropped: HA's numeric_state observation evaluates to
/// `None` for them.
pub fn weighted_values(segments: &[Segment]) -> Vec<WeightedValue> {
    let mut points: Vec<(f64, bool, i64)> = segments
        .iter()
        .filter_map(|s| parse_numeric(&s.state).map(|v| (v, s.is_true, s.duration_ms)))
        .collect();
    points.sort_by(|a, b| a.0.total_cmp(&b.0));

    let mut out: Vec<WeightedValue> = Vec::new();
    for (value, is_true, dur) in points {
        match out.last_mut() {
            Some(last) if last.value == value => {
                if is_true {
                    last.true_ms += dur as f64;
                } else {
                    last.false_ms += dur as f64;
                }
            }
            _ => out.push(WeightedValue {
                value,
                true_ms: if is_true { dur as f64 } else { 0.0 },
                false_ms: if is_true { 0.0 } else { dur as f64 },
            }),
        }
    }
    out
}

pub fn numeric_stats(values: &[WeightedValue]) -> NumericStateStats {
    let chunks = |pick: fn(&WeightedValue) -> f64| -> Vec<ValueDuration> {
        values
            .iter()
            .filter(|v| pick(v) > 0.0)
            .map(|v| ValueDuration {
                value: v.value,
                duration: pick(v) as i64,
            })
            .collect()
    };
    NumericStateStats {
        is_numeric: true,
        min: values.first().map(|v| v.value),
        max: values.last().map(|v| v.value),
        true_chunks: chunks(|v| v.true_ms),
        false_chunks: chunks(|v| v.false_ms),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(state: &str, t: &str) -> HAHistoryEntry {
        HAHistoryEntry {
            state: state.to_string(),
            last_changed: t.to_string(),
            last_updated: t.to_string(),
            attributes: None,
        }
    }

    fn period(start: &str, end: &str, is_true: bool) -> TimePeriod {
        TimePeriod {
            id: format!("{start}-{end}"),
            start: start.to_string(),
            end: end.to_string(),
            is_true_period: is_true,
            label: None,
        }
    }

    #[test]
    fn segments_use_state_in_effect_at_period_start() {
        let history = vec![
            entry("on", "2024-01-01T00:00:00Z"),
            entry("off", "2024-01-01T01:30:00Z"),
        ];
        let periods = vec![period("2024-01-01T01:00:00Z", "2024-01-01T02:00:00Z", true)];
        let segs = build_segments(&history, &periods);
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].state, "on");
        assert_eq!(segs[0].duration_ms, 30 * 60 * 1000);
        assert_eq!(segs[1].state, "off");
        assert_eq!(segs[1].duration_ms, 30 * 60 * 1000);
    }

    #[test]
    fn segments_skip_unavailable_unknown_and_time_before_first_entry() {
        let history = vec![
            entry("on", "2024-01-01T00:30:00Z"),
            entry("unavailable", "2024-01-01T00:40:00Z"),
            entry("off", "2024-01-01T00:50:00Z"),
        ];
        let periods = vec![period("2024-01-01T00:00:00Z", "2024-01-01T01:00:00Z", false)];
        let segs = build_segments(&history, &periods);
        let total: i64 = segs.iter().map(|s| s.duration_ms).sum();
        assert_eq!(total, 20 * 60 * 1000);
        assert!(segs.iter().all(|s| s.state != "unavailable"));
    }

    #[test]
    fn segments_handle_unsorted_history_and_change_exactly_at_boundaries() {
        let history = vec![
            entry("b", "2024-01-01T02:00:00Z"),
            entry("a", "2024-01-01T01:00:00Z"),
        ];
        let periods = vec![period("2024-01-01T01:00:00Z", "2024-01-01T02:00:00Z", true)];
        let segs = build_segments(&history, &periods);
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].state, "a");
        assert_eq!(segs[0].duration_ms, 3_600_000);
    }

    #[test]
    fn numeric_detection_ignores_unavailable() {
        let history = vec![
            entry("1.5", "2024-01-01T00:00:00Z"),
            entry("unavailable", "2024-01-01T00:01:00Z"),
            entry("unknown", "2024-01-01T00:02:00Z"),
            entry("2", "2024-01-01T00:03:00Z"),
        ];
        assert!(is_numeric_entity(&history));
        let history = vec![entry("on", "2024-01-01T00:00:00Z"), entry("3", "2024-01-01T00:01:00Z")];
        assert!(!is_numeric_entity(&history));
    }

    #[test]
    fn weighted_values_merge_equal_values_and_drop_non_numeric() {
        let segs = vec![
            Segment { state: "2".into(), duration_ms: 10, is_true: true, period_index: 0 },
            Segment { state: "1".into(), duration_ms: 5, is_true: false, period_index: 1 },
            Segment { state: "2.0".into(), duration_ms: 7, is_true: false, period_index: 1 },
            Segment { state: "oops".into(), duration_ms: 99, is_true: false, period_index: 1 },
        ];
        let wv = weighted_values(&segs);
        assert_eq!(
            wv,
            vec![
                WeightedValue { value: 1.0, true_ms: 0.0, false_ms: 5.0 },
                WeightedValue { value: 2.0, true_ms: 10.0, false_ms: 7.0 },
            ]
        );
    }
}
