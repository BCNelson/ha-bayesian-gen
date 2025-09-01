import type { HAHistoryEntry } from '../types/homeAssistant'

export interface EntityBufferMetadata {
  entityId: string
  pointCount: number
  startTime: number
  endTime: number
  stateMap: Record<string, number>
}

export interface TransferableEntityData {
  buffer: ArrayBuffer
  metadata: EntityBufferMetadata
}

/**
 * StreamingEntityBuffer - Efficiently stores and transfers entity historical data
 * 
 * Benefits:
 * - 25x memory reduction vs JS objects
 * - Zero-copy transfers to workers
 * - Incremental data streaming during fetch
 * - Direct binary access for fast processing
 */
export class StreamingEntityBuffer {
  private entityBuffers = new Map<string, {
    buffer: ArrayBuffer
    view: DataView
    writeOffset: number
    capacity: number
    stateMap: Map<string, number>
    startTime: number
    endTime: number
  }>()

  /**
   * Initialize buffer for an entity with estimated capacity
   */
  initializeEntity(entityId: string, estimatedPoints: number = 2000): void {
    const capacity = estimatedPoints * 8 // 8 bytes per point (4 timestamp + 4 stateId)
    const buffer = new ArrayBuffer(capacity)

    this.entityBuffers.set(entityId, {
      buffer,
      view: new DataView(buffer),
      writeOffset: 0,
      capacity,
      stateMap: new Map(),
      startTime: 0,
      endTime: 0
    })
  }

  /**
   * Stream data points as they arrive during fetch
   */
  appendDataPoint(entityId: string, timestamp: Date, state: string): void {
    const entityBuffer = this.entityBuffers.get(entityId)
    if (!entityBuffer) {
      // Auto-initialize if not done
      this.initializeEntity(entityId)
      return this.appendDataPoint(entityId, timestamp, state)
    }

    // Encode state to numeric ID for compact storage
    if (!entityBuffer.stateMap.has(state)) {
      entityBuffer.stateMap.set(state, entityBuffer.stateMap.size)
    }
    const stateId = entityBuffer.stateMap.get(state)!

    // Expand buffer if needed (90% full)
    if (entityBuffer.writeOffset >= entityBuffer.capacity * 0.9) {
      this.expandBuffer(entityId)
    }

    const timestampMs = timestamp.getTime()
    
    // Update time range
    if (entityBuffer.startTime === 0) {
      entityBuffer.startTime = timestampMs
    }
    entityBuffer.endTime = timestampMs

    // Write timestamp (as seconds to save space) and state ID
    entityBuffer.view.setUint32(entityBuffer.writeOffset, Math.floor(timestampMs / 1000), true)
    entityBuffer.view.setUint32(entityBuffer.writeOffset + 4, stateId, true)
    entityBuffer.writeOffset += 8
  }

  /**
   * Bulk load historical data for an entity
   */
  loadEntityHistory(entityId: string, history: HAHistoryEntry[]): void {
    if (history.length === 0) return

    // Initialize with exact capacity needed
    this.initializeEntity(entityId, history.length)

    // Stream all data points
    for (const entry of history) {
      this.appendDataPoint(entityId, new Date(entry.last_changed), entry.state)
    }
  }

  /**
   * Get transferable buffer for worker (zero-copy)
   */
  getTransferableBuffer(entityId: string): TransferableEntityData | null {
    const entityBuffer = this.entityBuffers.get(entityId)
    if (!entityBuffer || entityBuffer.writeOffset === 0) return null

    // Create trimmed buffer with only used data
    const usedSize = entityBuffer.writeOffset
    const trimmedBuffer = entityBuffer.buffer.slice(0, usedSize)

    const metadata: EntityBufferMetadata = {
      entityId,
      pointCount: usedSize / 8,
      startTime: entityBuffer.startTime,
      endTime: entityBuffer.endTime,
      stateMap: Object.fromEntries(entityBuffer.stateMap)
    }

    return {
      buffer: trimmedBuffer,
      metadata
    }
  }

  /**
   * Get transferable buffers for multiple entities
   */
  getTransferableBuffers(entityIds: string[]): {
    buffers: ArrayBuffer[]
    metadata: EntityBufferMetadata[]
  } {
    const buffers: ArrayBuffer[] = []
    const metadata: EntityBufferMetadata[] = []

    for (const entityId of entityIds) {
      const transferable = this.getTransferableBuffer(entityId)
      if (transferable) {
        buffers.push(transferable.buffer)
        metadata.push(transferable.metadata)
      }
    }

    return { buffers, metadata }
  }

  /**
   * Check if entity has data
   */
  hasEntity(entityId: string): boolean {
    const buffer = this.entityBuffers.get(entityId)
    return buffer !== undefined && buffer.writeOffset > 0
  }

  /**
   * Get entity data stats
   */
  getEntityStats(entityId: string): { pointCount: number, timeSpan: number } | null {
    const buffer = this.entityBuffers.get(entityId)
    if (!buffer || buffer.writeOffset === 0) return null

    return {
      pointCount: buffer.writeOffset / 8,
      timeSpan: buffer.endTime - buffer.startTime
    }
  }

  /**
   * Get memory usage summary
   */
  getMemoryUsage(): {
    totalEntities: number
    totalPoints: number
    totalMemoryBytes: number
    averageCompressionRatio: number
  } {
    let totalPoints = 0
    let totalMemory = 0

    for (const [_, buffer] of this.entityBuffers) {
      const points = buffer.writeOffset / 8
      totalPoints += points
      totalMemory += buffer.writeOffset
    }

    // Estimate compression vs JS objects (rough calculation)
    const estimatedJSMemory = totalPoints * 200 // ~200 bytes per JS object
    const compressionRatio = estimatedJSMemory > 0 ? totalMemory / estimatedJSMemory : 1

    return {
      totalEntities: this.entityBuffers.size,
      totalPoints,
      totalMemoryBytes: totalMemory,
      averageCompressionRatio: compressionRatio
    }
  }

  /**
   * Clear entity data
   */
  clearEntity(entityId: string): void {
    this.entityBuffers.delete(entityId)
  }

  /**
   * Clear all data
   */
  clearAll(): void {
    this.entityBuffers.clear()
  }

  /**
   * Private: Expand buffer capacity when needed
   */
  private expandBuffer(entityId: string): void {
    const entityBuffer = this.entityBuffers.get(entityId)
    if (!entityBuffer) return

    const oldCapacity = entityBuffer.capacity
    const newCapacity = oldCapacity * 2
    const newBuffer = new ArrayBuffer(newCapacity)
    const newView = new DataView(newBuffer)

    // Copy existing data
    const oldView = new Uint8Array(entityBuffer.buffer, 0, entityBuffer.writeOffset)
    const newViewUint8 = new Uint8Array(newBuffer)
    newViewUint8.set(oldView)

    // Update buffer reference
    entityBuffer.buffer = newBuffer
    entityBuffer.view = newView
    entityBuffer.capacity = newCapacity

    console.log(`Expanded buffer for ${entityId}: ${oldCapacity} → ${newCapacity} bytes`)
  }
}