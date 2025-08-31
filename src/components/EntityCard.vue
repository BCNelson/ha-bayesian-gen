<template>
  <div :class="['entity-group-card', statusClass]">
    <!-- Progress indicator for analysis -->
    <div v-if="entityStatus && entityStatus.status !== 'completed'" class="entity-progress-bar">
      <div :class="['progress-status', `status-${entityStatus.status}`]">
        <div class="progress-status-icon">
          <span v-if="entityStatus.status === 'queued'">⏳</span>
          <div v-else-if="entityStatus.status === 'fetching'" class="mini-spinner"></div>
          <span v-else-if="entityStatus.status === 'fetched'">📦</span>
          <div v-else-if="entityStatus.status === 'analyzing'" class="mini-spinner analyzing"></div>
          <span v-else-if="entityStatus.status === 'error'">✗</span>
        </div>
        <span class="progress-status-label">{{ getStatusLabel(entityStatus.status) }}</span>
        <span v-if="entityStatus.message" class="progress-status-message">{{ entityStatus.message }}</span>
      </div>
    </div>

    <div class="entity-group-header">
      <div class="entity-name">{{ group.entityId }}</div>
      <div class="entity-domain">{{ group.entityId.split('.')[0] }}</div>
      <div v-if="group.bestDiscrimination !== undefined" class="best-discrimination">
        <span>Best: </span>
        <strong :class="getDiscriminationClass(group.bestDiscrimination)">
          {{ (group.bestDiscrimination * 100).toFixed(1) }}%
        </strong>
      </div>
    </div>
    
    <!-- Show content only when analysis is complete or no status -->
    <template v-if="!entityStatus || entityStatus.status === 'completed'">
      <!-- Numeric entity display -->
      <div v-if="group.isNumeric" class="numeric-entity">
        <div class="numeric-header">
          <span class="numeric-label">Numeric Sensor</span>
          <span class="numeric-discrimination" :class="getDiscriminationClass(group.bestDiscrimination)">
            {{ (group.bestDiscrimination * 100).toFixed(1) }}% discrimination
          </span>
        </div>
        
        <div 
          :class="['numeric-selection-card', { selected: isSelected(group.states[0]) }]"
          @click="toggleSelection(group.states[0])"
        >
          <div class="numeric-selection-checkbox">
            <input 
              type="checkbox" 
              :checked="isSelected(group.states[0])"
              @click.stop="toggleSelection(group.states[0])"
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
      
      <!-- Categorical entity display -->
      <div v-else class="entity-states">
        <div class="states-header">
          <span>States found ({{ group.states.length }}):</span>
        </div>
        
        <div class="state-list">
          <div
            v-for="state in group.states"
            :key="`${state.entityId}-${state.state}`"
            :class="['state-card', { selected: isSelected(state) }]"
            @click="toggleSelection(state)"
          >
            <div class="state-selection">
              <input 
                type="checkbox" 
                :checked="isSelected(state)"
                @click.stop="toggleSelection(state)"
              />
            </div>
            
            <div class="state-info">
              <div class="state-header">
                <span class="state-value">{{ state.state }}</span>
                <span class="state-discrimination" :class="getDiscriminationClass(state.discriminationPower)">
                  {{ (state.discriminationPower * 100).toFixed(1) }}%
                </span>
              </div>
              
              <div class="state-probabilities">
                <div class="prob-row">
                  <span class="prob-label">TRUE:</span>
                  <div class="prob-bar-mini">
                    <div class="prob-fill true-fill" :style="{ width: `${state.probGivenTrue * 100}%` }"></div>
                  </div>
                  <span class="prob-text">{{ (state.probGivenTrue * 100).toFixed(1) }}%</span>
                  <span class="occurrence-text">({{ state.trueOccurrences }}/{{ state.totalTruePeriods }})</span>
                </div>
                
                <div class="prob-row">
                  <span class="prob-label">FALSE:</span>
                  <div class="prob-bar-mini">
                    <div class="prob-fill false-fill" :style="{ width: `${state.probGivenFalse * 100}%` }"></div>
                  </div>
                  <span class="prob-text">{{ (state.probGivenFalse * 100).toFixed(1) }}%</span>
                  <span class="occurrence-text">({{ state.falseOccurrences }}/{{ state.totalFalsePeriods }})</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Show placeholder during analysis -->
    <div v-else-if="entityStatus && entityStatus.status !== 'completed' && entityStatus.status !== 'error'" class="entity-analyzing-placeholder">
      <div class="placeholder-content">
        <div class="placeholder-line"></div>
        <div class="placeholder-line short"></div>
        <div class="placeholder-line medium"></div>
      </div>
    </div>

    <!-- Show error state -->
    <div v-else-if="entityStatus && entityStatus.status === 'error'" class="entity-error-content">
      <p class="error-message">{{ entityStatus.message || 'Analysis failed' }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EntityProbability } from '../types/bayesian'

