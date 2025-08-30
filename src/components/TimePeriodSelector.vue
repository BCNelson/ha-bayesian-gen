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
          :class="{ active: mode === 'single' }"
          @click="mode = 'single'"
        >
          Single Period
        </button>
        <button 
          :class="{ active: mode === 'bulk' }"
          @click="mode = 'bulk'"
        >
          Bulk Selection
        </button>
        <button 
          :class="{ active: mode === 'timeline' }"
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

    <!-- Single Period Mode -->
    <div v-if="mode === 'single'" class="single-mode">
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
        
        <button @click="addSinglePeriod" :disabled="!isValidSinglePeriod">
          Add Period
        </button>
      </div>
    </div>

    <!-- Bulk Selection Mode -->
    <div v-if="mode === 'bulk'" class="bulk-mode">
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
        
        <button @click="addBulkPeriods" :disabled="!isValidBulkSelection">
          Add {{ bulkPeriodCount }} Periods
        </button>
      </div>
    </div>

    <!-- Timeline Mode -->
    <div v-if="mode === 'timeline'" class="timeline-mode">
      <div class="timeline-controls">
        <div class="date-navigation">
          <button @click="navigateWeek(-1)">← Previous Week</button>
          <span class="current-week">
            {{ formatDateRange(currentWeekStart, currentWeekEnd) }}
          </span>
          <button 
            @click="navigateWeek(1)"
            :disabled="addWeeks(currentWeekStart, 1) > startOfWeek(new Date())"
          >
            Next Week →
          </button>
        </div>
        
        <div class="zoom-controls">
          <label>
            View: 
            <select v-model="timelineZoom">
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
    
    <div v-if="periods.length > 0" class="periods-list">
      <div class="periods-header">
        <h3>Added Periods ({{ periods.length }})</h3>
        <div class="bulk-actions">
          <button 
            @click="markAllRemainingAs(true)"
            :disabled="mode !== 'timeline'"
            class="bulk-action-btn true-btn"
            title="Mark all unmarked timeline slots as TRUE"
          >
            Mark Remaining as TRUE
          </button>
          <button 
            @click="markAllRemainingAs(false)"
            :disabled="mode !== 'timeline'"
            class="bulk-action-btn false-btn"
            title="Mark all unmarked timeline slots as FALSE"
          >
            Mark Remaining as FALSE
          </button>
          <button 
            @click="clearAllPeriods"
            class="bulk-action-btn clear-btn"
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
            <button class="remove-btn" @click="removePeriod(period.id)">×</button>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { 
  format, 
  differenceInMinutes, 
  differenceInHours, 
  startOfWeek, 
  endOfWeek, 
  addWeeks, 
  eachDayOfInterval,
  setHours,
  setMinutes,
  addMinutes,
  addDays,
  subDays,
  subWeeks
} from 'date-fns'
import type { TimePeriod } from '../types/bayesian'

const emit = defineEmits<{
  periodsUpdated: [periods: TimePeriod[]]
}>()

const periods = ref<TimePeriod[]>([])
const mode = ref<'single' | 'bulk' | 'timeline'>('single')
const currentState = ref(true)

const newPeriod = ref({
  start: '',
  end: '',
  label: ''
})

const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const bulkSelection = ref({
  startDate: '',
  endDate: '',
  startTime: '09:00',
  endTime: '17:00',
  daysOfWeek: [] as number[],
  labelPattern: 'Period {date} {time}'
})

const now = new Date()
const currentWeekStart = ref(startOfWeek(subWeeks(now, 1))) // Start with last week
const timelineZoom = ref<'15min' | 'hour' | '6hour' | 'day'>('15min')
const isSelecting = ref(false)
const selectionStart = ref<any>(null)
const selectionEnd = ref<any>(null)

const maxDate = format(now, 'yyyy-MM-dd')
const maxDateTime = format(now, 'yyyy-MM-dd\'T\'HH:mm')

