import { format } from 'date-fns'

/**
 * Format date for display
 */
export const formatDate = (date: Date): string => {
  return format(date, 'MMM dd HH:mm')
}

/**
 * Format time duration
 */
export const formatDuration = (start: Date, end: Date): string => {
  const diff = end.getTime() - start.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

/**
 * Format percentage
 */
export const formatPercentage = (value: number, decimals: number = 1): string => {
  return `${(value * 100).toFixed(decimals)}%`
}

/**
 * Format number with units
 */
export const formatNumber = (value: number, decimals: number = 1): string => {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(decimals)}M`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(decimals)}K`
  }
  return value.toFixed(decimals)
}

/**
 * Format entity ID for display
 */
export const formatEntityId = (entityId: string): string => {
  return entityId.replace(/_/g, ' ').replace(/\./g, ' › ')
}

/**
 * Get entity domain from entity ID
 */
export const getEntityDomain = (entityId: string): string => {
  return entityId.split('.')[0]
}

/**
 * Format bytes to human readable
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}