import type {
  EntityScope,
  HAEntity,
  HAEntityMeta,
  HARegistries
} from '../types/homeAssistant'

export const EMPTY_SCOPE: EntityScope = { areas: [], floors: [], labels: [], domains: [] }

/**
 * Attach registry metadata (name, area, floor, labels, hidden/disabled,
 * entity_category) to each state object. Area is the entity's own area, or
 * its device's area if the entity has none (same rule as the HA frontend).
 */
export function enrichEntities(states: HAEntity[], registries: HARegistries): HAEntity[] {
  const entityReg = new Map(registries.entities.map(e => [e.entity_id, e]))
  const devices = new Map(registries.devices.map(d => [d.id, d]))
  const areas = new Map(registries.areas.map(a => [a.area_id, a]))
  const floors = new Map(registries.floors.map(f => [f.floor_id, f]))

  return states.map(state => {
    const reg = entityReg.get(state.entity_id)
    const device = reg?.device_id ? devices.get(reg.device_id) : undefined
    const areaId = reg?.area_id ?? device?.area_id ?? null
    const area = areaId ? areas.get(areaId) : undefined
    const floorId = area?.floor_id ?? null
    const floor = floorId ? floors.get(floorId) : undefined

    const meta: HAEntityMeta = {
      name: reg?.name || state.attributes?.friendly_name || reg?.original_name || undefined,
      area_id: areaId,
      area_name: area?.name ?? null,
      floor_id: floorId,
      floor_name: floor?.name ?? null,
      labels: reg?.labels ?? [],
      device_id: reg?.device_id ?? null,
      platform: reg?.platform,
      hidden: !!reg?.hidden_by,
      disabled: !!reg?.disabled_by,
      entity_category: reg?.entity_category ?? null
    }
    return { ...state, meta }
  })
}

export const entityDomain = (entityId: string) => entityId.split('.')[0]

export function isScopeEmpty(scope: EntityScope): boolean {
  return !scope.areas.length && !scope.floors.length && !scope.labels.length && !scope.domains.length
}

/**
 * AND across filter categories, OR within a category.
 * An empty category does not restrict.
 */
export function matchesScope(entity: HAEntity, scope: EntityScope): boolean {
  if (scope.domains.length && !scope.domains.includes(entityDomain(entity.entity_id))) return false
  const meta = entity.meta
  if (scope.areas.length && !(meta?.area_id && scope.areas.includes(meta.area_id))) return false
  if (scope.floors.length && !(meta?.floor_id && scope.floors.includes(meta.floor_id))) return false
  if (scope.labels.length && !(meta?.labels ?? []).some(l => scope.labels.includes(l))) return false
  return true
}

export function filterByScope(entities: HAEntity[], scope: EntityScope): HAEntity[] {
  if (isScopeEmpty(scope)) return entities
  return entities.filter(e => matchesScope(e, scope))
}
