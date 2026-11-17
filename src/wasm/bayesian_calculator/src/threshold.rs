//! Numeric threshold / range selection with Home Assistant boundary semantics.
//!
//! HA (`homeassistant/components/bayesian/binary_sensor.py`,
//! `_process_numeric_state`, which calls `condition.async_numeric_state`):
//!
//! * A `numeric_state` observation matches when `above < value < below`
//!   (both bounds exclusive; a missing bound is unbounded). If it does not
//!   match the observation is *False* and HA applies the non-match update
//!   (`1 - prob_given_true`, `1 - prob_given_false`).
//! * When an entity has more than one observation ("multi"), a value equal
//!   to `below` also counts as a match (so ranges are `above < v <= below`),
//!   and a non-matching range evaluates to `None` (ignored, no update).
//!   HA's config validation rejects overlapping ranges for the same entity.
//! * Non-numeric / unavailable / unknown states evaluate to `None`.

use crate::scoring::jensen_shannon;
use crate::segments::WeightedValue;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct OptimalThresholds {
    pub above: Option<f64>,
    pub below: Option<f64>,
}

/// Match test for a lone `numeric_state` observation (HA: both bounds exclusive).
pub fn matches_single(value: f64, above: Option<f64>, below: Option<f64>) -> bool {
    above.map_or(true, |a| value > a) && below.map_or(true, |b| value < b)
}

/// Match test for one of several `numeric_state` observations on the same
/// entity (HA "multi" mode: `below` becomes inclusive).
pub fn matches_multi_range(value: f64, above: Option<f64>, below: Option<f64>) -> bool {
    above.map_or(true, |a| value > a) && below.map_or(true, |b| value <= b)
}

pub fn format_bounds(above: Option<f64>, below: Option<f64>, below_inclusive: bool) -> String {
    let lt = if below_inclusive { "<=" } else { "<" };
    match (above, below) {
        (Some(a), Some(b)) => format!("{} < value {} {}", fmt_num(a), lt, fmt_num(b)),
        (Some(a), None) => format!("> {}", fmt_num(a)),
        (None, Some(b)) => format!("{} {}", lt, fmt_num(b)),
        (None, None) => "numeric".to_string(),
    }
}