const isValidSinglePeriod = computed(() => {
  if (!newPeriod.value.start || !newPeriod.value.end) return false
  const start = new Date(newPeriod.value.start)
  const end = new Date(newPeriod.value.end)
  return start < end && end <= now && start <= now
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

const sortedPeriods = computed(() => {
  return [...periods.value].sort((a, b) => a.start.getTime() - b.start.getTime())
})

const addSinglePeriod = () => {
  if (!isValidSinglePeriod.value) return
  
  const period: TimePeriod = {
    id: Date.now().toString(),
    start: new Date(newPeriod.value.start),
    end: new Date(newPeriod.value.end),
    isTruePeriod: currentState.value,
    label: newPeriod.value.label || undefined
  }
  
  periods.value.push(period)
  mergeAdjacentPeriods()
  emit('periodsUpdated', periods.value)
  
  newPeriod.value = {
    start: '',
    end: '',
    label: ''
  }
}

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
          isTruePeriod: currentState.value,
          label
        })
      }
    })
  
  periods.value.push(...newPeriods)
  mergeAdjacentPeriods()
  emit('periodsUpdated', periods.value)
}

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
  const existingPeriod = periods.value.find(period => 
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
      isTruePeriod: currentState.value,
      label: `${format(start, 'MMM d HH:mm')} - ${format(end, 'HH:mm')}`
    }
    
    periods.value.push(period)
    mergeAdjacentPeriods()
    emit('periodsUpdated', periods.value)
  }
  
  isSelecting.value = false
  selectionStart.value = null
  selectionEnd.value = null
}

const removePeriod = (id: string) => {
  periods.value = periods.value.filter(p => p.id !== id)
  emit('periodsUpdated', periods.value)
}

const markAllRemainingAs = (isTruePeriod: boolean) => {
  if (mode.value !== 'timeline') return
  
  const newPeriods: TimePeriod[] = []
  const currentWeek = weekDays.value
  
  currentWeek.forEach(day => {
    const timeSlots = getTimeSlots(day.date)
    
    timeSlots.forEach(slot => {
      if (slot.start > now) return
      
      const existingPeriod = periods.value.find(period => 
        slot.start >= period.start && slot.end <= period.end
      )
      
      if (!existingPeriod) {
        newPeriods.push({
          id: `bulk-${Date.now()}-${newPeriods.length}`,
          start: slot.start,
          end: slot.end,
          isTruePeriod,
          label: `Auto-marked ${isTruePeriod ? 'TRUE' : 'FALSE'} - ${format(slot.start, 'MMM d HH:mm')}`
        })
      }
    })
  })
  
  if (newPeriods.length > 0) {
    periods.value.push(...newPeriods)
    mergeAdjacentPeriods()
    emit('periodsUpdated', periods.value)
  }
}

const clearAllPeriods = () => {
  if (confirm('Are you sure you want to remove all time periods?')) {
    periods.value = []
    emit('periodsUpdated', periods.value)
  }
}

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

const mergeAdjacentPeriods = () => {
  if (periods.value.length < 2) return

  const sortedPeriods = [...periods.value].sort((a, b) => a.start.getTime() - b.start.getTime())
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

onMounted(() => {
  const weekAgo = subDays(now, 7)
  const yesterday = subDays(now, 1)
  
  bulkSelection.value.startDate = format(weekAgo, 'yyyy-MM-dd')
  bulkSelection.value.endDate = format(yesterday, 'yyyy-MM-dd')
  bulkSelection.value.daysOfWeek = [1, 2, 3, 4, 5] // Weekdays
})
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
}

.mode-selector {
  display: flex;
  gap: 0.5rem;
}

.mode-selector button {
  padding: 0.5rem 1rem;
  border: 2px solid #e0e0e0;
  background: white;
  color: #666;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s;
}

.mode-selector button.active {
  border-color: #4CAF50;
  background: #4CAF50;
  color: white;
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

.single-mode {
  background: #f5f5f5;
  padding: 1.5rem;
  border-radius: 8px;
  margin-bottom: 2rem;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr auto;
  gap: 1rem;
  align-items: end;
}

.form-group {
  display: flex;
  flex-direction: column;
}

.form-group label {
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #555;
}

.form-group input {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.95rem;
}

.bulk-mode {
  background: #f5f5f5;
  padding: 1.5rem;
  border-radius: 8px;
  margin-bottom: 2rem;
}

.bulk-controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}

.bulk-controls .form-group:last-child {
  grid-column: 1 / -1;
}

.date-range,
.time-range {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.date-range input,
.time-range input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
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
}

.bulk-controls small {
  color: #777;
  font-size: 0.85rem;
  margin-top: 0.25rem;
}

.timeline-mode {
  margin-bottom: 2rem;
}

.timeline-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
}

