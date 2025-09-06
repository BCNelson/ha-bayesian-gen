<template>
  <div class="calendar-timeline">
    <div class="calendar-controls">
      <div class="week-navigation">
        <button @click="navigateWeek(-1)" class="nav-btn">
          ← Previous Week
        </button>
        <span class="current-week">
          {{ formatWeekRange(currentWeekStart, currentWeekEnd) }}
        </span>
        <button 
          @click="navigateWeek(1)"
          :disabled="addWeeks(currentWeekStart, 1) > startOfWeek(new Date())"
          class="nav-btn"
        >
          Next Week →
        </button>
      </div>
    </div>

    <div class="calendar-grid" @mouseup="endSelection" @mouseleave="endSelection">
      <!-- Time axis labels -->
      <div class="time-axis">
        <div class="time-axis-header"></div>
        <div 
          v-for="hour in 24" 
          :key="hour"
          class="time-label"
          :style="{ height: `${hourHeight}px` }"
        >
          {{ formatHour(hour - 1) }}
        </div>
      </div>

      <!-- Day columns -->
      <CalendarDay
        v-for="(day, index) in weekDays"
        :key="day.dateStr"
        :date="day.date"
        :day-label="day.label"
        :day-index="index"
        :hour-height="hourHeight"
        :periods="props.periods"
        :is-selecting="isSelecting"
        :selection-state="currentState"
        :is-disabled="day.date > now"
        @selection-start="startSelection"
        @selection-move="updateSelection"
        @period-click="handlePeriodClick"
        @period-updated="handlePeriodUpdated"
      />
    </div>

    <!-- Selection preview -->
    <div v-if="selectionPreview" class="selection-preview">
      Selected: {{ selectionPreview.start.toLocaleString() }} - {{ selectionPreview.end.toLocaleString() }}
      ({{ Math.round((selectionPreview.end.getTime() - selectionPreview.start.getTime()) / 60000) }} minutes)
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  addWeeks, 
  eachDayOfInterval
} from 'date-fns'
import CalendarDay from './CalendarDay.vue'
import type { TimePeriod } from '../../types/bayesian'
import { detectRangeConflicts } from '../../utils/rangeUtils'

interface SelectionData {
  dayIndex: number
  startMinute: number
  endMinute: number
}

const props = defineProps<{
  currentState: boolean
  periods: TimePeriod[]
}>()

const emit = defineEmits<{
  periodAdded: [period: TimePeriod]
  periodRemoved: [periodId: string]
  periodUpdated: [period: TimePeriod]
  periodsUpdated: [periods: TimePeriod[]]
}>()

// Calendar state
const now = new Date()

const currentWeekStart = ref(startOfWeek(now))

// Watch for periods changes and automatically navigate to show them
watch(() => props.periods, (newPeriods) => {
  if (newPeriods && newPeriods.length > 0) {
    // Sort periods by start date and use the first one
    const sortedPeriods = [...newPeriods].sort((a, b) => a.start.getTime() - b.start.getTime())
    const periodWeekStart = startOfWeek(sortedPeriods[0].start)
    
    // Only change the week if periods aren't currently visible
    const currentWeekEnd = endOfWeek(currentWeekStart.value)
    const periodsVisible = newPeriods.some(period => 
      period.start <= currentWeekEnd && period.end >= currentWeekStart.value
    )
    
    if (!periodsVisible) {
      currentWeekStart.value = periodWeekStart
    }
  }
}, { immediate: true })
const hourHeight = 40

// Selection state
const isSelecting = ref(false)
const selectionStart = ref<SelectionData | null>(null)
const selectionEnd = ref<SelectionData | null>(null)

const currentWeekEnd = computed(() => endOfWeek(currentWeekStart.value))

const weekDays = computed(() => {
  const days = eachDayOfInterval({ 
    start: currentWeekStart.value, 
    end: currentWeekEnd.value 
  })
  
  return days.map(day => ({
    date: day,
    dateStr: format(day, 'yyyy-MM-dd'),
    label: format(day, 'EEE MMM d')
  }))
})

const selectionPreview = computed(() => {
  if (!isSelecting.value || !selectionStart.value || !selectionEnd.value) {
    return null
  }
  
  const startDay = weekDays.value[selectionStart.value.dayIndex]
  const endDay = weekDays.value[selectionEnd.value.dayIndex]
  
  if (!startDay || !endDay) return null
  
  const start = new Date(startDay.date)
  start.setHours(0, selectionStart.value.startMinute, 0, 0)
  
  const end = new Date(endDay.date)
  end.setHours(0, selectionEnd.value.endMinute, 0, 0)
  
  return { start, end }
})

