use crate::types::{
    HAHistoryEntry, StateAnalysis, StateSegment, TimePeriod, TimelineEntry, TimelineEntryType,
};
use rustc_hash::{FxHashMap, FxHashSet};

pub fn create_unified_timeline(
    entity_history: &[HAHistoryEntry],
    periods: &[TimePeriod],
) -> Vec<StateSegment> {
    let mut timeline: Vec<TimelineEntry> = Vec::new();

    // Add state changes to timeline
    for entry in entity_history {
        let time = parse_timestamp(&entry.last_changed);
        let value = entry.state.parse::<f64>().ok();
        timeline.push(TimelineEntry {
            time,
            entry_type: TimelineEntryType::StateChange,
            state: Some(entry.state.clone()),
            value,
            is_true_period: None,
        });
    }

    // Add period boundaries to timeline
    for period in periods {
        timeline.push(TimelineEntry {
            time: parse_timestamp(&period.start),
            entry_type: TimelineEntryType::PeriodStart,
            state: None,
            value: None,
            is_true_period: Some(period.is_true_period),
        });
        timeline.push(TimelineEntry {
            time: parse_timestamp(&period.end),
            entry_type: TimelineEntryType::PeriodEnd,
            state: None,
            value: None,
            is_true_period: Some(period.is_true_period),
        });
    }

    // Sort timeline by time
    timeline.sort_by_key(|entry| entry.time);

    // Build segments
    let mut segments = Vec::new();
    let mut current_state: Option<String> = None;
    let mut current_value: Option<f64> = None;
    let mut current_periods: FxHashSet<bool> = FxHashSet::default();

    for i in 0..timeline.len() {
        let entry = &timeline[i];
        let next_entry = timeline.get(i + 1);

        match entry.entry_type {
            TimelineEntryType::StateChange => {
                current_state = entry.state.clone();
                current_value = entry.value;
            }
            TimelineEntryType::PeriodStart => {
                if let Some(is_true) = entry.is_true_period {
                    current_periods.insert(is_true);
                }
            }
            TimelineEntryType::PeriodEnd => {
                if let Some(is_true) = entry.is_true_period {
                    current_periods.remove(&is_true);
                }
            }
        }

        // Create segment if we have a state and are in a period
        if let (Some(state), Some(next)) = (current_state.as_ref(), next_entry) {
            if !current_periods.is_empty() {
                let is_true_period = current_periods.contains(&true);
                segments.push(StateSegment {
                    start: entry.time,
                    end: next.time,
                    state: state.clone(),
                    value: current_value,
                    is_true_period,
                });
            }
        }
    }

    segments
}

pub fn analyze_state_segments_with_periods(
    entity_history: &[HAHistoryEntry],
    periods: &[TimePeriod],
) -> FxHashMap<String, StateAnalysis> {
    let mut state_analysis: FxHashMap<String, StateAnalysis> = FxHashMap::default();
    
    // Track which specific periods contain each state
    let mut state_in_true_periods: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();
    let mut state_in_false_periods: FxHashMap<String, FxHashSet<String>> = FxHashMap::default();

    // Analyze each period individually
    for period in periods {
        let period_start = parse_timestamp(&period.start);
        let period_end = parse_timestamp(&period.end);
        let period_id = format!("{}_{}", period_start, period_end); // Unique identifier for each period
        
        // Find the state at the beginning of the period
        let mut period_states: FxHashSet<String> = FxHashSet::default();
        let mut current_state: Option<String> = None;
        
        // Find initial state before period starts
        for entry in entity_history {
            let entry_time = parse_timestamp(&entry.last_changed);
            if entry_time <= period_start {
                current_state = Some(entry.state.clone());
            } else {
                break;
            }
        }
        
        // Track all states that occur during this period
        for entry in entity_history {
            let entry_time = parse_timestamp(&entry.last_changed);
            
            if entry_time > period_start && entry_time < period_end {
                current_state = Some(entry.state.clone());
            }
            
            if entry_time >= period_start && entry_time <= period_end {
                if let Some(ref state) = current_state {
                    period_states.insert(state.clone());
                }
            }
        }
        
        // Add the final state if we have one
        if let Some(ref state) = current_state {
            period_states.insert(state.clone());
        }
        
        // Record which states appeared in this period
        for state in period_states {
            if period.is_true_period {
                state_in_true_periods
                    .entry(state.clone())
                    .or_insert_with(FxHashSet::default)
                    .insert(period_id.clone());
            } else {
                state_in_false_periods
                    .entry(state.clone())
                    .or_insert_with(FxHashSet::default)
                    .insert(period_id.clone());
            }
        }
    }

    // Count how many periods each state appeared in
    let mut all_states: FxHashSet<String> = FxHashSet::default();
    all_states.extend(state_in_true_periods.keys().cloned());
    all_states.extend(state_in_false_periods.keys().cloned());

    for state in all_states {
        let true_count = state_in_true_periods
            .get(&state)
            .map(|periods| periods.len())
            .unwrap_or(0);
        
        let false_count = state_in_false_periods
            .get(&state)
            .map(|periods| periods.len())
            .unwrap_or(0);

        state_analysis.insert(state, StateAnalysis {
            true_occurrences: true_count,
            false_occurrences: false_count,
        });
    }

    state_analysis
}

