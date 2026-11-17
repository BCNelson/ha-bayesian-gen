/**
 * Small, failure-tolerant wrapper around localStorage for persisting the
 * user's working session (periods, generator settings, selections, theme).
 * Every access is wrapped in try/catch: storage can be disabled, full, or
 * contain stale/corrupt JSON.
 */

export const STORAGE_KEYS = {
  /** Named period configurations (owned by ConfigurationManager) */
  periodConfigs: 'ha_bayesian_configs',
  lastPeriodConfig: 'ha_bayesian_last_config',
  entityGenerator: 'ha_bayesian_gen_entity',
  scheduleGenerator: 'ha_bayesian_gen_schedule',
  periodMode: 'ha_bayesian_period_mode',
  selectedEntities: 'ha_bayesian_selected_entities',
  theme: 'ha_bayesian_theme'
} as const

/** Keys cleared by "Reset session" (credentials and theme are kept). */
const SESSION_KEYS = [
  STORAGE_KEYS.entityGenerator,
  STORAGE_KEYS.scheduleGenerator,
  STORAGE_KEYS.periodMode,
  STORAGE_KEYS.selectedEntities
]

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function readString(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeString(key: string, value: string): void {
  try {
    storage()?.setItem(key, value)
  } catch (e) {
    console.warn(`Failed to persist ${key}:`, e)
  }
}

export function removeKey(key: string): void {
  try {
    storage()?.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  const raw = readString(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Like readJSON but shallow-merges onto defaults so new fields get sane values. */
export function readSettings<T extends object>(key: string, defaults: T): T {
  const stored = readJSON<Partial<T> | null>(key, null)
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...defaults }
  return { ...defaults, ...stored }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    writeString(key, JSON.stringify(value))
  } catch (e) {
    console.warn(`Failed to serialise ${key}:`, e)
  }
}

/** Stable key for a selected observation (entity + state). */
export const selectionKey = (entityId: string, state: string) => `${entityId}|${state}`

/**
 * Clear the working session: generator settings, selections and the periods
 * of the active period configuration. Saved named configurations other than
 * the active one and HA credentials are kept.
 */
export function resetSession(): void {
  SESSION_KEYS.forEach(removeKey)
  const active = readString(STORAGE_KEYS.lastPeriodConfig)
  const configs = readJSON<Array<{ name: string; periods: unknown[] }>>(STORAGE_KEYS.periodConfigs, [])
  if (Array.isArray(configs) && active) {
    writeJSON(
      STORAGE_KEYS.periodConfigs,
      configs.map(c => (c && c.name === active ? { ...c, periods: [], lastModified: new Date().toISOString() } : c))
    )
  }
}
