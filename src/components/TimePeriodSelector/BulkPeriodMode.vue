<template>
  <div class="bulk-mode">
    <div class="bulk-controls">
      <div class="form-group">
        <label>Date Range</label>
        <div class="date-range">
          <input 
            v-model="bulkSelection.startDate" 
            type="date" 
            :max="maxDate"
            required
          />
          <span>to</span>
          <input 
            v-model="bulkSelection.endDate" 
            type="date" 
            :max="maxDate"
            required
          />
        </div>
      </div>
      
      <div class="form-group">
        <label>Time Range (daily)</label>
        <div class="time-range">
          <input 
            v-model="bulkSelection.startTime" 
            type="time" 
            required
          />
          <span>to</span>
          <input 
            v-model="bulkSelection.endTime" 
            type="time" 
            required
          />
        </div>
      </div>
      
      <div class="form-group">
        <label>Days of Week</label>
        <div class="days-selector">
          <label v-for="(day, index) in daysOfWeek" :key="index">
            <input 
              v-model="bulkSelection.daysOfWeek" 
              type="checkbox" 
              :value="index"
            />
            {{ day }}
          </label>
        </div>
      </div>
      
      <div class="form-group">
        <label for="bulk-label">Label Pattern</label>
        <input
          id="bulk-label"
          v-model="bulkSelection.labelPattern"
          type="text"
          placeholder="e.g., 'Work hours {date}'"
        />
        <small>Use {date} and {time} for dynamic labels</small>
      </div>
      
      <button @click="addBulkPeriods" :disabled="!isValidBulkSelection" class="btn btn-primary">
        Add {{ bulkPeriodCount }} Periods
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { 
  format, 
  eachDayOfInterval,
  setHours,
  setMinutes,
  subDays
} from 'date-fns'
import type { TimePeriod } from '../../types/bayesian'

const props = defineProps<{
  currentState: boolean
}>()

const emit = defineEmits<{
  periodsAdded: [periods: TimePeriod[]]
}>()

const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const now = new Date()
const maxDate = format(now, 'yyyy-MM-dd')

const bulkSelection = ref({
  startDate: '',
  endDate: '',
  startTime: '09:00',
  endTime: '17:00',
  daysOfWeek: [] as number[],
  labelPattern: 'Period {date} {time}'
})

const isValidBulkSelection = computed(() => {
  if (!bulkSelection.value.startDate || 
      !bulkSelection.value.endDate || 
      !bulkSelection.value.startTime ||
      !bulkSelection.value.endTime ||
      bulkSelection.value.daysOfWeek.length === 0) {
    return false
  }
  
  const endDate = new Date(bulkSelection.value.endDate)
  const startDate = new Date(bulkSelection.value.startDate)
  return endDate <= now && startDate <= now && startDate <= endDate
})

const bulkPeriodCount = computed(() => {
  if (!isValidBulkSelection.value) return 0
  
  const start = new Date(bulkSelection.value.startDate)
  const end = new Date(bulkSelection.value.endDate)
  const days = eachDayOfInterval({ start, end })
  
  return days.filter(day => 
    bulkSelection.value.daysOfWeek.includes(day.getDay())
  ).length
})

const addBulkPeriods = () => {
  if (!isValidBulkSelection.value) return
  
  const startDate = new Date(bulkSelection.value.startDate)
  const endDate = new Date(bulkSelection.value.endDate)
  const days = eachDayOfInterval({ start: startDate, end: endDate })
  
  const [startHour, startMinute] = bulkSelection.value.startTime.split(':').map(Number)
  const [endHour, endMinute] = bulkSelection.value.endTime.split(':').map(Number)
  
  const newPeriods: TimePeriod[] = []
  
  days
    .filter(day => bulkSelection.value.daysOfWeek.includes(day.getDay()))
    .forEach((day, index) => {
      const start = setMinutes(setHours(day, startHour), startMinute)
      const end = setMinutes(setHours(day, endHour), endMinute)
      
      if (start < end) {
        const label = bulkSelection.value.labelPattern
          .replace('{date}', format(day, 'MMM d'))
          .replace('{time}', `${bulkSelection.value.startTime}-${bulkSelection.value.endTime}`)
        
        newPeriods.push({
          id: `${Date.now()}-${index}`,
          start,
          end,
          isTruePeriod: props.currentState,
          label
        })
      }
    })
  
  emit('periodsAdded', newPeriods)
}

onMounted(() => {
  const weekAgo = subDays(now, 7)
  const yesterday = subDays(now, 1)
  
  bulkSelection.value.startDate = format(weekAgo, 'yyyy-MM-dd')
  bulkSelection.value.endDate = format(yesterday, 'yyyy-MM-dd')
  bulkSelection.value.daysOfWeek = [1, 2, 3, 4, 5] // Weekdays
})
</script>

<style scoped>

.bulk-mode {
  background: #f5f5f5;
  padding: 1.5rem;
  border-radius: 8px;
  margin-bottom: 2rem;
}

.bulk-controls {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 500;
  color: #555;
}

.form-group input,
.form-group select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.95rem;
}

.form-group small {
  color: #777;
  font-size: 0.8rem;
}

.date-range,
.time-range {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.date-range span,
.time-range span {
  color: #666;
  font-weight: 500;
}

.days-selector {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.days-selector label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  cursor: pointer;
  font-weight: normal;
}

.days-selector input[type="checkbox"] {
  width: auto;
  margin: 0;
}

@media (max-width: 768px) {
  .date-range,
  .time-range {
    flex-direction: column;
    align-items: stretch;
  }
  
  .date-range span,
  .time-range span {
    text-align: center;
  }
  
  .days-selector {
    gap: 0.5rem;
  }
}
</style>