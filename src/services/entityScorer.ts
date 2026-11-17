import type { HAEntity } from '../types/homeAssistant'

export interface EntityScore {
  entityId: string
  score: number
  reasons: string[]
}

const EXCLUDED_DOMAINS = new Set([
  'automation', 'script', 'scene', 'group', 'zone',
  'update', 'button', 'input_button', 'event', 'image', 'persistent_notification', 'tts', 'stt', 'conversation'
])

export class EntityScorer {
  private readonly domainWeights: Record<string, number> = {
    binary_sensor: 100,
    switch: 90,
    light: 85,
    input_boolean: 80,
    sensor: 70,
    cover: 65,
    lock: 60,
    climate: 55,
    fan: 50,
    media_player: 45,
    device_tracker: 40,
    person: 35,
    vacuum: 30,
    water_heater: 25,
    humidifier: 20,
    number: 15,
    input_number: 10,
    select: 5,
    input_select: 5,
    input_text: 2,
    text: 2
  }

  private readonly stateTypeWeights: Record<string, number> = {
    boolean: 50,
    numeric: 30,
    enumerated: 20,
    text: 5
  }

  scoreEntities(entities: HAEntity[]): EntityScore[] {
    return entities.map(entity => this.scoreEntity(entity))
      .sort((a, b) => b.score - a.score)
  }

  scoreEntity(entity: HAEntity): EntityScore {
    const reasons: string[] = []
    let score = 0

    const domain = entity.entity_id.split('.')[0]
    const domainScore = this.getDomainScore(domain)
    score += domainScore
    if (domainScore > 0) {
      reasons.push(`Domain ${domain}: +${domainScore}`)
    }

    const stateTypeScore = this.getStateTypeScore(entity)
    score += stateTypeScore
    if (stateTypeScore > 0) {
      reasons.push(`State type: +${stateTypeScore}`)
    }

    const changeFrequencyScore = this.getChangeFrequencyScore(entity)
    score += changeFrequencyScore
    if (changeFrequencyScore > 0) {
      reasons.push(`Recent activity: +${changeFrequencyScore}`)
    }

    const metadataScore = this.getMetadataScore(entity)
    score += metadataScore
    if (metadataScore > 0) {
      reasons.push(`Device class / area: +${metadataScore}`)
    }

    const availabilityPenalty = this.getAvailabilityPenalty(entity)
    score += availabilityPenalty
    if (availabilityPenalty < 0) {
      reasons.push(`Availability issues: ${availabilityPenalty}`)
    }

    return {
      entityId: entity.entity_id,
      score: score,
      reasons
    }
  }

  private getDomainScore(domain: string): number {
    return this.domainWeights[domain] || 0
  }

  private getStateTypeScore(entity: HAEntity): number {
    const state = entity.state.toLowerCase()
    
    if (state === 'on' || state === 'off' || state === 'true' || state === 'false' || 
        state === 'open' || state === 'closed' || state === 'locked' || state === 'unlocked' ||
        state === 'home' || state === 'not_home' || state === 'detected' || state === 'clear') {
      return this.stateTypeWeights.boolean
    }
    
    if (!isNaN(parseFloat(state))) {
      return this.stateTypeWeights.numeric
    }
    
    const domain = entity.entity_id.split('.')[0]
    if (domain === 'select' || domain === 'input_select' || 
        ['idle', 'playing', 'paused', 'heat', 'cool', 'auto', 'off'].includes(state)) {
      return this.stateTypeWeights.enumerated
    }
    
    return this.stateTypeWeights.text
  }

  private getChangeFrequencyScore(entity: HAEntity): number {
    if (!entity.last_changed) return 0
    
    const lastChanged = new Date(entity.last_changed)
    const now = new Date()
    const hoursSinceChange = (now.getTime() - lastChanged.getTime()) / (1000 * 60 * 60)
    
    if (hoursSinceChange < 1) return 30
    if (hoursSinceChange < 6) return 20
    if (hoursSinceChange < 24) return 10
    if (hoursSinceChange < 72) return 5
    
    return 0
  }

  /** Small bonus for entities with a device_class or an assigned area (registry). */
  private getMetadataScore(entity: HAEntity): number {
    let score = 0
    if (entity.attributes?.device_class) score += 5
    if (entity.meta?.area_id) score += 5
    return score
  }

  private getAvailabilityPenalty(entity: HAEntity): number {
    const state = entity.state.toLowerCase()
    
    if (state === 'unavailable') return -100
    if (state === 'unknown') return -80
    if (state === '') return -50
    
    if (entity.attributes?.restored === true) return -20
    
    return 0
  }

  /**
   * Default candidate filter: drops entities that are disabled, hidden, or
   * config/diagnostic (entity_category, from the entity registry), helper/
   * control domains, and entities with no usable current state.
   */
  isRelevantEntity(entity: HAEntity): boolean {
    const meta = entity.meta
    if (meta?.disabled || meta?.hidden) return false
    if (meta?.entity_category === 'config' || meta?.entity_category === 'diagnostic') return false
    const domain = entity.entity_id.split('.')[0]
    if (EXCLUDED_DOMAINS.has(domain)) return false
    return entity.state !== 'unavailable' && entity.state !== 'unknown' && entity.state !== ''
  }

  filterRelevantEntities(entities: HAEntity[]): HAEntity[] {
    return entities.filter(e => this.isRelevantEntity(e))
  }

  filterAndSortEntities(entities: HAEntity[], selectedEntityIds?: string[]): string[] {
    if (selectedEntityIds && selectedEntityIds.length > 0) {
      const selectedSet = new Set(selectedEntityIds)
      const filtered = entities.filter(e => selectedSet.has(e.entity_id))
      const scores = this.scoreEntities(filtered)
      return scores.map(s => s.entityId)
    }

    const relevantEntities = this.filterRelevantEntities(entities)

    const scores = this.scoreEntities(relevantEntities)
    return scores.map(s => s.entityId)
  }

  getScoresForEntities(entities: HAEntity[]): Map<string, EntityScore> {
    const scores = this.scoreEntities(entities)
    return new Map(scores.map(s => [s.entityId, s]))
  }
}