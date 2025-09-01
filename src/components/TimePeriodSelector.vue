<template>
  <n-space vertical size="large">
    <n-text tag="p">Add examples of when the Bayesian sensor should be TRUE or FALSE. You can mark periods across multiple days/weeks.</n-text>
    
    <n-alert type="warning" title="Historical Data Only">
      Select past dates and times only. We need historical data to analyze entity states and calculate probabilities.
    </n-alert>
    
    <n-card :bordered="false">
      <n-space justify="space-between" align="center">
        <n-radio-group v-model:value="mode" button-style="solid">
          <n-radio-button value="single">Single Period</n-radio-button>
          <n-radio-button value="bulk">Bulk Selection</n-radio-button>
          <n-radio-button value="timeline">Visual Timeline</n-radio-button>
        </n-radio-group>
        
        <n-radio-group v-model:value="currentState">
          <n-radio :value="true">
            <n-text :style="{ color: '#18a058', fontWeight: 'bold' }">
              Marking TRUE periods
            </n-text>
          </n-radio>
          <n-radio :value="false">
            <n-text :style="{ color: '#d03050', fontWeight: 'bold' }">
              Marking FALSE periods
            </n-text>
          </n-radio>
        </n-radio-group>
      </n-space>
    </n-card>

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
  </n-space>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { format } from 'date-fns'
import { 
  NSpace, 
  NCard, 
  NAlert, 
  NText, 
  NRadioGroup, 
  NRadio,
  NRadioButton
} from 'naive-ui'
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
@media (max-width: 768px) {
  :deep(.n-space) {
    flex-direction: column;
  }
}
</style>