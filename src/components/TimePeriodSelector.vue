<template>
  <div class="time-period-selector">
    <h2>Mark Time Periods</h2>
    <p>Add examples of when the Bayesian sensor should be TRUE or FALSE. You can mark periods across multiple days/weeks.</p>
    <div class="historical-notice">
      <p>📅 <strong>Historical Data Only:</strong> Select past dates and times only. We need historical data to analyze entity states and calculate probabilities.</p>
    </div>
    
    <div class="controls">
      <div class="mode-selector">
        <button 
          :class="['btn', mode === 'single' ? 'btn-primary' : 'btn-outline', { active: mode === 'single' }]"
          @click="mode = 'single'"
        >
          Single Period
        </button>
        <button 
          :class="['btn', mode === 'bulk' ? 'btn-primary' : 'btn-outline', { active: mode === 'bulk' }]"
          @click="mode = 'bulk'"
        >
          Bulk Selection
        </button>
        <button 
          :class="['btn', mode === 'timeline' ? 'btn-primary' : 'btn-outline', { active: mode === 'timeline' }]"
          @click="mode = 'timeline'"
        >
          Visual Timeline
        </button>
      </div>
      
      <div class="state-toggle">
        <label class="toggle-label">
          <input 
            v-model="currentState" 
            type="radio" 
            :value="true"
          />
          <span class="true-state">Marking TRUE periods</span>
        </label>
        <label class="toggle-label">
          <input 
            v-model="currentState" 
            type="radio" 
            :value="false"
          />
          <span class="false-state">Marking FALSE periods</span>
        </label>
      </div>
    </div>

    <SinglePeriodMode 
      v-if="mode === 'single'"
      :current-state="currentState"
      @period-added="addPeriod"
    />

    <BulkPeriodMode 
      v-if="mode === 'bulk'"
      :current-state="currentState"
      @periods-added="addPeriods"
    />

    <TimelineMode 
      v-if="mode === 'timeline'"
      ref="timelineRef"
      :current-state="currentState"
      :periods="periods"
      @period-added="addPeriod"
      @bulk-mark-remaining="markAllRemainingAs"
    />
    
    <ConfigurationManager 
      ref="configManagerRef"
      :periods="periods"
      @config-switched="switchConfig"
      @config-created="createNewConfig"
    />

    <PeriodsList 
      :periods="periods"
      :allow-bulk-actions="mode === 'timeline'"
      @period-removed="removePeriod"
      @mark-all-remaining-as="markAllRemainingAs"
      @clear-all-periods="clearAllPeriods"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { format } from 'date-fns'
import SinglePeriodMode from './TimePeriodSelector/SinglePeriodMode.vue'
import BulkPeriodMode from './TimePeriodSelector/BulkPeriodMode.vue'
import TimelineMode from './TimePeriodSelector/TimelineMode.vue'
import ConfigurationManager from './TimePeriodSelector/ConfigurationManager.vue'
import PeriodsList from './TimePeriodSelector/PeriodsList.vue'
import type { TimePeriod } from '../types/bayesian'

const emit = defineEmits<{
  periodsUpdated: [periods: TimePeriod[]]
}>()

const periods = ref<TimePeriod[]>([])
const mode = ref<'single' | 'bulk' | 'timeline'>('single')
const currentState = ref(true)
const timelineRef = ref<InstanceType<typeof TimelineMode>>()
const configManagerRef = ref<InstanceType<typeof ConfigurationManager>>()

const addPeriod = (period: TimePeriod) => {
  periods.value.push(period)
  mergeAdjacentPeriods()
  autoSave()
  emit('periodsUpdated', periods.value)
}

const addPeriods = (newPeriods: TimePeriod[]) => {
  periods.value.push(...newPeriods)
  mergeAdjacentPeriods()
  autoSave()
  emit('periodsUpdated', periods.value)
}

const removePeriod = (id: string) => {
  periods.value = periods.value.filter(p => p.id !== id)
  autoSave()
  emit('periodsUpdated', periods.value)
}

const markAllRemainingAs = () => {
  if (mode.value !== 'timeline' || !timelineRef.value) return
  // Timeline component will handle the bulk marking
  emit('periodsUpdated', periods.value)
}

const clearAllPeriods = () => {
  periods.value = []
  autoSave()
  emit('periodsUpdated', periods.value)
}

const switchConfig = (newPeriods: TimePeriod[]) => {
  periods.value = [...newPeriods]
  emit('periodsUpdated', periods.value)
}

const createNewConfig = () => {
  periods.value = []
  emit('periodsUpdated', periods.value)
}

const mergeAdjacentPeriods = () => {
  if (periods.value.length < 2) return

  const sortedPeriods = [...periods.value].sort((a: TimePeriod, b: TimePeriod) => a.start.getTime() - b.start.getTime())
  const mergedPeriods: TimePeriod[] = []
  
  for (const currentPeriod of sortedPeriods) {
    let wasmerged = false
    
    if (mergedPeriods.length > 0) {
      const lastPeriod = mergedPeriods[mergedPeriods.length - 1]
      
      if (currentPeriod.isTruePeriod === lastPeriod.isTruePeriod) {
        const currentStart = currentPeriod.start.getTime()
        const currentEnd = currentPeriod.end.getTime()
        const lastStart = lastPeriod.start.getTime()
        const lastEnd = lastPeriod.end.getTime()
        
        if (
          (currentStart <= lastEnd + 60000) && // Current starts within 1 minute of last ending
          (currentStart >= lastEnd - 60000)    // But not too far before last ending
        ) {
          const newStart = new Date(Math.min(currentStart, lastStart))
          const newEnd = new Date(Math.max(currentEnd, lastEnd))
          
          const mergedLabel = `${format(newStart, 'MMM d HH:mm')} - ${format(newEnd, 'HH:mm')}`
          
          mergedPeriods[mergedPeriods.length - 1] = {
            id: lastPeriod.id, // Keep the original ID
            start: newStart,
            end: newEnd,
            isTruePeriod: lastPeriod.isTruePeriod,
            label: mergedLabel
          }
          
          wasmerged = true
        }
      }
    }
    
    if (!wasmerged) {
      mergedPeriods.push(currentPeriod)
    }
  }
  
  if (mergedPeriods.length !== periods.value.length) {
    periods.value = mergedPeriods
  }
}

const autoSave = () => {
  if (configManagerRef.value) {
    configManagerRef.value.autoSave()
  }
}
</script>

<style scoped>

.time-period-selector {
  max-width: 1200px;
  margin: 2rem auto;
}

h2 {
  color: #333;
  margin-bottom: 0.5rem;
}

p {
  color: #666;
  margin-bottom: 1.5rem;
}

.historical-notice {
  background: #fff3cd;
  border: 1px solid #ffeaa7;
  border-radius: 4px;
  padding: 0.75rem;
  margin-bottom: 1.5rem;
}

.historical-notice p {
  margin: 0;
  color: #856404;
}

.controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
  flex-wrap: wrap;
  gap: 1rem;
}

.mode-selector {
  display: flex;
  gap: 0.5rem;
}

.state-toggle {
  display: flex;
  gap: 1rem;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.toggle-label input[type="radio"] {
  margin: 0;
}

.true-state {
  color: #4CAF50;
  font-weight: bold;
}

.false-state {
  color: #f44336;
  font-weight: bold;
}

@media (max-width: 768px) {
  .controls {
    flex-direction: column;
    align-items: stretch;
  }
  
  .mode-selector {
    justify-content: center;
  }
  
  .state-toggle {
    justify-content: center;
  }
}
</style>