fn fmt_num(v: f64) -> String {
    // Trim trailing zeros produced by fixed formatting.
    let s = format!("{:.6}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" {
        "0".to_string()
    } else {
        s.to_string()
    }
}

/// The numeric observation structure chosen for an entity.
#[derive(Debug, Clone, PartialEq)]
pub enum NumericModel {
    /// A single observation; the non-match update carries the complement.
    Single { above: Option<f64>, below: Option<f64> },
    /// Three mutually exclusive ranges: `(-inf, c0]`, `(c0, c1]`, `(c1, inf)`.
    /// Two complementary ranges are never produced: they are equivalent to a
    /// single threshold and HA raises a "mirrored entries" repair for them.
    Partition { cuts: [f64; 2] },
}

impl NumericModel {
    /// The ranges this model expands to, as `(above, below)` pairs.
    pub fn ranges(&self) -> Vec<(Option<f64>, Option<f64>)> {
        match self {
            NumericModel::Single { above, below } => vec![(*above, *below)],
            NumericModel::Partition { cuts } => vec![
                (None, Some(cuts[0])),
                (Some(cuts[0]), Some(cuts[1])),
                (Some(cuts[1]), None),
            ],
        }
    }
}

/// Maximum number of candidate cut points (chosen at balanced-mass quantiles).
const MAX_CANDIDATES: usize = 48;
/// Every bin of a candidate split must hold at least this share of the
/// (TRUE/FALSE-balanced) time, to avoid fitting to noise.
const MIN_BIN_MASS: f64 = 0.05;
/// A 3-range partition must beat the best single observation by this factor…
const PARTITION_MIN_RATIO: f64 = 1.15;
/// …and by at least this many bits of Jensen–Shannon divergence.
const PARTITION_MIN_GAIN_BITS: f64 = 0.02;

/// Choose the most informative numeric observation structure for an entity.
///
/// Candidate cut points are midpoints between consecutive distinct observed
/// values, thinned to at most `MAX_CANDIDATES` at quantiles of the balanced
/// (TRUE and FALSE equally weighted) time distribution. Every candidate
/// structure is scored by the Jensen–Shannon divergence of the outcome
/// distribution it induces in HA:
///
/// * single threshold — {match, non-match}
/// * band (`above` and `below`) — {inside, outside}
/// * 3-range partition — {range 1, range 2, range 3}
///
/// The partition is only chosen when it is materially more informative than
/// the best single observation.
pub fn choose_numeric_model(values: &[WeightedValue]) -> Option<NumericModel> {
    let n = values.len();
    if n < 2 {
        return None;
    }
    let total_t: f64 = values.iter().map(|v| v.true_ms).sum();
    let total_f: f64 = values.iter().map(|v| v.false_ms).sum();
    if total_t <= 0.0 || total_f <= 0.0 {
        return None;
    }

    // Prefix sums of normalised mass: pt[k] = P(value < values[k] | TRUE).
    let mut pt = vec![0.0; n + 1];
    let mut pf = vec![0.0; n + 1];
    for (i, v) in values.iter().enumerate() {
        pt[i + 1] = pt[i] + v.true_ms / total_t;
        pf[i + 1] = pf[i] + v.false_ms / total_f;
    }
    let bin = |from: usize, to: usize| (pt[to] - pt[from], pf[to] - pf[from]);
    let mass_ok = |b: (f64, f64)| 0.5 * (b.0 + b.1) >= MIN_BIN_MASS;

    // Candidate cut indices k in 1..n (cut between values[k-1] and values[k]).
    let candidates: Vec<usize> = if n - 1 <= MAX_CANDIDATES {
        (1..n).collect()
    } else {
        let mut ks = Vec::with_capacity(MAX_CANDIDATES);
        for q in 1..=MAX_CANDIDATES {
            let target = q as f64 / (MAX_CANDIDATES + 1) as f64;
            // first k where balanced cumulative mass reaches target
            let k = (1..n)
                .find(|&k| 0.5 * (pt[k] + pf[k]) >= target)
                .unwrap_or(n - 1);
            if ks.last() != Some(&k) {
                ks.push(k);
            }
        }
        ks
    };

    let cut_value = |k: usize| nice_cut(values[k - 1].value, values[k].value);

    // Best single observation: threshold or band.
    let mut best_single: Option<(f64, NumericModel)> = None;
    let mut consider_single = |score: f64, model: NumericModel| {
        if best_single.as_ref().map_or(true, |(s, _)| score > *s + 1e-12) {
            best_single = Some((score, model));
        }
    };

    for &k in &candidates {
        let low = bin(0, k);
        let high = bin(k, n);
        if !(mass_ok(low) && mass_ok(high)) {
            continue;
        }
        let score = jensen_shannon(&[low, high]);
        let c = cut_value(k);
        // Orient the observation so that a *match* points towards TRUE.
        let model = if high.0 >= high.1 {
            NumericModel::Single { above: Some(c), below: None }
        } else {
            NumericModel::Single { above: None, below: Some(c) }
        };
        consider_single(score, model);
    }

    let mut best_partition: Option<(f64, NumericModel)> = None;
    for (ii, &i) in candidates.iter().enumerate() {
        for &j in &candidates[ii + 1..] {
            let low = bin(0, i);
            let mid = bin(i, j);
            let high = bin(j, n);
            if !(mass_ok(low) && mass_ok(mid) && mass_ok(high)) {
                continue;
            }
            let (ci, cj) = (cut_value(i), cut_value(j));

            let outside = (low.0 + high.0, low.1 + high.1);
            let band_score = jensen_shannon(&[mid, outside]);
            consider_single(
                band_score,
                NumericModel::Single { above: Some(ci), below: Some(cj) },
            );

            let part_score = jensen_shannon(&[low, mid, high]);
            if best_partition.as_ref().map_or(true, |(s, _)| part_score > *s + 1e-12) {
                best_partition = Some((part_score, NumericModel::Partition { cuts: [ci, cj] }));
            }
        }
    }

    match (best_single, best_partition) {
        (Some((s, single)), Some((p, part))) => {
            if p >= s * PARTITION_MIN_RATIO && p - s >= PARTITION_MIN_GAIN_BITS {
                Some(part)
            } else {
                Some(single)
            }
        }
        (Some((_, single)), None) => Some(single),
        (None, Some((_, part))) => Some(part),
        (None, None) => None,
    }
}

/// Pick a "round" number strictly between two consecutive observed values so
/// that the generated YAML is readable and no observed value sits exactly on
/// a boundary (which would make HA's inclusive/exclusive rules matter).
pub fn nice_cut(lo: f64, hi: f64) -> f64 {
    let mid = 0.5 * (lo + hi);
    for decimals in 0..=6 {
        let scale = 10f64.powi(decimals);
        let r = (mid * scale).round() / scale;
        if r > lo && r < hi {
            return r;
        }
    }
    mid
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wv(value: f64, t: f64, f: f64) -> WeightedValue {
        WeightedValue { value, true_ms: t, false_ms: f }
    }

    #[test]
    fn single_bounds_are_exclusive() {
        assert!(!matches_single(10.0, Some(10.0), None));
        assert!(!matches_single(10.0, None, Some(10.0)));
        assert!(matches_single(10.5, Some(10.0), Some(11.0)));
        assert!(!matches_single(11.0, Some(10.0), Some(11.0)));
    }

    #[test]
    fn multi_range_below_is_inclusive() {
        assert!(matches_multi_range(11.0, Some(10.0), Some(11.0)));
        assert!(!matches_multi_range(10.0, Some(10.0), Some(11.0)));
        assert!(matches_multi_range(10.0, None, Some(10.0)));
    }

    #[test]
    fn partition_ranges_cover_every_value_exactly_once() {
        let model = NumericModel::Partition { cuts: [10.0, 20.0] };
        for v in [-5.0, 10.0, 10.0001, 15.0, 20.0, 20.5, 1e9] {
            let hits = model
                .ranges()
                .iter()
                .filter(|(a, b)| matches_multi_range(v, *a, *b))
                .count();
            assert_eq!(hits, 1, "value {v}");
        }
    }

    #[test]
    fn nice_cut_is_strictly_between() {
        assert_eq!(nice_cut(20.0, 21.0), 20.5);
        assert_eq!(nice_cut(19.0, 23.0), 21.0);
        let c = nice_cut(0.1234, 0.1235);
        assert!(c > 0.1234 && c < 0.1235);
    }

    #[test]
    fn separable_data_gives_above_threshold() {
        let mut values = Vec::new();
        for v in 0..10 {
            values.push(wv(v as f64, 0.0, 10.0));
        }
        for v in 20..30 {
            values.push(wv(v as f64, 10.0, 0.0));
        }
        let model = choose_numeric_model(&values).unwrap();
        match model {
            NumericModel::Single { above: Some(a), below: None } => {
                assert!(a > 9.0 && a < 20.0);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn low_values_true_gives_below_threshold() {
        let values = vec![wv(1.0, 10.0, 0.0), wv(2.0, 10.0, 0.0), wv(8.0, 0.0, 10.0), wv(9.0, 0.0, 10.0)];
        match choose_numeric_model(&values).unwrap() {
            NumericModel::Single { above: None, below: Some(b) } => assert!(b > 2.0 && b < 8.0),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn middle_band_gives_single_band_not_partition() {
        // TRUE only in the middle: one band observation captures everything,
        // the partition adds nothing.
        let mut values = Vec::new();
        for v in 0..10 {
            values.push(wv(v as f64, 0.0, 10.0));
        }
        for v in 10..20 {
            values.push(wv(v as f64, 10.0, 0.0));
        }
        for v in 20..30 {
            values.push(wv(v as f64, 0.0, 10.0));
        }
        match choose_numeric_model(&values).unwrap() {
            NumericModel::Single { above: Some(a), below: Some(b) } => {
                assert!(a > 9.0 && a < 10.0);
                assert!(b > 19.0 && b < 20.0);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn three_regimes_give_partition() {
        // low: TRUE only, mid: FALSE only, high: 50/50.
        let mut values = Vec::new();
        for v in 0..10 {
            values.push(wv(v as f64, 10.0, 0.0));
        }
        for v in 10..20 {
            values.push(wv(v as f64, 0.0, 10.0));
        }
        for v in 20..30 {
            values.push(wv(v as f64, 5.0, 5.0));
        }
        match choose_numeric_model(&values).unwrap() {
            NumericModel::Partition { cuts } => {
                assert!(cuts[0] > 9.0 && cuts[0] < 10.0, "{cuts:?}");
                assert!(cuts[1] > 19.0 && cuts[1] < 20.0, "{cuts:?}");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn degenerate_inputs_give_none() {
        assert_eq!(choose_numeric_model(&[]), None);
        assert_eq!(choose_numeric_model(&[wv(1.0, 5.0, 5.0)]), None);
        // no FALSE time at all
        assert_eq!(choose_numeric_model(&[wv(1.0, 5.0, 0.0), wv(2.0, 5.0, 0.0)]), None);
    }

    #[test]
    fn many_distinct_values_are_thinned() {
        let values: Vec<_> = (0..5000)
            .map(|i| {
                let v = i as f64 * 0.01;
                if v > 30.0 { wv(v, 1.0, 0.2) } else { wv(v, 0.2, 1.0) }
            })
            .collect();
        match choose_numeric_model(&values).unwrap() {
            NumericModel::Single { above: Some(a), below: None } => assert!((a - 30.0).abs() < 1.5, "{a}"),
            other => panic!("unexpected {other:?}"),
        }
    }
}
