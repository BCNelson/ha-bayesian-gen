<template>
  <div 
    v-if="isVisible"
    class="time-range-overlay"
    :class="[
      period.isTruePeriod ? 'range-true' : 'range-false',
      { 'clickable': !isSelecting, 'resizing': isResizing, 'dragging': isDragging }
    ]"
    :style="overlayStyle"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
    @mousedown="startDrag"
  >
    <!-- Top resize handle -->
    <div 
      class="resize-handle resize-handle-top"
      @mousedown="startResize($event, 'start')"
    />
    
    <div class="range-content">
      <div class="period-label">
        {{ period.label }}
      </div>
    </div>
    
    <!-- Bottom resize handle -->
    <div 
      class="resize-handle resize-handle-bottom"
      @mousedown="startResize($event, 'end')"
    />
    
    <!-- Tooltip -->
    <div 
      v-if="showTooltip" 
      ref="tooltipEl"
      class="range-tooltip"
      :class="`tooltip-${tooltipPosition}`"
    >
      <div class="tooltip-content">
        <div class="tooltip-time">{{ period.label || formatFullTimeRange(period.start, period.end) }}</div>
        <div class="tooltip-type">{{ period.isTruePeriod ? 'TRUE' : 'FALSE' }} period</div>
        <div class="tooltip-duration">{{ formatDuration(period.start, period.end) }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { format, startOfDay, isSameDay, differenceInMinutes } from 'date-fns'
import type { TimePeriod } from '../../types/bayesian'

const props = defineProps<{
  period: TimePeriod
  date: Date
  hourHeight: number
  isSelecting?: boolean
}>()

const emit = defineEmits<{
  click: [periodId: string]
  periodUpdated: [period: TimePeriod]
}>()

const showTooltip = ref(false)
const tooltipEl = ref<HTMLElement>()
const tooltipPosition = ref<'center' | 'left' | 'right'>('center')
const isResizing = ref(false)
const resizeType = ref<'start' | 'end' | null>(null)
const resizeStartY = ref(0)
const originalPeriod = ref<{ start: Date; end: Date } | null>(null)

// Dragging state
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragStartTime = ref<{ start: Date; end: Date } | null>(null)
const dragOffset = ref({ x: 0, y: 0 })
const finalDragPosition = ref<TimePeriod | null>(null)

const isVisible = computed(() => {
  const dayStart = new Date(props.date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(props.date)
  dayEnd.setHours(23, 59, 59, 999)
  
  // Check if period overlaps with this day
  return props.period.start < dayEnd && props.period.end > dayStart
})

const overlayStyle = computed(() => {
  if (!isVisible.value) return {}
  
  // Create day boundaries in LOCAL timezone
  const dayStart = new Date(props.date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(props.date)
  dayEnd.setHours(23, 59, 59, 999)
  
  // Calculate the visible portion of the period on this day
  const visibleStart = new Date(Math.max(props.period.start.getTime(), dayStart.getTime()))
  const visibleEnd = new Date(Math.min(props.period.end.getTime(), dayEnd.getTime()))
  
  // Convert UTC period times to local time for positioning
  const localVisibleStart = new Date(visibleStart)
  const localVisibleEnd = new Date(visibleEnd)
  
  // Calculate minutes from local day start using local time
  const localDayStart = new Date(props.date)
  localDayStart.setHours(0, 0, 0, 0)
  
  const startMinutes = Math.floor((localVisibleStart.getTime() - localDayStart.getTime()) / (1000 * 60))
  const endMinutes = Math.floor((localVisibleEnd.getTime() - localDayStart.getTime()) / (1000 * 60))
  
  // Calculate pixel positions (no header offset needed since we're inside day-body)
  const totalDayMinutes = 24 * 60
  const pixelsPerMinute = (24 * props.hourHeight) / totalDayMinutes
  
  const top = startMinutes * pixelsPerMinute
  const height = (endMinutes - startMinutes) * pixelsPerMinute
  
  const style: any = {
    position: 'absolute' as const,
    top: `${top}px`,
    height: `${height}px`,
    left: '2px',
    right: '2px',
    zIndex: 3
  }
  
  // Add transform during drag for smooth movement
  if (isDragging.value) {
    style.transform = `translate(${dragOffset.value.x}px, ${dragOffset.value.y}px)`
    style.zIndex = 1002
  }
  
  return style
})

const formatTimeRange = (start: Date, end: Date): string => {
  if (isSameDay(start, end)) {
    return `${format(start, 'HH:mm')}-${format(end, 'HH:mm')}`
  }
  
  // Multi-day range
  if (isSameDay(start, props.date)) {
    return `${format(start, 'HH:mm')}-24:00`
  } else if (isSameDay(end, props.date)) {
    return `00:00-${format(end, 'HH:mm')}`
  } else {
    return 'All Day'
  }
}

const formatFullTimeRange = (start: Date, end: Date): string => {
  if (isSameDay(start, end)) {
    return `${format(start, 'MMM d, HH:mm')} - ${format(end, 'HH:mm')}`
  }
  return `${format(start, 'MMM d, HH:mm')} - ${format(end, 'MMM d, HH:mm')}`
}

const formatDuration = (start: Date, end: Date): string => {
  const minutes = differenceInMinutes(end, start)
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  
  if (hours === 0) {
    return `${mins}m`
  } else if (mins === 0) {
    return `${hours}h`
  } else {
    return `${hours}h ${mins}m`
  }
}

const handleClick = (event: MouseEvent) => {
  event.stopPropagation()
  // Don't emit click event - clicking periods doesn't remove them
}

const handleMouseEnter = async () => {
  showTooltip.value = true
  await nextTick()
  adjustTooltipPosition()
}

const handleMouseLeave = () => {
  showTooltip.value = false
  tooltipPosition.value = 'center'
}

const adjustTooltipPosition = () => {
  if (!tooltipEl.value) return
  
  const tooltip = tooltipEl.value
  const rect = tooltip.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  
  // Check if tooltip goes off the left edge
  if (rect.left < 0) {
    tooltipPosition.value = 'left'
  }
  // Check if tooltip goes off the right edge
  else if (rect.right > viewportWidth) {
    tooltipPosition.value = 'right'
  }
  // Otherwise keep it centered
  else {
    tooltipPosition.value = 'center'
  }
}

const startResize = (event: MouseEvent, type: 'start' | 'end') => {
  event.stopPropagation()
  event.preventDefault()
  
  isResizing.value = true
  resizeType.value = type
  resizeStartY.value = event.clientY
  originalPeriod.value = {
    start: new Date(props.period.start),
    end: new Date(props.period.end)
  }
  
  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', endResize)
}

const handleResize = (event: MouseEvent) => {
  if (!isResizing.value || !originalPeriod.value || !resizeType.value) return
  
  const deltaY = event.clientY - resizeStartY.value
  const pixelsPerMinute = (24 * props.hourHeight) / (24 * 60)
  const deltaMinutes = deltaY / pixelsPerMinute
  
  let newStart = new Date(originalPeriod.value.start)
  let newEnd = new Date(originalPeriod.value.end)
  
  if (resizeType.value === 'start') {
    newStart = new Date(originalPeriod.value.start.getTime() + deltaMinutes * 60 * 1000)
    // Ensure start doesn't go past end (minimum 1 minute)
    if (newStart >= newEnd) {
      newStart = new Date(newEnd.getTime() - 60 * 1000)
    }
  } else {
    newEnd = new Date(originalPeriod.value.end.getTime() + deltaMinutes * 60 * 1000)
    // Ensure end doesn't go before start (minimum 1 minute)
    if (newEnd <= newStart) {
      newEnd = new Date(newStart.getTime() + 60 * 1000)
    }
  }
  
  // Create updated period
  const updatedPeriod: TimePeriod = {
    ...props.period,
    start: newStart,
    end: newEnd,
    label: `${format(newStart, 'MMM d HH:mm')} - ${format(newEnd, 'HH:mm')}`
  }
  
  emit('periodUpdated', updatedPeriod)
}

const endResize = () => {
  isResizing.value = false
  resizeType.value = null
  originalPeriod.value = null
  
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', endResize)
}

// Drag functionality
const startDrag = (event: MouseEvent) => {
  // Don't start drag if we're already resizing
  if (isResizing.value) return
  
  // Don't start drag if clicking on a resize handle
  const target = event.target as HTMLElement
  if (target.classList.contains('resize-handle')) return
  
  event.preventDefault()
  event.stopPropagation()
  
  
  isDragging.value = true
  dragStartX.value = event.clientX
  dragStartY.value = event.clientY
  dragStartTime.value = {
    start: new Date(props.period.start),
    end: new Date(props.period.end)
  }
  
  document.addEventListener('mousemove', handleDrag)
  document.addEventListener('mouseup', endDrag)
}

const handleDrag = (event: MouseEvent) => {
  if (!isDragging.value || !dragStartTime.value) return
  
  const deltaX = event.clientX - dragStartX.value
  const deltaY = event.clientY - dragStartY.value
  
  // Update visual offset immediately for smooth dragging
  dragOffset.value = { x: deltaX, y: deltaY }
  
  // Calculate position for final placement (no snapping)
  const pixelsPerMinute = (24 * props.hourHeight) / (24 * 60)
  const deltaMinutes = deltaY / pixelsPerMinute
  const pixelsPerDay = 120 // Approximate day width
  const deltaDays = Math.round(deltaX / pixelsPerDay)
  
  // Calculate new start and end times for final position
  const periodDuration = dragStartTime.value.end.getTime() - dragStartTime.value.start.getTime()
  const newStart = new Date(dragStartTime.value.start.getTime() + deltaDays * 24 * 60 * 60 * 1000 + deltaMinutes * 60 * 1000)
  const newEnd = new Date(newStart.getTime() + periodDuration)
  
  // Don't allow dragging to future dates
  const now = new Date()
  if (newEnd > now) {
    return
  }
  
  // Store final position for when drag ends
  finalDragPosition.value = {
    ...props.period,
    start: newStart,
    end: newEnd,
    label: `${format(newStart, 'MMM d HH:mm')} - ${format(newEnd, 'HH:mm')}`
  }
}

const endDrag = () => {
  // Emit the final updated period if we have a final position
  if (finalDragPosition.value) {
    emit('periodUpdated', finalDragPosition.value)
  }
  
  isDragging.value = false
  dragStartTime.value = null
  dragOffset.value = { x: 0, y: 0 }
  finalDragPosition.value = null
  
  document.removeEventListener('mousemove', handleDrag)
  document.removeEventListener('mouseup', endDrag)
}
</script>

<style scoped>
.time-range-overlay {
  border-radius: 4px;
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  transition: all 0.2s;
  transition-property: opacity, box-shadow, border-color, background;
  min-height: 20px;
  position: relative;
}

.range-true {
  background: rgba(76, 175, 80, 0.8);
  color: #1b5e20;
  border-color: rgba(46, 125, 50, 0.3);
}

.range-false {
  background: rgba(244, 67, 54, 0.8);
  color: #b71c1c;
  border-color: rgba(198, 40, 40, 0.3);
}

.time-range-overlay.clickable {
  cursor: move;
}

.time-range-overlay.clickable:hover {
  opacity: 1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1000;
}

.time-range-overlay.resizing {
  z-index: 1001;
  opacity: 0.8;
}

.time-range-overlay.dragging {
  z-index: 1002;
  opacity: 0.9;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  transition: none !important;
}

.range-true.clickable:hover {
  border-color: #2e7d32;
  background: rgba(76, 175, 80, 0.9);
}

.range-false.clickable:hover {
  border-color: #c62828;
  background: rgba(244, 67, 54, 0.9);
}

.range-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-shadow: 0 1px 2px rgba(255, 255, 255, 0.8);
  pointer-events: none;
  padding: 2px 4px;
  height: 100%;
  min-height: 32px;
}

.period-label {
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: center;
}

.range-tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 0.5rem;
  border-radius: 6px;
  font-size: 0.75rem;
  white-space: nowrap;
  z-index: 99999;
  margin-bottom: 8px;
  pointer-events: none;
  max-width: 90vw;
  box-sizing: border-box;
}

/* Dynamic positioning classes */
.range-tooltip.tooltip-left {
  left: 0;
  transform: translateX(0);
}

.range-tooltip.tooltip-right {
  left: auto;
  right: 0;
  transform: translateX(0);
}

.range-tooltip.tooltip-center {
  left: 50%;
  transform: translateX(-50%);
}

.range-tooltip::before {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: rgba(0, 0, 0, 0.9);
}

/* Adjust arrow position based on tooltip position */
.range-tooltip.tooltip-left::before {
  left: 1rem;
  transform: translateX(-50%);
}

.range-tooltip.tooltip-right::before {
  left: auto;
  right: 1rem;
  transform: translateX(50%);
}

.range-tooltip.tooltip-center::before {
  left: 50%;
  transform: translateX(-50%);
}

.tooltip-content {
  text-align: center;
}

/* Resize handles */
.resize-handle {
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  cursor: ns-resize;
  opacity: 0;
  transition: opacity 0.2s;
}

.resize-handle-top {
  top: 0;
  border-radius: 4px 4px 0 0;
}

.resize-handle-bottom {
  bottom: 0;
  border-radius: 0 0 4px 4px;
}

.time-range-overlay:hover .resize-handle {
  opacity: 1;
}

.resize-handle:hover {
  background: rgba(255, 255, 255, 0.6);
}

.time-range-overlay.resizing .resize-handle {
  opacity: 1;
  background: rgba(255, 255, 255, 0.8);
}

.tooltip-time {
  font-weight: 600;
  margin-bottom: 2px;
}

.tooltip-type {
  font-size: 0.7rem;
  opacity: 0.8;
  margin-bottom: 2px;
}

.tooltip-duration {
  font-size: 0.7rem;
  opacity: 0.8;
}

/* Handle very small ranges */
.time-range-overlay[style*="height: 1"][style*="px"],
.time-range-overlay[style*="height: 2"][style*="px"],
.time-range-overlay[style*="height: 3"][style*="px"],
.time-range-overlay[style*="height: 4"][style*="px"],
.time-range-overlay[style*="height: 5"][style*="px"] {
  min-height: 3px;
}

.time-range-overlay[style*="height: 1"][style*="px"] .range-content,
.time-range-overlay[style*="height: 2"][style*="px"] .range-content,
.time-range-overlay[style*="height: 3"][style*="px"] .range-content,
.time-range-overlay[style*="height: 4"][style*="px"] .range-content,
.time-range-overlay[style*="height: 5"][style*="px"] .range-content {
  display: none;
}

/* For small ranges, use smaller font */
.time-range-overlay[style*="height: 6"][style*="px"] .period-label,
.time-range-overlay[style*="height: 7"][style*="px"] .period-label,
.time-range-overlay[style*="height: 8"][style*="px"] .period-label,
.time-range-overlay[style*="height: 9"][style*="px"] .period-label,
.time-range-overlay[style*="height: 10"][style*="px"] .period-label,
.time-range-overlay[style*="height: 11"][style*="px"] .period-label,
.time-range-overlay[style*="height: 12"][style*="px"] .period-label {
  font-size: 0.65rem;
}
</style>