import type { TimePeriod } from '../types/bayesian'
import { format } from 'date-fns'

export interface RangeConflict {
  newRange: { start: Date; end: Date }
  conflictingPeriod: TimePeriod
  overlapStart: Date
  overlapEnd: Date
  overlapDuration: number
}

/**
 * Detects conflicts between a new time range and existing periods
 */
export function detectRangeConflicts(
  newRange: { start: Date; end: Date },
  existingPeriods: TimePeriod[]
): RangeConflict[] {
  const conflicts: RangeConflict[] = []
  
  for (const period of existingPeriods) {
    const overlapStart = new Date(Math.max(newRange.start.getTime(), period.start.getTime()))
    const overlapEnd = new Date(Math.min(newRange.end.getTime(), period.end.getTime()))
    
    // Check if there's actually an overlap (overlap start before overlap end)
    if (overlapStart < overlapEnd) {
      const overlapDuration = overlapEnd.getTime() - overlapStart.getTime()
      
      conflicts.push({
        newRange,
        conflictingPeriod: period,
        overlapStart,
        overlapEnd,
        overlapDuration
      })
    }
  }
  
  return conflicts
}

/**
 * Checks if two time ranges overlap
 */
export function rangesOverlap(
  range1: { start: Date; end: Date },
  range2: { start: Date; end: Date }
): boolean {
  return range1.start < range2.end && range2.start < range1.end
}

/**
 * Merges adjacent periods of the same type (TRUE/FALSE)
 */
export function mergeAdjacentPeriods(periods: TimePeriod[]): TimePeriod[] {
  if (periods.length < 2) return [...periods]

  const sortedPeriods = [...periods].sort((a, b) => a.start.getTime() - b.start.getTime())
  const mergedPeriods: TimePeriod[] = []
  
  for (const currentPeriod of sortedPeriods) {
    let wasMerged = false
    
    if (mergedPeriods.length > 0) {
      const lastPeriod = mergedPeriods[mergedPeriods.length - 1]
      
      // Can merge if same type and adjacent/overlapping (within 1 minute tolerance)
      if (currentPeriod.isTruePeriod === lastPeriod.isTruePeriod) {
        const gap = currentPeriod.start.getTime() - lastPeriod.end.getTime()
        const tolerance = 60000 // 1 minute tolerance
        
        if (gap <= tolerance) {
          // Merge the periods
          const newStart = new Date(Math.min(currentPeriod.start.getTime(), lastPeriod.start.getTime()))
          const newEnd = new Date(Math.max(currentPeriod.end.getTime(), lastPeriod.end.getTime()))
          
          const mergedLabel = `${format(newStart, 'MMM d HH:mm')} - ${format(newEnd, 'HH:mm')}`
          
          mergedPeriods[mergedPeriods.length - 1] = {
            id: lastPeriod.id, // Keep the original ID
            start: newStart,
            end: newEnd,
            isTruePeriod: lastPeriod.isTruePeriod,
            label: mergedLabel
          }
          
          wasMerged = true
        }
      }
    }
    
    if (!wasMerged) {
      mergedPeriods.push({ ...currentPeriod })
    }
  }
  
  return mergedPeriods
}

/**
 * Resolves conflicts by trimming or removing overlapping periods
 */
