<template>
  <div class="timeline-mode">
    <div class="timeline-controls">
      <div class="date-navigation">
        <button @click="navigateWeek(-1)" class="btn btn-outline">← Previous Week</button>
        <span class="current-week">
          {{ formatDateRange(currentWeekStart, currentWeekEnd) }}
        </span>
        <button 
          @click="navigateWeek(1)"
          :disabled="addWeeks(currentWeekStart, 1) > startOfWeek(new Date())"
          class="btn btn-outline"
        >
          Next Week →
        </button>
      </div>
      
      <div class="zoom-controls">
        <label>
          View: 
          <select v-model="timelineZoom" class="form-select">
            <option value="15min">15-Minute blocks</option>
            <option value="hour">Hourly</option>
            <option value="6hour">6-Hour blocks</option>
            <option value="day">Daily</option>
          </select>
        </label>
      </div>
    </div>
    
    <div class="timeline-grid" ref="timelineGrid">
      <div class="timeline-header">
        <div class="day-header" v-for="day in weekDays" :key="day.date">
          {{ day.label }}
          <small>{{ day.date }}</small>
        </div>
      </div>
      
      <div class="timeline-body">
        <div 
          v-for="day in weekDays" 
          :key="day.date" 
          class="day-column"
        >
          <div
            v-for="slot in getTimeSlots(day.date)"
            :key="slot.key"
            :class="['time-slot', `zoom-${timelineZoom}`, getSlotClass(slot)]"
            @mousedown="startTimeSelection(slot)"
            @mousemove="updateTimeSelection(slot)"
            @mouseup="endTimeSelection"
          >
            <span class="time-label">{{ slot.label }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  addWeeks, 
  eachDayOfInterval,
  setHours,
  setMinutes,
  addMinutes,
  addDays,
  subWeeks
} from 'date-fns'
import type { TimePeriod } from '../../types/bayesian'

const props = defineProps<{
  currentState: boolean
  periods: TimePeriod[]
}>()

const emit = defineEmits<{
  periodAdded: [period: TimePeriod]
  bulkMarkRemaining: [isTruePeriod: boolean]
}>()

const now = new Date()
const currentWeekStart = ref(startOfWeek(subWeeks(now, 1))) // Start with last week
const timelineZoom = ref<'15min' | 'hour' | '6hour' | 'day'>('15min')
const isSelecting = ref(false)
const selectionStart = ref<any>(null)
const selectionEnd = ref<any>(null)
const timelineGrid = ref<HTMLElement>()

const currentWeekEnd = computed(() => endOfWeek(currentWeekStart.value))

const weekDays = computed(() => {
  const days = eachDayOfInterval({ 
    start: currentWeekStart.value, 
    end: currentWeekEnd.value 
  })
  
  return days.map(day => ({
    date: format(day, 'yyyy-MM-dd'),
    label: format(day, 'EEE'),
    dayName: format(day, 'EEEE')
  }))
})

const navigateWeek = (direction: number) => {
  const newWeekStart = addWeeks(currentWeekStart.value, direction)
  if (direction > 0 && newWeekStart > startOfWeek(now)) {
    return
  }
  currentWeekStart.value = newWeekStart
}

