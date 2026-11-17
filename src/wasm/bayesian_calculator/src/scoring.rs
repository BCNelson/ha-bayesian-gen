//! Probability clamping and observation scoring.

/// Lower/upper bound applied to every emitted `prob_given_*`.
///
/// HA's docs advise against 0 and 1 ("these will mess with the odds"): a 0/1
/// likelihood makes a single observation able to pin the posterior forever,
/// and `p_t = p_f = 0` raises a division by zero in HA's `update_probability`.
pub const MIN_PROBABILITY: f64 = 0.01;
pub const MAX_PROBABILITY: f64 = 0.99;

/// Clamp a likelihood into `[MIN_PROBABILITY, MAX_PROBABILITY]`.
pub fn clamp_probability(p: f64) -> f64 {
    if p.is_nan() {
        return MIN_PROBABILITY;
    }
    p.clamp(MIN_PROBABILITY, MAX_PROBABILITY)
}

/// Jeffreys (symmetric KL) divergence, in nats, between the outcome
/// distributions under TRUE and FALSE:
///
/// ```text
///   J = Σ_o (P(o|T) − P(o|F)) · ln(P(o|T) / P(o|F))
///     = E_T[LLR] − E_F[LLR]
/// ```
///
/// where `LLR(o) = ln(P(o|T)/P(o|F))` is exactly the log-odds shift HA applies
/// to the posterior when outcome `o` is observed. `J` is therefore the expected
/// separation (in log-odds) that the observation produces between the two
/// classes, and it does not depend on the prior.
///
/// Each `outcome` is a `(P(o|T), P(o|F))` pair of *clamped* probabilities so
/// the score reflects the values written into the config.
pub fn jeffreys_divergence(outcomes: &[(f64, f64)]) -> f64 {
    outcomes
        .iter()
        .map(|&(pt, pf)| {
            if pt <= 0.0 || pf <= 0.0 {
                0.0
            } else {
                (pt - pf) * (pt / pf).ln()
            }
        })
        .sum()
}

/// Information score of a single HA observation.
///
/// A lone observation of an entity updates the posterior both when it matches
/// (`p_t`, `p_f`) and when it does not (`1 − p_t`, `1 − p_f`), so both
/// outcomes are scored:
///
/// ```text
///   score = (p_t − p_f)·ln(p_t/p_f) + (p_f − p_t)·ln((1−p_t)/(1−p_f))
/// ```
pub fn single_observation_score(pt: f64, pf: f64) -> f64 {
    jeffreys_divergence(&[(pt, pf), (1.0 - pt, 1.0 - pf)])
}

/// Total-variation distance between the TRUE/FALSE outcome distributions.
/// For a binary match/non-match observation this equals `|p_t − p_f|`.
pub fn total_variation(outcomes: &[(f64, f64)]) -> f64 {
    0.5 * outcomes.iter().map(|&(pt, pf)| (pt - pf).abs()).sum::<f64>()
}

/// Jensen–Shannon divergence (bits, in `[0, 1]`) between the outcome
/// distributions under TRUE and FALSE. Equivalent to the information gain of
/// the split when TRUE and FALSE are weighted equally. Used to *choose*
/// numeric cut points because, unlike Jeffreys, it is bounded and robust to
/// tiny bins (no clamping needed).
pub fn jensen_shannon(outcomes: &[(f64, f64)]) -> f64 {
    let term = |p: f64, m: f64| if p > 0.0 { p * (p / m).log2() } else { 0.0 };
    outcomes
        .iter()
        .map(|&(pt, pf)| {
            let m = 0.5 * (pt + pf);
            if m <= 0.0 {
                0.0
            } else {
                0.5 * term(pt, m) + 0.5 * term(pf, m)
            }
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_bounds() {
        assert_eq!(clamp_probability(0.0), 0.01);
        assert_eq!(clamp_probability(1.0), 0.99);
        assert_eq!(clamp_probability(0.4), 0.4);
        assert_eq!(clamp_probability(f64::NAN), 0.01);
    }

    #[test]
    fn single_score_is_zero_without_discrimination_and_symmetric() {
        assert!(single_observation_score(0.3, 0.3).abs() < 1e-12);
        let a = single_observation_score(0.9, 0.2);
        let b = single_observation_score(0.2, 0.9);
        assert!((a - b).abs() < 1e-12);
        assert!(a > 0.0);
    }

    #[test]
    fn single_score_accounts_for_non_match_update() {
        // Same |p_t - p_f| = 0.1, but the second observation's non-match
        // outcome is far more informative (0.01 vs 0.11 on non-match).
        let rare = single_observation_score(0.2, 0.1);
        let common = single_observation_score(0.99, 0.89);
        assert!(common > rare);
    }

    #[test]
    fn jensen_shannon_bounds() {
        assert!((jensen_shannon(&[(1.0, 0.0), (0.0, 1.0)]) - 1.0).abs() < 1e-12);
        assert!(jensen_shannon(&[(0.5, 0.5), (0.5, 0.5)]).abs() < 1e-12);
    }

    #[test]
    fn total_variation_matches_abs_diff_for_binary() {
        let tv = total_variation(&[(0.7, 0.2), (0.3, 0.8)]);
        assert!((tv - 0.5).abs() < 1e-12);
    }
}
