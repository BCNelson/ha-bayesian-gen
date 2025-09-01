<template>
  <div class="single-mode">
    <div class="form-row">
      <div class="form-group">
        <label for="start-time">Start Time</label>
        <input
          id="start-time"
          v-model="newPeriod.start"
          type="datetime-local"
          :max="maxDateTime"
          required
        />
      </div>
      
      <div class="form-group">
        <label for="end-time">End Time</label>
        <input
          id="end-time"
          v-model="newPeriod.end"
          type="datetime-local"
          :max="maxDateTime"
          required
        />
      </div>
      
      <div class="form-group">
        <label for="period-label">Label</label>
        <input
          id="period-label"
          v-model="newPeriod.label"
          type="text"
          placeholder="e.g., 'Weekend morning'"
        />
      </div>
      
      <button @click="addSinglePeriod" :disabled="!isValidSinglePeriod" class="btn btn-primary">
        Add Period
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { format } from 'date-fns'
import type { TimePeriod } from '../../types/bayesian'

const props = defineProps<{
  currentState: boolean
}>()

const emit = defineEmits<{
  periodAdded: [period: TimePeriod]
}>()

const newPeriod = ref({
  start: '',
  end: '',
  label: ''
})

const now = new Date()
const maxDateTime = format(now, "yyyy-MM-dd'T'HH:mm")

const isValidSinglePeriod = computed(() => {
  if (!newPeriod.value.start || !newPeriod.value.end) return false
  const start = new Date(newPeriod.value.start)
  const end = new Date(newPeriod.value.end)
  return start < end && end <= now && start <= now
})

const addSinglePeriod = () => {
  if (!isValidSinglePeriod.value) return
  
  const period: TimePeriod = {
    id: Date.now().toString(),
    start: new Date(newPeriod.value.start),
    end: new Date(newPeriod.value.end),
    isTruePeriod: props.currentState,
    label: newPeriod.value.label || undefined
  }
  
  emit('periodAdded', period)
  
  newPeriod.value = {
    start: '',
    end: '',
    label: ''
  }
}
</script>

<style scoped>

.single-mode {
  background: #f5f5f5;
  padding: 1.5rem;
  border-radius: 8px;
  margin-bottom: 2rem;
}

.form-row {
  display: flex;
  gap: 1rem;
  align-items: end;
  flex-wrap: wrap;
}

.form-group {
  display: flex;
  flex-direction: column;
  min-width: 200px;
  flex: 1;
}

.form-group label {
  font-weight: 500;
  margin-bottom: 0.25rem;
  color: #555;
}

.form-group input {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.95rem;
}


@media (max-width: 768px) {
  .form-row {
    flex-direction: column;
    align-items: stretch;
  }
  
  .form-group {
    min-width: auto;
  }
}
</style>