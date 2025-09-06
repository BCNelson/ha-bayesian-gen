<template>
  <div class="period-selector-container">
    <div class="controls-bar">
      <n-radio-group v-model:value="mode" button-style="solid" size="small">
        <n-radio-button value="single">Single</n-radio-button>
        <n-radio-button value="bulk">Bulk</n-radio-button>
        <n-radio-button value="timeline">Timeline</n-radio-button>
        <n-radio-button value="calendar">Calendar</n-radio-button>
      </n-radio-group>
      
      <n-radio-group v-model:value="currentState" size="small">
        <n-radio :value="true">
          <n-text :style="{ color: '#18a058', fontWeight: 'bold' }">
            TRUE periods
          </n-text>
        </n-radio>
        <n-radio :value="false">
          <n-text :style="{ color: '#d03050', fontWeight: 'bold' }">
            FALSE periods
          </n-text>
        </n-radio>
      </n-radio-group>
      
      <n-text depth="3" class="info-text">
        Select past dates only (historical data required)
      </n-text>
    </div>

    <div class="mode-content">
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

      <CalendarTimelineView 
        v-if="mode === 'calendar'"
        :current-state="currentState"
        :periods="periods"
        @period-added="addPeriod"
        @period-removed="removePeriod"
        @period-updated="updatePeriod"
        @periods-updated="handlePeriodsUpdated"
      />
    </div>
    
    <ConfigurationManager 
      ref="configManagerRef"
      :periods="periods"
      @config-switched="switchConfig"
      @config-created="createNewConfig"
    />

    <PeriodsList 
      :periods="periods"
      :allow-bulk-actions="mode === 'timeline' || mode === 'calendar'"
      @period-removed="removePeriod"
      @mark-all-remaining-as="markAllRemainingAs"
      @clear-all-periods="clearAllPeriods"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { 
  NText, 
  NRadioGroup, 
  NRadio,
  NRadioButton
} from 'naive-ui'
import SinglePeriodMode from './TimePeriodSelector/SinglePeriodMode.vue'
import BulkPeriodMode from './TimePeriodSelector/BulkPeriodMode.vue'
import TimelineMode from './TimePeriodSelector/TimelineMode.vue'
import CalendarTimelineView from './TimePeriodSelector/CalendarTimelineView.vue'
import ConfigurationManager from './TimePeriodSelector/ConfigurationManager.vue'
import PeriodsList from './TimePeriodSelector/PeriodsList.vue'
import type { TimePeriod } from '../types/bayesian'
import { mergeAdjacentPeriods } from '../utils/rangeUtils'

const emit = defineEmits<{
  periodsUpdated: [periods: TimePeriod[]]
}>()

const periods = ref<TimePeriod[]>([])
const mode = ref<'single' | 'bulk' | 'timeline' | 'calendar'>('calendar')
const currentState = ref(true)
const timelineRef = ref<InstanceType<typeof TimelineMode>>()
const configManagerRef = ref<InstanceType<typeof ConfigurationManager>>()

const addPeriod = (period: TimePeriod) => {
  periods.value.push(period)
  periods.value = mergeAdjacentPeriods(periods.value)
  autoSave()
  emit('periodsUpdated', periods.value)
}

const addPeriods = (newPeriods: TimePeriod[]) => {
  periods.value.push(...newPeriods)
  periods.value = mergeAdjacentPeriods(periods.value)
  autoSave()
  emit('periodsUpdated', periods.value)
}

const handlePeriodsUpdated = (newPeriods: TimePeriod[]) => {
  periods.value = mergeAdjacentPeriods(newPeriods)
  autoSave()
  emit('periodsUpdated', periods.value)
}

const removePeriod = (id: string) => {
  periods.value = periods.value.filter(p => p.id !== id)
  autoSave()
  emit('periodsUpdated', periods.value)
}

const updatePeriod = (updatedPeriod: TimePeriod) => {
  const index = periods.value.findIndex(p => p.id === updatedPeriod.id)
  if (index !== -1) {
    periods.value[index] = updatedPeriod
    periods.value = mergeAdjacentPeriods(periods.value)
    autoSave()
    emit('periodsUpdated', periods.value)
  }
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
.period-selector-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: min-content;
  padding-bottom: 2rem;
}

.controls-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 6px;
  border: 1px solid #e0e0e0;
  flex-wrap: wrap;
}

.info-text {
  margin-left: auto;
  font-size: 0.85rem;
}

.mode-content {
  padding: 0.5rem;
  overflow: visible;
}

@media (max-width: 768px) {
  .controls-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  
  .info-text {
    margin-left: 0;
    text-align: center;
  }
}
</style>