const navigateWeek = (direction: number) => {
  const newWeekStart = addWeeks(currentWeekStart.value, direction)
  if (direction > 0 && newWeekStart > startOfWeek(now)) {
    return
  }
  currentWeekStart.value = newWeekStart
}

const formatWeekRange = (start: Date, end: Date) => {
  return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`
}

const formatHour = (hour: number) => {
  return format(new Date().setHours(hour, 0, 0, 0), 'HH:mm')
}


const startSelection = (data: SelectionData) => {
  if (weekDays.value[data.dayIndex]?.date > now) return
  
  isSelecting.value = true
  selectionStart.value = { ...data }
  selectionEnd.value = { ...data }
}

const updateSelection = (data: SelectionData) => {
  if (!isSelecting.value) return
  
  selectionEnd.value = { ...data }
}

const endSelection = () => {
  if (!isSelecting.value || !selectionStart.value || !selectionEnd.value) {
    isSelecting.value = false
    selectionStart.value = null
    selectionEnd.value = null
    return
  }
  
  const preview = selectionPreview.value
  if (!preview || preview.end.getTime() - preview.start.getTime() < 60 * 1000) {
    // Ignore selections shorter than 1 minute
    isSelecting.value = false
    selectionStart.value = null
    selectionEnd.value = null
    return
  }
  
  // Use the preview times directly (no snapping)
  const finalStart = preview.start
  const finalEnd = preview.end
  
  // Check for conflicts
  const conflicts = detectRangeConflicts({ start: finalStart, end: finalEnd }, props.periods)
  if (conflicts.length > 0) {
    // Could show a warning or auto-resolve conflicts
    console.warn('Selection conflicts with existing periods:', conflicts)
    isSelecting.value = false
    selectionStart.value = null
    selectionEnd.value = null
    return
  }
  
  const newPeriod: TimePeriod = {
    id: Date.now().toString(),
    start: finalStart,
    end: finalEnd,
    isTruePeriod: props.currentState,
    label: `${format(finalStart, 'MMM d HH:mm')} - ${format(finalEnd, 'HH:mm')}`
  }
  
  emit('periodAdded', newPeriod)
  
  isSelecting.value = false
  selectionStart.value = null
  selectionEnd.value = null
}

const handlePeriodClick = (periodId: string) => {
  emit('periodRemoved', periodId)
}

const handlePeriodUpdated = (updatedPeriod: TimePeriod) => {
  emit('periodUpdated', updatedPeriod)
}

// Global mouse event handlers
const handleGlobalMouseUp = () => {
  if (isSelecting.value) {
    endSelection()
  }
}

onMounted(() => {
  document.addEventListener('mouseup', handleGlobalMouseUp)
})

onBeforeUnmount(() => {
  document.removeEventListener('mouseup', handleGlobalMouseUp)
})
</script>

<style scoped>
.calendar-timeline {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: visible;
}

.calendar-controls {
  padding: 1rem;
  background: #f8f9fa;
  border-bottom: 1px solid #e0e0e0;
}

.week-navigation {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2rem;
}

.nav-btn {
  background: white;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  color: #24292f;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-btn:hover:not(:disabled) {
  background: #f3f4f6;
  border-color: #8c959f;
}

.nav-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.current-week {
  font-weight: 600;
  color: #24292f;
  min-width: 220px;
  text-align: center;
}

.calendar-grid {
  display: grid;
  grid-template-columns: 60px repeat(7, 1fr);
  background: white;
  user-select: none;
}

.time-axis {
  background: #f8f9fa;
  border-right: 1px solid #e0e0e0;
}

.time-axis-header {
  height: 60px;
  border-bottom: 1px solid #e0e0e0;
}

.time-label {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  color: #656d76;
  font-weight: 500;
  border-bottom: 1px solid #e0e0e0;
  background: #f8f9fa;
}

.selection-preview {
  position: absolute;
  bottom: 1rem;
  right: 1rem;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  pointer-events: none;
  z-index: 10;
}

@media (max-width: 768px) {
  .calendar-grid {
    grid-template-columns: 50px repeat(7, 1fr);
  }
  
  .week-navigation {
    flex-direction: column;
    gap: 1rem;
  }
  
  .current-week {
    min-width: auto;
  }
}
</style>