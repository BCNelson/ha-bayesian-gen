<template>
  <div class="entity-states">
    <div class="states-header">
      <span>States found ({{ group.states.length }}):</span>
      <button 
        v-if="group.states.length > 4 && !showAllStates"
        @click="showAllStates = true"
        class="btn btn-outline show-more-btn"
      >
        Show all ({{ group.states.length - 4 }} more)
      </button>
      <button 
        v-if="group.states.length > 4 && showAllStates"
        @click="showAllStates = false"
        class="btn btn-outline show-less-btn"
      >
        Show less
      </button>
      <button 
        v-if="group.bestDiscrimination < 0.1 && expandLowDiscrimination"
        @click="$emit('toggleExpansion')"
        class="btn btn-outline collapse-btn"
      >
        Collapse ▲
      </button>
    </div>
    
    <div class="state-list">
      <div
        v-for="state in displayedStates"
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

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EntityProbability } from '../../types/bayesian'

interface EntityProbabilityGroup {
  entityId: string
  states: EntityProbability[]
  bestDiscrimination: number
  isNumeric: boolean
  numericThresholds?: { above?: number; below?: number }
  correctedProbabilities?: { probGivenTrue: number; probGivenFalse: number; discriminationPower: number }
}

const props = defineProps<{
  group: EntityProbabilityGroup
  selectedStates: EntityProbability[]
  expandLowDiscrimination: boolean
}>()

const emit = defineEmits<{
  stateToggled: [state: EntityProbability]
  toggleExpansion: []
}>()

const showAllStates = ref(false)

const displayedStates = computed(() => {
  if (showAllStates.value || props.group.states.length <= 4) {
    return props.group.states
  }
  return props.group.states.slice(0, 4)
})

const isSelected = (state: EntityProbability) => {
  return props.selectedStates.some(s => 
    s.entityId === state.entityId && s.state === state.state
  )
}

const toggleSelection = (state: EntityProbability) => {
  emit('stateToggled', state)
}

const getDiscriminationClass = (discrimination: number) => {
  if (discrimination >= 0.3) return 'high-discrimination'
  if (discrimination >= 0.1) return 'medium-discrimination'
  return 'low-discrimination'
}
</script>

<style scoped>

.entity-states {
  margin-bottom: 1rem;
}

.states-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.states-header span {
  font-weight: 500;
  color: #212529;
}

.show-more-btn,
.show-less-btn,
.collapse-btn {
  font-size: 0.8rem;
  padding: 0.25rem 0.5rem;
}

.state-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
}

.state-card {
  display: flex;
  background: white;
  border: 2px solid #dee2e6;
  border-radius: 6px;
  padding: 0.75rem;
  cursor: pointer;
  transition: all 0.3s;
}

.state-card:hover {
  border-color: #4CAF50;
  box-shadow: 0 2px 8px rgba(76, 175, 80, 0.2);
}

.state-card.selected {
  border-color: #4CAF50;
  background: #e8f5e9;
  box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
}

.state-selection {
  display: flex;
  align-items: flex-start;
  margin-right: 0.75rem;
  padding-top: 0.25rem;
}

.state-info {
  flex: 1;
  min-width: 0;
}

.state-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  gap: 0.5rem;
}

.state-value {
  font-weight: 500;
  color: #212529;
  font-family: monospace;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
  font-size: 0.85rem;
  word-break: break-all;
  flex: 1;
}

.state-discrimination {
  font-weight: bold;
  font-size: 0.8rem;
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
  background: #e9ecef;
  border: 1px solid #dee2e6;
}

.high-discrimination {
  color: #2e7d32;
  background: #e8f5e9;
}

.medium-discrimination {
  color: #ef6c00;
  background: #fff3e0;
}

.low-discrimination {
  color: #d32f2f;
  background: #ffebee;
}

.state-probabilities {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.prob-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.prob-label {
  min-width: 40px;
  font-weight: 500;
  color: #212529;
}

.prob-bar-mini {
  flex: 1;
  height: 12px;
  background: #e9ecef;
  border: 1px solid #dee2e6;
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
  min-width: 50px;
  text-align: right;
  color: #6c757d;
  font-size: 0.75rem;
  font-weight: 500;
}

@media (max-width: 768px) {
  .states-header {
    flex-direction: column;
    align-items: stretch;
  }
  
  .state-list {
    grid-template-columns: 1fr;
  }
  
  .state-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.25rem;
  }
  
  .prob-row {
    flex-wrap: wrap;
    gap: 0.25rem;
  }
}
</style>