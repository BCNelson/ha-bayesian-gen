mod scoring;
mod segments;
mod threshold;
mod types;

use std::collections::{BTreeMap, HashMap, HashSet};
use types::{EntityProbability, HAHistoryEntry, NumericRange, TimePeriod};
use wasm_bindgen::prelude::*;

#[cfg(feature = "parallel")]
pub use wasm_bindgen_rayon::init_thread_pool;

#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
}

/// The single analysis engine of the application.
///
/// For every entity it measures, duration-weighted over the user's labelled
/// TRUE/FALSE periods, how likely each candidate observation is under TRUE
/// (`prob_given_true`) and FALSE (`prob_given_false`), using Home Assistant's
/// bayesian semantics (see `threshold.rs` / `segments.rs`).
#[wasm_bindgen]
pub struct BayesianCalculator {}

impl Default for BayesianCalculator {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl BayesianCalculator {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {}
    }

    #[wasm_bindgen]
    pub fn calculate_entity_probabilities(
        &mut self,
        history: JsValue,
        periods: JsValue,
    ) -> Result<JsValue, JsValue> {
        let history: HashMap<String, Vec<HAHistoryEntry>> = serde_wasm_bindgen::from_value(history)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse history: {}", e)))?;
        let periods: Vec<TimePeriod> = serde_wasm_bindgen::from_value(periods)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse periods: {}", e)))?;

        let results = process_entities(&history, &periods).map_err(|e| JsValue::from_str(&e))?;

        serde_wasm_bindgen::to_value(&results)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize results: {}", e)))
    }
}

pub(crate) fn process_entities(
    history: &HashMap<String, Vec<HAHistoryEntry>>,
    periods: &[TimePeriod],
) -> Result<Vec<EntityProbability>, String> {
    let total_true_periods = periods.iter().filter(|p| p.is_true_period).count();
    let total_false_periods = periods.len() - total_true_periods;
    if total_true_periods == 0 || total_false_periods == 0 {
        return Err("Need at least one TRUE and one FALSE period".to_string());
    }
    let counts = PeriodCounts { total_true_periods, total_false_periods };

    let mut results = Vec::new();
    for (entity_id, entity_history) in history {
        if entity_history.is_empty() {
            continue;
        }
        let segs = segments::build_segments(entity_history, periods);
        if segments::is_numeric_entity(entity_history) {
            if let Some(r) = analyze_numeric(entity_id, &segs, periods, counts) {
                results.push(r);
            }
        } else {
            results.extend(analyze_states(entity_id, &segs, periods, counts));
        }
    }

    results.sort_by(|a, b| {
        b.information_score
            .total_cmp(&a.information_score)
            .then_with(|| a.entity_id.cmp(&b.entity_id))
            .then_with(|| a.state.cmp(&b.state))
    });
    Ok(results)
}

#[derive(Clone, Copy)]
struct PeriodCounts {
    total_true_periods: usize,
    total_false_periods: usize,
}

/// Count TRUE / FALSE periods in which `matches` held for some segment.
fn occurrences<F: Fn(&segments::Segment) -> bool>(
    segs: &[segments::Segment],
    periods: &[TimePeriod],
    matches: F,
) -> (usize, usize) {
    let hit: HashSet<usize> = segs.iter().filter(|s| matches(s)).map(|s| s.period_index).collect();
    let t = hit.iter().filter(|&&i| periods[i].is_true_period).count();
    (t, hit.len() - t)
}

/// Duration-weighted `(P(match|TRUE), P(match|FALSE))`, unclamped.
fn match_probabilities<F: Fn(&segments::Segment) -> bool>(
    segs: &[segments::Segment],
    matches: F,
) -> Option<(f64, f64)> {
    let (mut t_total, mut f_total, mut t_hit, mut f_hit) = (0i64, 0i64, 0i64, 0i64);
    for s in segs {
        let hit = matches(s);
        if s.is_true {
            t_total += s.duration_ms;
            if hit {
                t_hit += s.duration_ms;
            }
        } else {
            f_total += s.duration_ms;
            if hit {
                f_hit += s.duration_ms;
            }
        }
    }
    if t_total == 0 || f_total == 0 {
        return None;
    }
    Some((t_hit as f64 / t_total as f64, f_hit as f64 / f_total as f64))
}