interface EntityGroup {
  entityId: string
  states: EntityProbability[]
  bestDiscrimination: number
  isNumeric: boolean
  numericThresholds?: { above?: number; below?: number }
  correctedProbabilities?: { probGivenTrue: number; probGivenFalse: number; discriminationPower: number }
}

interface EntityStatus {
  status: 'queued' | 'fetching' | 'fetched' | 'analyzing' | 'completed' | 'error'
  message?: string
}

const props = defineProps<{
  group: EntityGroup
  entityStatus?: EntityStatus
  selectedEntities: EntityProbability[]
}>()

const emit = defineEmits<{
  toggleSelection: [entity: EntityProbability]
}>()

const statusClass = computed(() => {
  if (props.entityStatus) {
    return `status-${props.entityStatus.status}`
  }
  return ''
})

const getDiscriminationClass = (power: number) => {
  if (power >= 0.7) return 'excellent'
  if (power >= 0.5) return 'good'
  if (power >= 0.3) return 'moderate'
  return 'low'
}

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'queued': return 'Queued'
    case 'fetching': return 'Fetching History'
    case 'fetched': return 'Ready for Analysis'
    case 'analyzing': return 'Analyzing'
    case 'completed': return 'Completed'
    case 'error': return 'Error'
    default: return status
  }
}

const isSelected = (entity: EntityProbability) => {
  return props.selectedEntities.some(e => 
    e.entityId === entity.entityId && e.state === entity.state
  )
}

const toggleSelection = (entity: EntityProbability) => {
  emit('toggleSelection', entity)
}
</script>

<style scoped>
.entity-group-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.3s;
  position: relative;
}

.entity-group-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

/* Status-specific card styles */
.entity-group-card.status-queued {
  opacity: 0.6;
  border-color: #e0e0e0;
}

.entity-group-card.status-fetching {
  border-color: #2196f3;
  box-shadow: 0 0 0 1px rgba(33, 150, 243, 0.2);
}

.entity-group-card.status-fetched {
  border-color: #9c27b0;
  box-shadow: 0 0 0 1px rgba(156, 39, 176, 0.2);
}

.entity-group-card.status-analyzing {
  border-color: #ff9800;
  box-shadow: 0 0 0 1px rgba(255, 152, 0, 0.2);
}

.entity-group-card.status-completed {
  border-color: #4CAF50;
}

.entity-group-card.status-error {
  border-color: #f44336;
  background: rgba(244, 67, 54, 0.02);
}