.date-navigation {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.date-navigation button {
  padding: 0.5rem 1rem;
  background: #2196F3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.current-week {
  font-weight: 500;
  color: #333;
}

.zoom-controls select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.timeline-grid {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  user-select: none;
}

.timeline-header {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  background: #f8f9fa;
  border-bottom: 2px solid #e0e0e0;
}

.day-header {
  padding: 1rem;
  text-align: center;
  font-weight: 500;
  border-right: 1px solid #e0e0e0;
}

.day-header:last-child {
  border-right: none;
}

.day-header small {
  display: block;
  color: #666;
  font-weight: normal;
}

.timeline-body {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  min-height: 400px;
  max-height: 600px;
  overflow-y: auto;
}

.day-column {
  border-right: 1px solid #e0e0e0;
  display: flex;
  flex-direction: column;
}

.day-column:last-child {
  border-right: none;
}

.time-slot {
  border-bottom: 1px solid #f0f0f0;
  padding: 0.1rem;
  min-height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s;
  position: relative;
}

.time-slot.zoom-15min {
  min-height: 15px;
  font-size: 0.6rem;
}

.time-slot.zoom-hour {
  min-height: 30px;
}

.time-slot.zoom-6hour {
  min-height: 60px;
}

.time-slot.zoom-day {
  min-height: 120px;
}

.time-slot:hover {
  background: rgba(33, 150, 243, 0.1);
}

.time-slot.unmarked {
  background: white;
}

.time-slot.marked-true {
  background: rgba(76, 175, 80, 0.3);
  border-left: 4px solid #4CAF50;
}

.time-slot.marked-false {
  background: rgba(244, 67, 54, 0.3);
  border-left: 4px solid #f44336;
}

.time-slot.disabled {
  background: #f8f8f8;
  color: #ccc;
  cursor: not-allowed;
  opacity: 0.5;
}

.time-slot.disabled:hover {
  background: #f8f8f8;
}

.time-label {
  font-size: 0.75rem;
  color: #666;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}

.zoom-15min .time-label {
  font-size: 0.6rem;
  transform: rotate(-45deg);
  width: 100%;
}

.zoom-hour .time-label {
  font-size: 0.7rem;
}

.zoom-6hour .time-label {
  font-size: 0.8rem;
}

.zoom-day .time-label {
  font-size: 0.9rem;
}

button {
  padding: 0.75rem 1.5rem;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  transition: background 0.3s;
}

button:hover:not(:disabled) {
  background: #45a049;
}

button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

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
  color: #333;
}

.bulk-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.bulk-action-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.3s;
  font-weight: 500;
}

.bulk-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.true-btn {
  background: #e8f5e9;
  color: #2e7d32;
  border: 1px solid #4CAF50;
}

.true-btn:hover:not(:disabled) {
  background: #c8e6c9;
}

.false-btn {
  background: #ffebee;
  color: #c62828;
  border: 1px solid #f44336;
}

.false-btn:hover:not(:disabled) {
  background: #ffcdd2;
}

.clear-btn {
  background: #f5f5f5;
  color: #666;
  border: 1px solid #ddd;
}

.clear-btn:hover:not(:disabled) {
  background: #e0e0e0;
}

.period-summary {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: #f8f9fa;
  border-radius: 4px;
}

.summary-item {
  font-weight: 500;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  font-size: 0.9rem;
}

.true-summary {
  background: #e8f5e9;
  color: #2e7d32;
}

.false-summary {
  background: #ffebee;
  color: #c62828;
}

.period-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1rem;
}

.period-card {
  padding: 1rem;
  border-radius: 8px;
  border: 2px solid;
  position: relative;
}

.true-period {
  background: #e8f5e9;
  border-color: #4CAF50;
}

.false-period {
  background: #ffebee;
  border-color: #f44336;
}

.period-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.period-state {
  font-weight: bold;
  font-size: 0.9rem;
}

.true-period .period-state {
  color: #4CAF50;
}

.false-period .period-state {
  color: #f44336;
}

.remove-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  color: #999;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
}

.remove-btn:hover {
  color: #f44336;
}

.period-time {
  font-size: 0.9rem;
  color: #555;
  margin-bottom: 0.25rem;
}

.period-duration {
  font-size: 0.85rem;
  color: #777;
  margin-bottom: 0.5rem;
}

.period-label {
  font-size: 0.9rem;
  color: #666;
  font-style: italic;
  padding-top: 0.5rem;
  border-top: 1px solid rgba(0,0,0,0.1);
}

@media (max-width: 768px) {
  .controls {
    flex-direction: column;
    gap: 1rem;
  }
  
  .form-row {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  
  .bulk-controls {
    grid-template-columns: 1fr;
  }
  
  .timeline-header,
  .timeline-body {
    grid-template-columns: repeat(7, minmax(60px, 1fr));
  }
  
  .time-label {
    font-size: 0.65rem;
  }
  
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
}
</style>