export function resolveConflicts(
  newRange: { start: Date; end: Date; isTruePeriod: boolean; id?: string },
  existingPeriods: TimePeriod[],
  strategy: 'replace' | 'trim' | 'reject' = 'replace'
): { 
  resolvedPeriods: TimePeriod[]; 
  newPeriod: TimePeriod | null; 
  removedPeriods: TimePeriod[];
  modifiedPeriods: TimePeriod[];
} {
  const conflicts = detectRangeConflicts(newRange, existingPeriods)
  
  if (conflicts.length === 0) {
    // No conflicts, just add the new period
    const newPeriod: TimePeriod = {
      id: newRange.id || Date.now().toString(),
      start: newRange.start,
      end: newRange.end,
      isTruePeriod: newRange.isTruePeriod,
      label: `${format(newRange.start, 'MMM d HH:mm')} - ${format(newRange.end, 'HH:mm')}`
    }
    
    return {
      resolvedPeriods: [...existingPeriods, newPeriod],
      newPeriod,
      removedPeriods: [],
      modifiedPeriods: []
    }
  }
  
  if (strategy === 'reject') {
    return {
      resolvedPeriods: existingPeriods,
      newPeriod: null,
      removedPeriods: [],
      modifiedPeriods: []
    }
  }
  
  const removedPeriods: TimePeriod[] = []
  const modifiedPeriods: TimePeriod[] = []
  let resolvedPeriods = [...existingPeriods]
  
  if (strategy === 'replace') {
    // Remove all conflicting periods
    const conflictingIds = new Set(conflicts.map(c => c.conflictingPeriod.id))
    removedPeriods.push(...resolvedPeriods.filter(p => conflictingIds.has(p.id)))
    resolvedPeriods = resolvedPeriods.filter(p => !conflictingIds.has(p.id))
    
  } else if (strategy === 'trim') {
    // Trim conflicting periods to avoid overlap
    for (const conflict of conflicts) {
      const periodIndex = resolvedPeriods.findIndex(p => p.id === conflict.conflictingPeriod.id)
      if (periodIndex === -1) continue
      
      const existingPeriod = resolvedPeriods[periodIndex]
      
      // Determine how to trim
      if (newRange.start <= existingPeriod.start && newRange.end >= existingPeriod.end) {
        // New range completely contains existing period - remove it
        removedPeriods.push(existingPeriod)
        resolvedPeriods.splice(periodIndex, 1)
      } else if (newRange.start > existingPeriod.start && newRange.end < existingPeriod.end) {
        // New range is inside existing period - split it
        const firstPart: TimePeriod = {
          ...existingPeriod,
          id: `${existingPeriod.id}_1`,
          end: new Date(newRange.start.getTime() - 1000), // 1 second before
          label: `${format(existingPeriod.start, 'MMM d HH:mm')} - ${format(new Date(newRange.start.getTime() - 1000), 'HH:mm')}`
        }
        
        const secondPart: TimePeriod = {
          ...existingPeriod,
          id: `${existingPeriod.id}_2`,
          start: new Date(newRange.end.getTime() + 1000), // 1 second after
          label: `${format(new Date(newRange.end.getTime() + 1000), 'MMM d HH:mm')} - ${format(existingPeriod.end, 'HH:mm')}`
        }
        
        modifiedPeriods.push(firstPart, secondPart)
        resolvedPeriods[periodIndex] = firstPart
        resolvedPeriods.splice(periodIndex + 1, 0, secondPart)
        
      } else if (newRange.start <= existingPeriod.start) {
        // New range overlaps start of existing period - trim start
        const trimmedPeriod: TimePeriod = {
          ...existingPeriod,
          start: new Date(newRange.end.getTime() + 1000), // 1 second after
          label: `${format(new Date(newRange.end.getTime() + 1000), 'MMM d HH:mm')} - ${format(existingPeriod.end, 'HH:mm')}`
        }
        
        modifiedPeriods.push(trimmedPeriod)
        resolvedPeriods[periodIndex] = trimmedPeriod
        
      } else {
        // New range overlaps end of existing period - trim end
        const trimmedPeriod: TimePeriod = {
          ...existingPeriod,
          end: new Date(newRange.start.getTime() - 1000), // 1 second before
          label: `${format(existingPeriod.start, 'MMM d HH:mm')} - ${format(new Date(newRange.start.getTime() - 1000), 'HH:mm')}`
        }
        
        modifiedPeriods.push(trimmedPeriod)
        resolvedPeriods[periodIndex] = trimmedPeriod
      }
    }
  }
  
  // Add the new period
  const newPeriod: TimePeriod = {
    id: newRange.id || Date.now().toString(),
    start: newRange.start,
    end: newRange.end,
    isTruePeriod: newRange.isTruePeriod,
    label: `${format(newRange.start, 'MMM d HH:mm')} - ${format(newRange.end, 'HH:mm')}`
  }
  
  resolvedPeriods.push(newPeriod)
  
  return {
    resolvedPeriods: mergeAdjacentPeriods(resolvedPeriods),
    newPeriod,
    removedPeriods,
    modifiedPeriods
  }
}

/**
 * Validates that periods don't overlap
 */
export function validateNonOverlapping(periods: TimePeriod[]): { isValid: boolean; conflicts: RangeConflict[] } {
  const allConflicts: RangeConflict[] = []
  
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      const period1 = periods[i]
      const period2 = periods[j]
      
      if (rangesOverlap(period1, period2)) {
        const overlapStart = new Date(Math.max(period1.start.getTime(), period2.start.getTime()))
        const overlapEnd = new Date(Math.min(period1.end.getTime(), period2.end.getTime()))
        
        allConflicts.push({
          newRange: period1,
          conflictingPeriod: period2,
          overlapStart,
          overlapEnd,
          overlapDuration: overlapEnd.getTime() - overlapStart.getTime()
        })
      }
    }
  }
  
  return {
    isValid: allConflicts.length === 0,
    conflicts: allConflicts
  }
}

/**
 * Snaps a time to the nearest interval (default 15 minutes)
 */
export function snapToInterval(date: Date, intervalMinutes: number = 15): Date {
  const snapped = new Date(date)
  const minutes = snapped.getMinutes()
  const snappedMinutes = Math.round(minutes / intervalMinutes) * intervalMinutes
  
  snapped.setMinutes(snappedMinutes, 0, 0) // Reset seconds and milliseconds
  
  return snapped
}