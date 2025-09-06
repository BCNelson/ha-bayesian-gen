<template>
  <div class="calendar-day" :class="{ 'disabled': isDisabled }">
    <!-- Day header -->
    <div class="day-header">
      <div class="day-label">{{ dayLabel }}</div>
    </div>
    
    <!-- Hour strips with time range overlays -->
    <div class="day-body" ref="dayBodyRef">
      <div 
        v-for="hour in 24" 
        :key="hour"
        class="hour-strip"
        :style="{ height: `${hourHeight}px` }"
        @mousedown="handleMouseDown($event, hour - 1)"
        @mousemove="handleMouseMove($event, hour - 1)"
        @mouseenter="handleMouseEnter($event, hour - 1)"
      >
        <!-- Selection overlay -->
        <div 
          v-if="selectionOverlay && selectionOverlay.hour === hour - 1"
          class="selection-overlay"
          :class="[`selection-${selectionState ? 'true' : 'false'}`]"
          :style="selectionOverlay.style"
        />
      </div>
      
      <!-- Time range overlays -->
      <TimeRangeOverlay
        v-for="period in dayPeriods"
        :key="period.id"
        :period="period"
        :date="date"
        :hour-height="hourHeight"
        @click="$emit('periodClick', period.id)"
        @period-updated="$emit('periodUpdated', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import TimeRangeOverlay from './TimeRangeOverlay.vue'
import type { TimePeriod } from '../../types/bayesian'

interface SelectionOverlay {
  hour: number
  style: {
    top: string
    height: string
  }
}

const props = defineProps<{
  date: Date
  dayLabel: string
  dayIndex: number
  hourHeight: number
  periods: TimePeriod[]
  isSelecting: boolean
  selectionState: boolean
  isDisabled: boolean
}>()

const emit = defineEmits<{
  selectionStart: [data: { dayIndex: number; startMinute: number; endMinute: number }]
  selectionMove: [data: { dayIndex: number; startMinute: number; endMinute: number }]
  periodClick: [periodId: string]
  periodUpdated: [period: TimePeriod]
}>()

const dayBodyRef = ref<HTMLElement>()
const isMouseDown = ref(false)
const dragStartMinute = ref<number | null>(null)

// Filter periods that actually appear on this day
const dayPeriods = computed(() => {
  const dayStart = new Date(props.date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(props.date) 
  dayEnd.setHours(23, 59, 59, 999)
  
  return props.periods.filter(period => 
    period.start < dayEnd && period.end > dayStart
  )
})

const selectionOverlay = computed((): SelectionOverlay | null => {
  if (!props.isSelecting || dragStartMinute.value === null) return null
  
  // This would be set by the parent component during selection
  // For now, return null as the actual selection rendering will be handled by parent
  return null
})

const getMinuteFromMouseEvent = (event: MouseEvent, hour: number): number => {
  if (!dayBodyRef.value) return hour * 60
  
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const relativeY = event.clientY - rect.top
  const minuteInHour = (relativeY / props.hourHeight) * 60
  
  // No snapping - use exact minute position
  const exactMinute = minuteInHour
  return hour * 60 + Math.max(0, Math.min(59, exactMinute))
}

const handleMouseDown = (event: MouseEvent, hour: number) => {
  if (props.isDisabled) return
  
  event.preventDefault()
  isMouseDown.value = true
  
  const minute = getMinuteFromMouseEvent(event, hour)
  dragStartMinute.value = minute
  
  emit('selectionStart', {
    dayIndex: props.dayIndex,
    startMinute: minute,
    endMinute: minute + 1 // Minimum 1-minute selection
  })
}

const handleMouseMove = (event: MouseEvent, hour: number) => {
  if (!isMouseDown.value || dragStartMinute.value === null || props.isDisabled) return
  
  const currentMinute = getMinuteFromMouseEvent(event, hour)
  const startMinute = Math.min(dragStartMinute.value, currentMinute)
  const endMinute = Math.max(dragStartMinute.value, currentMinute + 1)
  
  emit('selectionMove', {
    dayIndex: props.dayIndex,
    startMinute,
    endMinute
  })
}

const handleMouseEnter = (event: MouseEvent, hour: number) => {
  if (!props.isSelecting || props.isDisabled) return
  
  // Handle drag selection across hours/days
  handleMouseMove(event, hour)
}

// Reset mouse state when selection ends
const resetMouseState = () => {
  isMouseDown.value = false
  dragStartMinute.value = null
}

// Listen for global mouse up to end selection
document.addEventListener('mouseup', resetMouseState)
</script>

<style scoped>
.calendar-day {
  border-right: 1px solid #e0e0e0;
  position: relative;
}

.calendar-day:last-child {
  border-right: none;
}

.calendar-day.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.day-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f8f9fa;
  border-bottom: 1px solid #e0e0e0;
  position: sticky;
  top: 0;
  z-index: 2;
}

.day-label {
  font-weight: 600;
  font-size: 0.875rem;
  color: #24292f;
  text-align: center;
}

.day-body {
  position: relative;
  height: 100%;
}

.hour-strip {
  border-bottom: 1px solid #e0e0e0;
  position: relative;
  cursor: crosshair;
  transition: background-color 0.1s;
}

.hour-strip:hover {
  background-color: rgba(0, 0, 0, 0.02);
}

.hour-strip:last-child {
  border-bottom: none;
}

.selection-overlay {
  position: absolute;
  left: 0;
  right: 0;
  border-radius: 4px;
  opacity: 0.6;
  pointer-events: none;
  z-index: 1;
}

.selection-overlay.selection-true {
  background: #4CAF50;
  border: 2px solid #2e7d32;
}

.selection-overlay.selection-false {
  background: #f44336;
  border: 2px solid #c62828;
}

/* Add subtle hour indicators */
.hour-strip::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(0, 0, 0, 0.05);
}

/* Quarter-hour guides */
.hour-strip::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: rgba(0, 0, 0, 0.02);
}
</style>