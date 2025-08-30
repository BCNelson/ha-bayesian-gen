export interface HAConnection {
  url: string
  token: string
}

export interface HAEntity {
  entity_id: string
  state: string
  last_changed: string
  last_updated: string
  attributes: Record<string, any>
}

export interface HAHistoryEntry {
  entity_id: string
  state: string
  last_changed: string
  last_updated: string
  attributes: Record<string, any>
}

export interface HAHistoryResponse {
  [entityId: string]: HAHistoryEntry[]
}

export interface HAStateChange {
  timestamp: Date
  state: string
  attributes?: Record<string, any>
}