fn analyze_states(
    entity_id: &str,
    segs: &[segments::Segment],
    periods: &[TimePeriod],
    counts: PeriodCounts,
) -> Vec<EntityProbability> {
    let states: BTreeMap<&str, ()> = segs.iter().map(|s| (s.state.as_str(), ())).collect();
    let mut out = Vec::new();
    for state in states.keys() {
        // HA `state` observation: match iff the entity's state == to_state.
        let Some((pt_raw, pf_raw)) = match_probabilities(segs, |s| s.state == *state) else {
            continue;
        };
        let pt = scoring::clamp_probability(pt_raw);
        let pf = scoring::clamp_probability(pf_raw);
        let (true_occ, false_occ) = occurrences(segs, periods, |s| s.state == *state);
        out.push(EntityProbability {
            entity_id: entity_id.to_string(),
            state: state.to_string(),
            prob_given_true: pt,
            prob_given_false: pf,
            discrimination_power: (pt - pf).abs(),
            information_score: scoring::single_observation_score(pt, pf),
            true_occurrences: true_occ,
            false_occurrences: false_occ,
            total_true_periods: counts.total_true_periods,
            total_false_periods: counts.total_false_periods,
            numeric_stats: None,
            optimal_thresholds: None,
            ranges: None,
        });
    }
    out
}

