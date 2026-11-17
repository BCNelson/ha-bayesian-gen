<template>
  <div v-if="periods.length > 0" class="periods-list">
    <div class="periods-header">
      <h3>Added Periods ({{ periods.length }})</h3>
      <div class="bulk-actions">
        <button 
          @click="$emit('markAllRemainingAs', true)"
          :disabled="!allowBulkActions"
          class="btn btn-outline bulk-action-btn true-btn"
          title="Mark all unmarked timeline slots as TRUE"
        >
          Mark Remaining as TRUE
        </button>
        <button 
          @click="$emit('markAllRemainingAs', false)"
          :disabled="!allowBulkActions"
          class="btn btn-outline bulk-action-btn false-btn"
          title="Mark all unmarked timeline slots as FALSE"
        >
          Mark Remaining as FALSE
        </button>
        <button 
          @click="clearAllPeriods"
          class="btn btn-warning bulk-action-btn clear-btn"
          title="Remove all periods"
        >
          Clear All
        </button>
      </div>
    </div>
    <div class="period-summary">
      <span class="summary-item true-summary">
        TRUE: {{ periods.filter(p => p.isTruePeriod).length }}
      </span>
      <span class="summary-item false-summary">
        FALSE: {{ periods.filter(p => !p.isTruePeriod).length }}
      </span>
    </div>
    <div class="period-cards">
      <div
        v-for="period in sortedPeriods"
        :key="period.id"
        :class="['period-card', period.isTruePeriod ? 'true-period' : 'false-period']"
      >
        <div class="period-header">
          <span class="period-state">{{ period.isTruePeriod ? 'TRUE' : 'FALSE' }}</span>
          <button class="remove-btn" @click="$emit('periodRemoved', period.id)">×</button>
        </div>
        <div class="period-time">
          {{ formatDateTime(period.start) }} → {{ formatDateTime(period.end) }}
        </div>
        <div class="period-duration">
          Duration: {{ formatDuration(period.start, period.end) }}
        </div>
        <div v-if="period.label" class="period-label">
          {{ period.label }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { format, differenceInMinutes, differenceInHours } from 'date-fns'
import type { TimePeriod } from '../../types/bayesian'

const props = defineProps<{
  periods: TimePeriod[]
  allowBulkActions: boolean
}>()

const emit = defineEmits<{
  periodRemoved: [id: string]
  markAllRemainingAs: [isTruePeriod: boolean]
  clearAllPeriods: []
}>()

const sortedPeriods = computed(() => {
  return [...props.periods].sort((a, b) => a.start.getTime() - b.start.getTime())
})

const formatDateTime = (date: Date) => {
  return format(date, 'MMM d, yyyy HH:mm')
}

const formatDuration = (start: Date, end: Date) => {
  const minutes = differenceInMinutes(end, start)
  if (minutes < 60) {
    return `${minutes} minutes`
  }
  const hours = differenceInHours(end, start)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) {
    return `${hours} hours`
  }
  return `${hours}h ${remainingMinutes}m`
}

const clearAllPeriods = () => {
  if (confirm('Are you sure you want to remove all time periods?')) {
    emit('clearAllPeriods')
  }
}
</script>

<style scoped>

.periods-list {
  margin-top: 2rem;
}

.periods-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.periods-header h3 {
  margin: 0;
  color: var(--app-text);
}

.bulk-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.bulk-action-btn {
  font-size: 0.8rem;
  padding: 0.4rem 0.8rem;
}

.true-btn:not(:disabled) {
  border-color: var(--app-true);
  color: var(--app-true);
}

.true-btn:not(:disabled):hover {
  background: var(--app-true);
  color: var(--app-on-accent);
}

.false-btn:not(:disabled) {
  border-color: var(--app-false);
  color: var(--app-false);
}

.false-btn:not(:disabled):hover {
  background: var(--app-false);
  color: var(--app-on-accent);
}

.period-summary {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: var(--app-surface-muted);
  border-radius: 4px;
}

.summary-item {
  font-weight: 500;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
}

.true-summary {
  background: var(--app-true-soft);
  color: var(--app-true-strong);
}

.false-summary {
  background: var(--app-false-soft);
  color: var(--app-false-strong);
}

.period-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.period-card {
  background: var(--app-surface);
  border: 2px solid var(--app-border);
  border-radius: 8px;
  padding: 1rem;
  transition: all 0.3s;
}

.period-card.true-period {
  border-color: var(--app-true);
  background: var(--app-true-soft);
}

.period-card.false-period {
  border-color: var(--app-false);
  background: var(--app-false-soft);
}

.period-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.period-state {
  font-weight: bold;
  font-size: 0.9rem;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  color: var(--app-on-accent);
}

.true-period .period-state {
  background: var(--app-true);
}

.false-period .period-state {
  background: var(--app-false);
}

.remove-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  color: var(--app-text-3);
  padding: 0.25rem;
  border-radius: 3px;
  transition: all 0.2s;
}

.remove-btn:hover {
  background: var(--app-false);
  color: var(--app-on-accent);
}

.period-time {
  font-family: monospace;
  font-size: 0.9rem;
  color: var(--app-text);
  margin-bottom: 0.5rem;
}

.period-duration {
  font-size: 0.85rem;
  color: var(--app-text-2);
  margin-bottom: 0.5rem;
}

.period-label {
  font-size: 0.85rem;
  color: var(--app-text-2);
  font-style: italic;
  background: color-mix(in srgb, var(--app-surface) 70%, transparent);
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
}

@media (max-width: 768px) {
  .periods-header {
    flex-direction: column;
    align-items: stretch;
  }
  
  .bulk-actions {
    justify-content: center;
  }
  
  .period-summary {
    justify-content: center;
  }
  
  .period-cards {
    grid-template-columns: 1fr;
  }
}
</style>