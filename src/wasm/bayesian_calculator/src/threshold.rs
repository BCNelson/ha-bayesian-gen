use crate::sensor_analysis::{NumericStateStats, ValueDuration};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use std::collections::HashMap;

pub type ThresholdCache = HashMap<String, OptimalThresholds>;

/// Check if a value matches the given thresholds
pub fn value_matches_thresholds(value: f64, thresholds: &OptimalThresholds) -> bool {
    match (thresholds.above, thresholds.below) {
        (Some(above), Some(below)) => value > above && value <= below,
        (Some(above), None) => value > above,
        (None, Some(below)) => value <= below,
        (None, None) => false,
    }
}

/// Format threshold description for display
pub fn format_threshold_description(thresholds: &OptimalThresholds) -> String {
    match (thresholds.above, thresholds.below) {
        (Some(above), Some(below)) => format!("{:.2} < value <= {:.2}", above, below),
        (Some(above), None) => format!("> {:.2}", above),
        (None, Some(below)) => format!("<= {:.2}", below),
        (None, None) => "numeric".to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct OptimalThresholds {
    pub above: Option<f64>,
    pub below: Option<f64>,
}

pub fn find_optimal_numeric_thresholds(stats: &NumericStateStats) -> OptimalThresholds {
    if !stats.is_numeric || stats.true_chunks.is_empty() || stats.false_chunks.is_empty() {
        return OptimalThresholds {
            above: None,
            below: None,
        };
    }

    let min = stats.min.unwrap_or(0.0);
    let max = stats.max.unwrap_or(100.0);

    // Sort chunks once for efficiency
    let mut sorted_true_chunks = stats.true_chunks.clone();
    let mut sorted_false_chunks = stats.false_chunks.clone();
    sorted_true_chunks.sort_by(|a, b| a.value.partial_cmp(&b.value).unwrap());
    sorted_false_chunks.sort_by(|a, b| a.value.partial_cmp(&b.value).unwrap());

    // Generate threshold candidates
    let mut candidates = Vec::new();
    
    // Add all unique values
    for chunk in &stats.true_chunks {
        candidates.push(chunk.value);
    }
    for chunk in &stats.false_chunks {
        candidates.push(chunk.value);
    }

    // Add midpoints between consecutive values
    let mut all_values: Vec<f64> = candidates.clone();
    all_values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    all_values.dedup();

    for i in 0..all_values.len().saturating_sub(1) {
        let midpoint = (all_values[i] + all_values[i + 1]) / 2.0;
        candidates.push(midpoint);
    }

    // Add evenly spaced values across the range
    let range = max - min;
    let step = range / 20.0;
    for i in 0..=20 {
        candidates.push(min + (step * i as f64));
    }

    candidates.sort_by(|a, b| a.partial_cmp(b).unwrap());
    candidates.dedup();

    let mut best_score = -1.0;
    let mut best_thresholds = OptimalThresholds {
        above: None,
        below: None,
    };

    // Test above-only thresholds
    for &threshold in &candidates {
        let score = calculate_threshold_score(
            &sorted_true_chunks,
            &sorted_false_chunks,
            Some(threshold),
            None,
        );
        if score > best_score {
            best_score = score;
            best_thresholds = OptimalThresholds {
                above: Some(threshold),
                below: None,
            };
        }
    }

    // Test below-only thresholds
    for &threshold in &candidates {
        let score = calculate_threshold_score(
            &sorted_true_chunks,
            &sorted_false_chunks,
            None,
            Some(threshold),
        );
        if score > best_score {
            best_score = score;
            best_thresholds = OptimalThresholds {
                above: None,
                below: Some(threshold),
            };
        }
    }

    // Test range thresholds (above and below)
    // Limit to reasonable number of combinations for performance
    let max_range_tests = 100;
    let step = ((candidates.len() * candidates.len()) / max_range_tests).max(1);
    let mut test_count = 0;

    for i in 0..candidates.len() - 1 {
        if test_count >= max_range_tests {
            break;
        }
        for j in (i + 1..candidates.len()).step_by(step) {
            let above = candidates[i];
            let below = candidates[j];
            let score = calculate_threshold_score(
                &sorted_true_chunks,
                &sorted_false_chunks,
                Some(above),
                Some(below),
            );
            if score > best_score {
                best_score = score;
                best_thresholds = OptimalThresholds {
                    above: Some(above),
                    below: Some(below),
                };
            }
            test_count += 1;
            if test_count >= max_range_tests {
                break;
            }
        }
    }

    best_thresholds
}

fn calculate_threshold_score(
    sorted_true_chunks: &[ValueDuration],
    sorted_false_chunks: &[ValueDuration],
    above: Option<f64>,
    below: Option<f64>,
) -> f64 {
    let true_stats = calculate_chunks_in_range(sorted_true_chunks, above, below);
    let false_stats = calculate_chunks_in_range(sorted_false_chunks, above, below);

    let true_pct = if true_stats.total_duration > 0 {
        true_stats.matching_duration as f64 / true_stats.total_duration as f64
    } else {
        0.0
    };

    let false_pct = if false_stats.total_duration > 0 {
        false_stats.matching_duration as f64 / false_stats.total_duration as f64
    } else {
        0.0
    };

    (true_pct - false_pct).abs()
}

struct ChunkStats {
    matching_duration: i64,
    total_duration: i64,
}

fn calculate_chunks_in_range(
    sorted_chunks: &[ValueDuration],
    above: Option<f64>,
    below: Option<f64>,
) -> ChunkStats {
    let mut total_duration = 0i64;
    let mut matching_duration = 0i64;

    // Use binary search to find range boundaries
    let start_idx = if let Some(threshold) = above {
        binary_search_first_above(sorted_chunks, threshold)
    } else {
        0
    };

    let end_idx = if let Some(threshold) = below {
        binary_search_last_below(sorted_chunks, threshold)
    } else {
        sorted_chunks.len()
    };

    for (i, chunk) in sorted_chunks.iter().enumerate() {
        total_duration += chunk.duration;
        
        if i >= start_idx && i < end_idx {
            matching_duration += chunk.duration;
        }
    }

    ChunkStats {
        matching_duration,
        total_duration,
    }
}

fn binary_search_first_above(chunks: &[ValueDuration], threshold: f64) -> usize {
    let mut left = 0;
    let mut right = chunks.len();

    while left < right {
        let mid = (left + right) / 2;
        if chunks[mid].value <= threshold {
            left = mid + 1;
        } else {
            right = mid;
        }
    }

    left
}

fn binary_search_last_below(chunks: &[ValueDuration], threshold: f64) -> usize {
    let mut left = 0;
    let mut right = chunks.len();

    while left < right {
        let mid = (left + right) / 2;
        if chunks[mid].value <= threshold {
            left = mid + 1;
        } else {
            right = mid;
        }
    }

    left
}

pub fn get_cache_key(stats: &NumericStateStats) -> String {
    // Create a cache key from the first few chunks
    let true_key: String = stats
        .true_chunks
        .iter()
        .take(5)
        .map(|c| format!("{:.2}-{}", c.value, c.duration))
        .collect::<Vec<_>>()
        .join(",");

    let false_key: String = stats
        .false_chunks
        .iter()
        .take(5)
        .map(|c| format!("{:.2}-{}", c.value, c.duration))
        .collect::<Vec<_>>()
        .join(",");

    format!("{}|{}", true_key, false_key)
}