pub fn analyze_state_segments(segments: &[StateSegment]) -> FxHashMap<String, StateAnalysis> {
    // This function is kept for backwards compatibility but should not be used
    // The issue is in the segment creation logic, not the analysis
    let mut state_analysis: FxHashMap<String, StateAnalysis> = FxHashMap::default();
    
    // Track which periods (by start time) contain each state
    let mut state_in_true_periods: FxHashMap<String, FxHashSet<i64>> = FxHashMap::default();
    let mut state_in_false_periods: FxHashMap<String, FxHashSet<i64>> = FxHashMap::default();

    for segment in segments {
        let duration = segment.end - segment.start;
        if duration < 1000 {
            continue; // Skip segments shorter than 1 second
        }

        let state_key = segment.state.clone();
        
        // Use segment start time as period identifier
        if segment.is_true_period {
            state_in_true_periods
                .entry(state_key.clone())
                .or_insert_with(FxHashSet::default)
                .insert(segment.start);
        } else {
            state_in_false_periods
                .entry(state_key.clone())
                .or_insert_with(FxHashSet::default)
                .insert(segment.start);
        }
    }

    // Count how many periods each state appeared in
    let mut all_states: FxHashSet<String> = FxHashSet::default();
    all_states.extend(state_in_true_periods.keys().cloned());
    all_states.extend(state_in_false_periods.keys().cloned());

    for state in all_states {
        let true_count = state_in_true_periods
            .get(&state)
            .map(|periods| periods.len())
            .unwrap_or(0);
        
        let false_count = state_in_false_periods
            .get(&state)
            .map(|periods| periods.len())
            .unwrap_or(0);

        state_analysis.insert(state, StateAnalysis {
            true_occurrences: true_count,
            false_occurrences: false_count,
        });
    }

    state_analysis
}

pub fn analyze_numeric_segments(segments: &[StateSegment]) -> FxHashMap<String, Box<StateAnalysis>> {
    let mut state_analysis: FxHashMap<String, Box<StateAnalysis>> = FxHashMap::default();

    let mut true_values = Vec::new();
    let mut false_values = Vec::new();

    for segment in segments {
        if let Some(value) = segment.value {
            if segment.is_true_period {
                true_values.push(value);
            } else {
                false_values.push(value);
            }
        }
    }

    let true_mean = if !true_values.is_empty() {
        true_values.iter().sum::<f64>() / true_values.len() as f64
    } else {
        0.0
    };

    let false_mean = if !false_values.is_empty() {
        false_values.iter().sum::<f64>() / false_values.len() as f64
    } else {
        0.0
    };

    let state = format!("mean_true: {:.2}, mean_false: {:.2}", true_mean, false_mean);
    state_analysis.insert(
        state,
        Box::new(StateAnalysis {
            true_occurrences: true_values.len(),
            false_occurrences: false_values.len(),
        }),
    );

    state_analysis
}

fn parse_timestamp(iso_string: &str) -> i64 {
    // Simple ISO 8601 parser for timestamps
    chrono::DateTime::parse_from_rfc3339(iso_string)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

// Add chrono to dependencies for timestamp parsing
use chrono;