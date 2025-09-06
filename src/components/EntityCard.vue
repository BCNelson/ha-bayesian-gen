<template>
  <div :class="['entity-group-card', statusClass]">
    <ProgressIndicator 
      v-if="entityStatus && entityStatus.status !== 'completed'" 
      :entity-status="entityStatus" 
    />

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
      <!-- Compact view for low discrimination entities -->
      <div v-if="group.bestDiscrimination < 0.1 && !expandLowDiscrimination" class="low-discrimination-compact">
        <button @click="expandLowDiscrimination = true" class="btn btn-outline expand-compact-btn">
          Expand ▼
        </button>
      </div>
      
      <!-- Numeric entity display -->
      <NumericEntityCard 
        v-else-if="group.isNumeric"
        :group="group"
        :is-selected="isNumericSelected"
        :expand-low-discrimination="expandLowDiscrimination"
        @toggle-selection="toggleNumericSelection"
        @toggle-expansion="expandLowDiscrimination = false"
      />
      
      <!-- Categorical entity display -->
      <CategoricalEntityCard 
        v-else
        :group="group"
        :selected-states="selectedEntities"
        :expand-low-discrimination="expandLowDiscrimination"
        @state-toggled="toggleSelection"
        @toggle-expansion="expandLowDiscrimination = false"
      />
    </template>

    <!-- Show placeholder during analysis -->
    <PlaceholderContent 
      v-else-if="entityStatus && entityStatus.status !== 'error'" 
    />

    <!-- Show error state -->
    <div v-else-if="entityStatus && entityStatus.status === 'error'" class="entity-error-content">
      <p class="error-message">{{ entityStatus.message || 'Analysis failed' }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ProgressIndicator from './EntityCard/ProgressIndicator.vue'
import NumericEntityCard from './EntityCard/NumericEntityCard.vue'
import CategoricalEntityCard from './EntityCard/CategoricalEntityCard.vue'
import PlaceholderContent from './EntityCard/PlaceholderContent.vue'
import type { EntityProbability } from '../types/bayesian'

interface EntityProbabilityGroup {
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
  group: EntityProbabilityGroup
  entityStatus?: EntityStatus
  selectedEntities: EntityProbability[]
}>()

const emit = defineEmits<{
  toggleSelection: [entity: EntityProbability]
}>()

const expandLowDiscrimination = ref(false)

const statusClass = computed(() => {
  if (props.entityStatus) {
    return `status-${props.entityStatus.status}`
  }
  return ''
})

const isNumericSelected = computed(() => {
  if (!props.group.isNumeric || !props.group.states[0]) return false
  return props.selectedEntities.some(e => 
    e.entityId === props.group.states[0].entityId && e.state === props.group.states[0].state
  )
})

const getDiscriminationClass = (power: number) => {
  if (power >= 0.7) return 'excellent'
  if (power >= 0.5) return 'good'
  if (power >= 0.3) return 'moderate'
  return 'low'
}

const toggleSelection = (entity: EntityProbability) => {
  emit('toggleSelection', entity)
}

const toggleNumericSelection = () => {
  if (props.group.isNumeric && props.group.states[0]) {
    emit('toggleSelection', props.group.states[0])
  }
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
  margin-bottom: 1rem;
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
  box-shadow: 0 0 8px rgba(33, 150, 243, 0.3);
}

.entity-group-card.status-analyzing {
  border-color: #9c27b0;
  box-shadow: 0 0 8px rgba(156, 39, 176, 0.3);
}

.entity-group-card.status-error {
  border-color: #f44336;
  background: #ffebee;
}

.entity-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: #ffffff;
  border-bottom: 1px solid #dee2e6;
  gap: 1rem;
  flex-wrap: wrap;
}

.entity-name {
  font-weight: 500;
  color: #212529;
  font-family: monospace;
  background: #f8f9fa;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.9rem;
  flex: 1;
  min-width: 200px;
  word-break: break-all;
  border: 1px solid #dee2e6;
}

.entity-domain {
  background: #e3f2fd;
  color: #1976d2;
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
  text-transform: uppercase;
}

.best-discrimination {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.85rem;
}

.best-discrimination span {
  color: #495057;
  font-weight: 500;
}

.best-discrimination strong.excellent {
  color: #2e7d32;
}

.best-discrimination strong.good {
  color: #388e3c;
}

.best-discrimination strong.moderate {
  color: #f57c00;
}

.best-discrimination strong.low {
  color: #d32f2f;
}

.low-discrimination-compact {
  padding: 1rem;
  text-align: center;
  background: #f8f9fa;
  border-top: 1px solid #dee2e6;
}

.expand-compact-btn {
  font-size: 0.85rem;
  padding: 0.5rem 1rem;
}

.entity-error-content {
  padding: 1rem;
  background: #ffebee;
  border-top: 1px solid #ffcdd2;
}

.error-message {
  color: #d32f2f;
  margin: 0;
  font-weight: 500;
  text-align: center;
}

@media (max-width: 768px) {
  .entity-group-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  
  .entity-name {
    min-width: auto;
  }
}
</style>