/* Progress bar at top of card */
.entity-progress-bar {
  background: linear-gradient(90deg, #f5f5f5 0%, #fafafa 100%);
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.progress-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.progress-status-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress-status-label {
  font-weight: 500;
  color: #333;
}

.progress-status-message {
  color: #666;
  font-style: italic;
  margin-left: auto;
  font-size: 0.8rem;
}

.status-queued .progress-status-label { color: #666; }
.status-fetching .progress-status-label { color: #1976d2; }
.status-fetched .progress-status-label { color: #7b1fa2; }
.status-analyzing .progress-status-label { color: #f57c00; }
.status-error .progress-status-label { color: #c62828; }

/* Mini spinner */
.mini-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #f0f0f0;
  border-top: 2px solid #2196f3;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.mini-spinner.analyzing {
  border-top-color: #ff9800;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

/* Entity header */
.entity-group-header {
  background: #f8f9fa;
  padding: 1rem;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.entity-name {
  font-family: monospace;
  font-size: 0.9rem;
  color: #333;
  font-weight: 500;
  word-break: break-all;
  flex: 1;
}

.entity-domain {
  background: #e3f2fd;
  color: #1976d2;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
}

.best-discrimination {
  font-size: 0.85rem;
  color: #666;
}

/* Placeholder during analysis */
.entity-analyzing-placeholder {
  padding: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder-content {
  width: 100%;
}

.placeholder-line {
  height: 12px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  margin-bottom: 0.75rem;
  border-radius: 6px;
}

.placeholder-line.short {
  width: 60%;
}

.placeholder-line.medium {
  width: 80%;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Error content */
.entity-error-content {
  padding: 1.5rem;
  text-align: center;
}

.error-message {
  color: #c62828;
  font-size: 0.9rem;
  margin: 0;
}

/* Entity states */
.entity-states {
  padding: 1rem;
}

.states-header {
  font-size: 0.9rem;
  color: #666;
  margin-bottom: 0.75rem;
  font-weight: 500;
}

.state-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.state-card {
  background: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 0.75rem;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  cursor: pointer;
  transition: all 0.3s;
}

.state-card:hover {
  background: #f0f0f0;
  border-color: #ccc;
}

.state-card.selected {
  background: rgba(76, 175, 80, 0.1);
  border-color: #4CAF50;
}

.state-selection input[type="checkbox"] {
  cursor: pointer;
  margin-top: 0.25rem;
}

.state-info {
  flex: 1;
}

.state-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.state-value {
  font-weight: 500;
  color: #333;
  background: white;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  border: 1px solid #ddd;
  font-family: monospace;
  font-size: 0.85rem;
}

.state-discrimination {
  font-size: 0.8rem;
  font-weight: 600;
}

.state-probabilities {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.prob-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.prob-label {
  min-width: 45px;
  font-weight: 500;
  color: #666;
}

.prob-bar-mini {
  width: 60px;
  height: 12px;
  background: #f0f0f0;
  border-radius: 6px;
  overflow: hidden;
}

.prob-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.3s ease;
}

.true-fill {
  background: linear-gradient(90deg, #4CAF50, #66BB6A);
}

.false-fill {
  background: linear-gradient(90deg, #f44336, #ef5350);
}

.prob-text {
  min-width: 35px;
  text-align: right;
  font-weight: 500;
}

.occurrence-text {
  color: #999;
  font-size: 0.75rem;
}

/* Numeric entity styles */
.numeric-entity {
  padding: 1rem;
}

.numeric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.numeric-label {
  background: #fff3e0;
  color: #f57c00;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
}

.numeric-discrimination {
  font-size: 0.85rem;
  font-weight: 600;
}

.numeric-selection-card {
  background: #fafafa;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.numeric-selection-card:hover {
  background: #f0f0f0;
  border-color: #ccc;
}

.numeric-selection-card.selected {
  background: rgba(76, 175, 80, 0.1);
  border-color: #4CAF50;
}

.numeric-selection-checkbox input[type="checkbox"] {
  cursor: pointer;
  margin-top: 0.25rem;
}

.numeric-content {
  flex: 1;
}

.optimal-thresholds {
  margin-bottom: 1rem;
}

.thresholds-header {
  font-size: 0.9rem;
  font-weight: 500;
  color: #333;
  margin-bottom: 0.5rem;
}

.thresholds-values {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.threshold-item {
  padding: 0.4rem 0.7rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  font-family: monospace;
}

.threshold-item.above {
  background: #e8f5e9;
  color: #2e7d32;
  border: 1px solid #4CAF50;
}

.threshold-item.below {
  background: #e3f2fd;
  color: #1976d2;
  border: 1px solid #2196f3;
}

.threshold-item.none {
  background: #f5f5f5;
  color: #666;
  border: 1px solid #ddd;
  font-style: italic;
}

.numeric-probabilities {
  padding-top: 0.75rem;
  border-top: 1px solid #e0e0e0;
}

.threshold-probabilities {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.prob-row-numeric {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.prob-label-numeric {
  min-width: 70px;
  font-weight: 500;
  color: #666;
}

.prob-bar-numeric {
  flex: 1;
  height: 16px;
  background: #f0f0f0;
  border-radius: 8px;
  overflow: hidden;
}

.prob-text-numeric {
  min-width: 40px;
  text-align: right;
  font-weight: 500;
}

.prob-summary {
  font-size: 0.8rem;
  color: #666;
  font-style: italic;
}

/* Discrimination classes */
.excellent { color: #4CAF50; }
.good { color: #8BC34A; }
.moderate { color: #FFC107; }
.low { color: #FF9800; }
</style>