const formatDateRange = (start: Date, end: Date) => {
  return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`
}

const getTimeSlots = (dateStr: string) => {
  const date = new Date(dateStr)
  const slots = []
  
  if (timelineZoom.value === 'day') {
    slots.push({
      key: `${dateStr}-day`,
      label: 'All Day',
      start: date,
      end: addDays(date, 1)
    })
  } else if (timelineZoom.value === '6hour') {
    for (let hour = 0; hour < 24; hour += 6) {
      const start = setHours(date, hour)
      const end = setHours(date, hour + 6)
      slots.push({
        key: `${dateStr}-${hour}`,
        label: `${format(start, 'HH:mm')}-${format(end, 'HH:mm')}`,
        start,
        end
      })
    }
  } else if (timelineZoom.value === 'hour') {
    for (let hour = 0; hour < 24; hour++) {
      const start = setHours(date, hour)
      const end = setHours(date, hour + 1)
      slots.push({
        key: `${dateStr}-${hour}`,
        label: format(start, 'HH:mm'),
        start,
        end
      })
    }
  } else if (timelineZoom.value === '15min') {
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const start = setMinutes(setHours(date, hour), minute)
        const end = addMinutes(start, 15)
        slots.push({
          key: `${dateStr}-${hour}-${minute}`,
          label: format(start, 'HH:mm'),
          start,
          end
        })
      }
    }
  }
  
  return slots
}

const getSlotClass = (slot: any) => {
  const existingPeriod = props.periods.find(period => 
    slot.start >= period.start && slot.end <= period.end
  )
  
  if (existingPeriod) {
    return existingPeriod.isTruePeriod ? 'marked-true' : 'marked-false'
  }
  
  if (slot.start > now) {
    return 'disabled'
  }
  
  return 'unmarked'
}

const startTimeSelection = (slot: any) => {
  if (slot.start > now) return
  
  isSelecting.value = true
  selectionStart.value = slot
  selectionEnd.value = slot
}

const updateTimeSelection = (slot: any) => {
  if (isSelecting.value && slot.start <= now) {
    selectionEnd.value = slot
  }
}

const endTimeSelection = () => {
  if (isSelecting.value && selectionStart.value && selectionEnd.value) {
    const start = new Date(Math.min(
      selectionStart.value.start.getTime(),
      selectionEnd.value.start.getTime()
    ))
    const end = new Date(Math.max(
      selectionStart.value.end.getTime(),
      selectionEnd.value.end.getTime()
    ))
    
    const period: TimePeriod = {
      id: Date.now().toString(),
      start,
      end,
      isTruePeriod: props.currentState,
      label: `${format(start, 'MMM d HH:mm')} - ${format(end, 'HH:mm')}`
    }
    
    emit('periodAdded', period)
  }
  
  isSelecting.value = false
  selectionStart.value = null
  selectionEnd.value = null
}

defineExpose({
  markAllRemainingAs: (isTruePeriod: boolean) => {
    emit('bulkMarkRemaining', isTruePeriod)
  }
})
</script>

<style scoped>

.timeline-mode {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-bottom: 2rem;
}

.timeline-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #e0e0e0;
  background: #f8f9fa;
  border-radius: 8px 8px 0 0;
}

.date-navigation {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.current-week {
  font-weight: 500;
  color: #333;
  min-width: 200px;
  text-align: center;
}

.zoom-controls label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  color: #333;
}

.timeline-grid {
  padding: 1rem;
  user-select: none;
}

.timeline-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
  margin-bottom: 1rem;
}

.day-header {
  background: #f8f9fa;
  padding: 0.75rem;
  text-align: center;
  font-weight: 500;
  color: #333;
  border-radius: 4px;
}

.day-header small {
  display: block;
  font-size: 0.8rem;
  color: #666;
  margin-top: 0.25rem;
}

.timeline-body {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 1px;
}

.day-column {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.time-slot {
  padding: 0.25rem;
  border: 1px solid #e0e0e0;
  background: white;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.time-slot.zoom-15min {
  min-height: 20px;
}

.time-slot.zoom-hour {
  min-height: 30px;
}

.time-slot.zoom-6hour {
  min-height: 40px;
}

.time-slot.zoom-day {
  min-height: 60px;
}

.time-slot.unmarked:hover {
  background: #f0f0f0;
}

.time-slot.marked-true {
  background: #e8f5e9;
  border-color: #4CAF50;
  color: #2e7d32;
}

.time-slot.marked-false {
  background: #ffebee;
  border-color: #f44336;
  color: #c62828;
}

.time-slot.disabled {
  background: #f5f5f5;
  color: #bbb;
  cursor: not-allowed;
}

.time-label {
  font-size: 0.7rem;
  font-weight: 500;
  pointer-events: none;
}

@media (max-width: 768px) {
  .timeline-controls {
    flex-direction: column;
    gap: 1rem;
  }
  
  .date-navigation {
    flex-direction: column;
    gap: 0.5rem;
  }
  
  .current-week {
    min-width: auto;
  }
  
  .time-slot.zoom-15min {
    min-height: 16px;
  }
  
  .time-slot.zoom-hour {
    min-height: 24px;
  }
  
  .time-label {
    font-size: 0.6rem;
  }
}
</style>