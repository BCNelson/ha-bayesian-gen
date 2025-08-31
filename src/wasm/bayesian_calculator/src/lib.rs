mod types;
mod sensor_analysis;
mod threshold;
mod timeline;

use wasm_bindgen::prelude::*;
use types::{EntityProbability, TimePeriod, HAHistoryEntry};

#[cfg(feature = "parallel")]
pub use wasm_bindgen_rayon::init_thread_pool;

#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct BayesianCalculator {
    threshold_cache: std::collections::HashMap<String, threshold::ThresholdCache>,
}

#[wasm_bindgen]
impl BayesianCalculator {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            threshold_cache: std::collections::HashMap::new(),
        }
    }

    #[wasm_bindgen]
    pub fn calculate_entity_probabilities(
        &mut self,
        history: JsValue,
        periods: JsValue,
    ) -> Result<JsValue, JsValue> {
        // Parse history as it's a HashMap
        let history: std::collections::HashMap<String, Vec<HAHistoryEntry>> = 
            serde_wasm_bindgen::from_value(history)
                .map_err(|e| JsValue::from_str(&format!("Failed to parse history: {}", e)))?;
        
        // Parse periods using Tsify's from_wasm_abi
        let periods: Vec<TimePeriod> = 
            serde_wasm_bindgen::from_value(periods)
                .map_err(|e| JsValue::from_str(&format!("Failed to parse periods: {}", e)))?;

        let results = self.process_entities(history, periods)?;
        
        // Convert results back using Tsify's into_wasm_abi
        serde_wasm_bindgen::to_value(&results)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize results: {}", e)))
    }

    fn process_entities(
        &mut self,
        history: std::collections::HashMap<String, Vec<HAHistoryEntry>>,
        periods: Vec<TimePeriod>,
    ) -> Result<Vec<EntityProbability>, String> {
        let true_periods: Vec<_> = periods.iter().filter(|p| p.is_true_period).collect();
        let false_periods: Vec<_> = periods.iter().filter(|p| !p.is_true_period).collect();

        if true_periods.is_empty() || false_periods.is_empty() {
            return Err("Need at least one TRUE and one FALSE period".to_string());
        }

        let mut results = Vec::new();

        for (entity_id, entity_history) in history.iter() {
            if entity_history.is_empty() {
                continue;
            }

            let is_numeric = sensor_analysis::is_numeric_entity(entity_history);
            
            if is_numeric {
                let numeric_stats = sensor_analysis::analyze_numeric_states(entity_history, &periods);
                let optimal_thresholds = if let Some(stats) = &numeric_stats {
                    self.get_or_calculate_thresholds(entity_id, stats)
                } else {
                    None
                };

                let segments = timeline::create_unified_timeline(entity_history, &periods);
                let analysis = timeline::analyze_numeric_segments(&segments);

                for (state, stats) in analysis.iter() {
                    let prob_given_true = (stats.true_occurrences as f64) / (true_periods.len() as f64);
                    let prob_given_false = (stats.false_occurrences as f64) / (false_periods.len() as f64);
                    let discrimination_power = (prob_given_true - prob_given_false).abs();

                    results.push(EntityProbability {
                        entity_id: entity_id.clone(),
                        state: state.clone(),
                        prob_given_true: prob_given_true.min(0.99).max(0.01),
                        prob_given_false: prob_given_false.min(0.99).max(0.01),
                        discrimination_power,
                        true_occurrences: stats.true_occurrences,
                        false_occurrences: stats.false_occurrences,
                        total_true_periods: true_periods.len(),
                        total_false_periods: false_periods.len(),
                        numeric_stats: numeric_stats.clone(),
                        optimal_thresholds: optimal_thresholds.clone(),
                    });
                }
            } else {
                let segments = timeline::create_unified_timeline(entity_history, &periods);
                let state_analysis = timeline::analyze_state_segments(&segments);

                for (state, analysis) in state_analysis.iter() {
                    let prob_given_true = (analysis.true_occurrences as f64) / (true_periods.len() as f64);
                    let prob_given_false = (analysis.false_occurrences as f64) / (false_periods.len() as f64);
                    let discrimination_power = (prob_given_true - prob_given_false).abs();

                    results.push(EntityProbability {
                        entity_id: entity_id.clone(),
                        state: state.clone(),
                        prob_given_true: prob_given_true.min(0.99).max(0.01),
                        prob_given_false: prob_given_false.min(0.99).max(0.01),
                        discrimination_power,
                        true_occurrences: analysis.true_occurrences,
                        false_occurrences: analysis.false_occurrences,
                        total_true_periods: true_periods.len(),
                        total_false_periods: false_periods.len(),
                        numeric_stats: None,
                        optimal_thresholds: None,
                    });
                }
            }
        }

        results.sort_by(|a, b| b.discrimination_power.partial_cmp(&a.discrimination_power).unwrap());
        Ok(results)
    }

    fn get_or_calculate_thresholds(
        &mut self,
        entity_id: &str,
        stats: &sensor_analysis::NumericStateStats,
    ) -> Option<threshold::OptimalThresholds> {
        let cache_key = threshold::get_cache_key(stats);
        
        if let Some(cache) = self.threshold_cache.get_mut(entity_id) {
            if let Some(cached) = cache.get(&cache_key) {
                return Some(cached.clone());
            }
        }

        let thresholds = threshold::find_optimal_numeric_thresholds(stats);
        
        self.threshold_cache
            .entry(entity_id.to_string())
            .or_insert_with(threshold::ThresholdCache::new)
            .insert(cache_key, thresholds.clone());

        Some(thresholds)
    }
}