fn analyze_numeric(
    entity_id: &str,
    segs: &[segments::Segment],
    periods: &[TimePeriod],
    counts: PeriodCounts,
) -> Option<EntityProbability> {
    let values = segments::weighted_values(segs);
    let model = threshold::choose_numeric_model(&values)?;
    // Non-numeric states evaluate to `None` in HA and are excluded.
    let numeric_only: Vec<segments::Segment> = segs
        .iter()
        .filter(|s| segments::parse_numeric(&s.state).is_some())
        .cloned()
        .collect();
    let value_of = |s: &segments::Segment| segments::parse_numeric(&s.state).unwrap_or(f64::NAN);

    let stats = Some(segments::numeric_stats(&values));

    match &model {
        threshold::NumericModel::Single { above, below } => {
            let (above, below) = (*above, *below);
            let matcher = |s: &segments::Segment| threshold::matches_single(value_of(s), above, below);
            let (pt_raw, pf_raw) = match_probabilities(&numeric_only, matcher)?;
            let pt = scoring::clamp_probability(pt_raw);
            let pf = scoring::clamp_probability(pf_raw);
            let (true_occ, false_occ) = occurrences(&numeric_only, periods, matcher);
            Some(EntityProbability {
                entity_id: entity_id.to_string(),
                state: threshold::format_bounds(above, below, false),
                prob_given_true: pt,
                prob_given_false: pf,
                discrimination_power: (pt - pf).abs(),
                information_score: scoring::single_observation_score(pt, pf),
                true_occurrences: true_occ,
                false_occurrences: false_occ,
                total_true_periods: counts.total_true_periods,
                total_false_periods: counts.total_false_periods,
                numeric_stats: stats,
                optimal_thresholds: Some(threshold::OptimalThresholds { above, below }),
                ranges: None,
            })
        }
        threshold::NumericModel::Partition { .. } => {
            let mut ranges = Vec::new();
            let mut raw = Vec::new();
            for (above, below) in model.ranges() {
                let matcher = |s: &segments::Segment| threshold::matches_multi_range(value_of(s), above, below);
                let (pt_raw, pf_raw) = match_probabilities(&numeric_only, matcher)?;
                raw.push((pt_raw, pf_raw));
                ranges.push(NumericRange {
                    above,
                    below,
                    prob_given_true: scoring::clamp_probability(pt_raw),
                    prob_given_false: scoring::clamp_probability(pf_raw),
                });
            }
            let clamped: Vec<(f64, f64)> = ranges.iter().map(|r| (r.prob_given_true, r.prob_given_false)).collect();
            // Headline range (for the single-value fields the UI shows): the
            // range whose own match/non-match split is most informative.
            let headline = ranges
                .iter()
                .max_by(|a, b| {
                    scoring::single_observation_score(a.prob_given_true, a.prob_given_false)
                        .total_cmp(&scoring::single_observation_score(b.prob_given_true, b.prob_given_false))
                })
                .cloned()?;
            let (true_occ, false_occ) = occurrences(&numeric_only, periods, |s| {
                threshold::matches_multi_range(value_of(s), headline.above, headline.below)
            });
            let state = ranges
                .iter()
                .map(|r| threshold::format_bounds(r.above, r.below, true))
                .collect::<Vec<_>>()
                .join(" | ");
            Some(EntityProbability {
                entity_id: entity_id.to_string(),
                state,
                prob_given_true: headline.prob_given_true,
                prob_given_false: headline.prob_given_false,
                discrimination_power: scoring::total_variation(&raw),
                information_score: scoring::jeffreys_divergence(&clamped),
                true_occurrences: true_occ,
                false_occurrences: false_occ,
                total_true_periods: counts.total_true_periods,
                total_false_periods: counts.total_false_periods,
                numeric_stats: stats,
                optimal_thresholds: Some(threshold::OptimalThresholds {
                    above: headline.above,
                    below: headline.below,
                }),
                ranges: Some(ranges),
            })
        }
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

    fn hour(h: u32) -> String {
        format!("2024-01-01T{:02}:00:00Z", h)
    }

    #[test]
    fn requires_both_period_kinds() {
        let history = HashMap::new();
        assert!(process_entities(&history, &[period(&hour(0), &hour(1), true)]).is_err());
    }

    #[test]
    fn state_entity_probabilities_are_duration_weighted_and_ignore_unavailable() {
        // TRUE 00-04: on 3h, unavailable 1h. FALSE 04-08: off 3h, on 1h.
        let mut history = HashMap::new();
        history.insert(
            "binary_sensor.motion".to_string(),
            vec![
                entry("on", &hour(0)),
                entry("unavailable", &hour(3)),
                entry("off", &hour(4)),
                entry("on", &hour(7)),
            ],
        );
        let periods = vec![period(&hour(0), &hour(4), true), period(&hour(4), &hour(8), false)];
        let results = process_entities(&history, &periods).unwrap();
        assert!(results.iter().all(|r| r.state != "unavailable"));
        let on = results.iter().find(|r| r.state == "on").unwrap();
        assert!((on.prob_given_true - 0.99).abs() < 1e-9); // 3h/3h clamped
        assert!((on.prob_given_false - 0.25).abs() < 1e-9);
        assert_eq!(on.true_occurrences, 1);
        assert_eq!(on.false_occurrences, 1);
        assert!(on.information_score > 0.0);
        // Sorted by information score.
        for w in results.windows(2) {
            assert!(w[0].information_score >= w[1].information_score);
        }
    }

    #[test]
    fn numeric_entity_uses_ha_boundaries() {
        // TRUE: 25 for 4h. FALSE: 15 for 4h.
        let mut history = HashMap::new();
        history.insert(
            "sensor.temp".to_string(),
            vec![entry("25", &hour(0)), entry("15", &hour(4))],
        );
        let periods = vec![period(&hour(0), &hour(4), true), period(&hour(4), &hour(8), false)];
        let results = process_entities(&history, &periods).unwrap();
        assert_eq!(results.len(), 1);
        let r = &results[0];
        let t = r.optimal_thresholds.as_ref().unwrap();
        assert_eq!(t.above, Some(20.0));
        assert_eq!(t.below, None);
        assert!((r.prob_given_true - 0.99).abs() < 1e-9);
        assert!((r.prob_given_false - 0.01).abs() < 1e-9);
        assert!(r.ranges.is_none());
        assert_eq!(r.state, "> 20");
    }

    #[test]
    fn numeric_entity_with_three_regimes_emits_ranges() {
        // Hourly samples: values in 0..10 only during TRUE, 10..20 only FALSE,
        // 20..30 half/half.
        let mut entries = Vec::new();
        let mut periods = Vec::new();
        let mut h = 0u32;
        let mut push = |v: f64, is_true: bool, entries: &mut Vec<HAHistoryEntry>, periods: &mut Vec<TimePeriod>| {
            let start = format!("2024-01-{:02}T{:02}:00:00Z", 1 + h / 24, h % 24);
            let end = format!("2024-01-{:02}T{:02}:00:00Z", 1 + (h + 1) / 24, (h + 1) % 24);
            entries.push(entry(&v.to_string(), &start));
            periods.push(period(&start, &end, is_true));
            h += 1;
        };
        for v in 0..10 {
            push(v as f64, true, &mut entries, &mut periods);
        }
        for v in 10..20 {
            push(v as f64, false, &mut entries, &mut periods);
        }
        for v in 20..30 {
            push(v as f64, v % 2 == 0, &mut entries, &mut periods);
            push(v as f64 + 0.5, v % 2 == 1, &mut entries, &mut periods);
        }
        let mut history = HashMap::new();
        history.insert("sensor.x".to_string(), entries);
        let results = process_entities(&history, &periods).unwrap();
        let r = &results[0];
        let ranges = r.ranges.as_ref().expect("expected ranges");
        assert_eq!(ranges.len(), 3);
        assert_eq!(ranges[0].above, None);
        assert_eq!(ranges[2].below, None);
        assert_eq!(ranges[0].below, ranges[1].above);
        assert_eq!(ranges[1].below, ranges[2].above);
        assert!(ranges[0].prob_given_true > ranges[0].prob_given_false);
        assert!(ranges[1].prob_given_true < ranges[1].prob_given_false);
    }

    #[test]
    fn non_numeric_states_of_numeric_entity_are_ignored() {
        let mut history = HashMap::new();
        history.insert(
            "sensor.power".to_string(),
            vec![
                entry("100", &hour(0)),
                entry("unknown", &hour(2)),
                entry("5", &hour(4)),
            ],
        );
        let periods = vec![period(&hour(0), &hour(4), true), period(&hour(4), &hour(8), false)];
        let results = process_entities(&history, &periods).unwrap();
        let r = &results[0];
        // TRUE time is only the 2h at 100 -> fully matching.
        assert!((r.prob_given_true - 0.99).abs() < 1e-9);
    }
}
