<template>
  <div class="numeric-entity">
    <div class="numeric-header">
      <span class="numeric-label">Numeric Sensor</span>
      <span class="numeric-discrimination" :class="getDiscriminationClass(group.bestDiscrimination)">
        {{ (group.bestDiscrimination * 100).toFixed(1) }}% discrimination
      </span>
      <button 
        v-if="group.bestDiscrimination < 0.1 && expandLowDiscrimination"
        @click="$emit('toggleExpansion')"
        class="btn btn-outline collapse-btn"
      >
        Collapse ▲
      </button>
    </div>
    
    <div 
      :class="['numeric-selection-card', { selected: isSelected }]"
      @click="$emit('toggleSelection')"
    >
      <div class="numeric-selection-checkbox">
        <input 
          type="checkbox" 
          :checked="isSelected"
          @click.stop="$emit('toggleSelection')"
        />
      </div>
      
      <div class="numeric-content">
        <div v-if="group.numericThresholds" class="optimal-thresholds">
          <div class="thresholds-header">Optimal Thresholds:</div>
          <div class="thresholds-values">
            <span v-if="group.numericThresholds.above !== undefined" class="threshold-item above">
              Above: {{ group.numericThresholds.above.toFixed(2) }}
            </span>
            <span v-if="group.numericThresholds.below !== undefined" class="threshold-item below">
              Below: {{ group.numericThresholds.below.toFixed(2) }}
            </span>
            <span v-if="!group.numericThresholds.above && !group.numericThresholds.below" class="threshold-item none">
              No optimal thresholds found
            </span>
          </div>
        </div>
        
        <div v-if="group.correctedProbabilities" class="numeric-probabilities">
          <div class="threshold-probabilities">
            <div class="prob-row-numeric">
              <span class="prob-label-numeric">When TRUE:</span>
              <div class="prob-bar-numeric">
                <div class="prob-fill true-fill" :style="{ width: `${group.correctedProbabilities.probGivenTrue * 100}%` }"></div>
              </div>
              <span class="prob-text-numeric">{{ (group.correctedProbabilities.probGivenTrue * 100).toFixed(1) }}%</span>
            </div>
            
            <div class="prob-row-numeric">
              <span class="prob-label-numeric">When FALSE:</span>
              <div class="prob-bar-numeric">
                <div class="prob-fill false-fill" :style="{ width: `${group.correctedProbabilities.probGivenFalse * 100}%` }"></div>
              </div>
              <span class="prob-text-numeric">{{ (group.correctedProbabilities.probGivenFalse * 100).toFixed(1) }}%</span>
            </div>
          </div>
          
          <div class="prob-summary">
            Based on threshold conditions across {{ group.states[0].totalTruePeriods }} TRUE and {{ group.states[0].totalFalsePeriods }} FALSE periods
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EntityProbability } from '../../types/bayesian'

interface EntityProbabilityGroup {
  entityId: string
  states: EntityProbability[]
  bestDiscrimination: number
  isNumeric: boolean
  numericThresholds?: { above?: number; below?: number }
  correctedProbabilities?: { probGivenTrue: number; probGivenFalse: number; discriminationPower: number }
}

defineProps<{
  group: EntityProbabilityGroup
  isSelected: boolean
  expandLowDiscrimination: boolean
}>()

defineEmits<{
  toggleSelection: []
  toggleExpansion: []
}>()

const getDiscriminationClass = (discrimination: number) => {
  if (discrimination >= 0.3) return 'high-discrimination'
  if (discrimination >= 0.1) return 'medium-discrimination'
  return 'low-discrimination'
}
</script>

<style scoped>

.numeric-entity {
  background: #f8f9fa;
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.numeric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  gap: 1rem;
}

.numeric-label {
  background: #e3f2fd;
  color: #1976d2;
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
}

.numeric-discrimination {
  font-weight: 500;
  font-size: 0.9rem;
}

.collapse-btn {
  font-size: 0.8rem;
  padding: 0.25rem 0.5rem;
}

.numeric-selection-card {
  display: flex;
  background: white;
  border: 2px solid #e0e0e0;
  border-radius: 6px;
  padding: 0.75rem;
  cursor: pointer;
  transition: all 0.3s;
}

.numeric-selection-card:hover {
  border-color: #4CAF50;
  box-shadow: 0 2px 8px rgba(76, 175, 80, 0.2);
}

.numeric-selection-card.selected {
  border-color: #4CAF50;
  background: #e8f5e9;
  box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
}

.numeric-selection-checkbox {
  display: flex;
  align-items: flex-start;
  margin-right: 0.75rem;
  padding-top: 0.25rem;
}

.numeric-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.optimal-thresholds {
  background: #f5f5f5;
  padding: 0.75rem;
  border-radius: 4px;
}

.thresholds-header {
  font-weight: 500;
  color: #333;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.thresholds-values {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.threshold-item {
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  font-size: 0.85rem;
  font-weight: 500;
}

.threshold-item.above {
  background: #e8f5e9;
  color: #2e7d32;
}

.threshold-item.below {
  background: #fff3e0;
  color: #ef6c00;
}

.threshold-item.none {
  background: #f5f5f5;
  color: #666;
}

.numeric-probabilities {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.threshold-probabilities {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.prob-row-numeric {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.prob-label-numeric {
  min-width: 80px;
  font-size: 0.85rem;
  font-weight: 500;
  color: #333;
}

.prob-bar-numeric {
  flex: 1;
  height: 20px;
  background: #f0f0f0;
  border-radius: 10px;
  overflow: hidden;
}

.prob-fill {
  height: 100%;
  border-radius: 10px;
  transition: width 0.3s ease;
}

.true-fill {
  background: linear-gradient(90deg, #4CAF50, #66BB6A);
}

.false-fill {
  background: linear-gradient(90deg, #f44336, #ef5350);
}

.prob-text-numeric {
  min-width: 45px;
  text-align: right;
  font-weight: 500;
  font-size: 0.85rem;
}

.prob-summary {
  font-size: 0.8rem;
  color: #666;
  background: rgba(255, 255, 255, 0.7);
  padding: 0.5rem;
  border-radius: 3px;
  text-align: center;
}

.high-discrimination {
  color: #2e7d32;
}

.medium-discrimination {
  color: #f57c00;
}

.low-discrimination {
  color: #d32f2f;
}

@media (max-width: 768px) {
  .numeric-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  
  .prob-row-numeric {
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
  }
  
  .prob-text-numeric {
    text-align: left;
  }
}
</style>