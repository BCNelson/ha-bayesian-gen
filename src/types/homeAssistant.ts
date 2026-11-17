/**
 * How the app authenticates against Home Assistant.
 * - `oauth`: HA's own login page (IndieAuth-style OAuth2; refresh tokens are stored locally)
 * - `token`: a long-lived access token created on the HA profile page
 */
export type HAAuthMethod = 'oauth' | 'token'

export interface HAConnection {
  url: string
  method: HAAuthMethod
  /** Only used when method === 'token' */
  token?: string
  /** Persist credentials so the app reconnects automatically on next load */
  remember?: boolean
}

/** Registry-derived metadata for an entity (all optional: registries may be unavailable). */
export interface HAEntityMeta {
  /** Display name: registry name > friendly_name attribute > original_name */
  name?: string
  /** Effective area: entity's own area, else its device's area */
  area_id?: string | null
  area_name?: string | null
  floor_id?: string | null
  floor_name?: string | null
  labels?: string[]
  device_id?: string | null
  platform?: string
  hidden?: boolean
  disabled?: boolean
  entity_category?: 'config' | 'diagnostic' | null
}

export interface HAEntity {
  entity_id: string
  state: string
  last_changed: string
  last_updated: string
  attributes: Record<string, any>
  meta?: HAEntityMeta
}

export interface HAHistoryEntry {
  entity_id: string
  state: string
  last_changed: string
  last_updated: string
  attributes: Record<string, any>
  /** True for rows synthesized from long-term statistics (hourly means), not real state changes */
  synthetic?: boolean
}

export interface HAHistoryResponse {
  [entityId: string]: HAHistoryEntry[]
}

export interface HAStateChange {
  timestamp: Date
  state: string
  attributes?: Record<string, any>
}

export interface HAHistoryState {
  entity_id: string
  state: string
  last_changed: string
  last_updated: string
  attributes: Record<string, any>
}

/* ---------- Registry shapes (subset of fields we use) ---------- */

export interface HAEntityRegistryEntry {
  entity_id: string
  name: string | null
  original_name?: string | null
  device_id: string | null
  area_id: string | null
  labels: string[]
  platform: string
  hidden_by: string | null
  disabled_by: string | null
  entity_category: 'config' | 'diagnostic' | null
}

export interface HADeviceRegistryEntry {
  id: string
  name: string | null
  name_by_user: string | null
  area_id: string | null
  labels?: string[]
}

export interface HAAreaRegistryEntry {
  area_id: string
  name: string
  floor_id?: string | null
  labels?: string[]
}

export interface HAFloorRegistryEntry {
  floor_id: string
  name: string
  level?: number | null
}

export interface HALabelRegistryEntry {
  label_id: string
  name: string
  color?: string | null
}

export interface HARegistries {
  entities: HAEntityRegistryEntry[]
  devices: HADeviceRegistryEntry[]
  areas: HAAreaRegistryEntry[]
  floors: HAFloorRegistryEntry[]
  labels: HALabelRegistryEntry[]
}

/** User-chosen subset of entities to analyze. Empty arrays mean "no restriction". */
export interface EntityScope {
  areas: string[]
  floors: string[]
  labels: string[]
  domains: string[]
}

export interface ScopeOption {
  label: string
  value: string
}

export interface EntityScopeOptions {
  areas: ScopeOption[]
  floors: ScopeOption[]
  labels: ScopeOption[]
  domains: ScopeOption[]
}
