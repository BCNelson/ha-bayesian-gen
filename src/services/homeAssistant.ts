import axios from 'axios'
import type { AxiosInstance } from 'axios'
import type { HAConnection, HAEntity, HAHistoryResponse } from '../types/homeAssistant'

export class HomeAssistantAPI {
  private client: AxiosInstance

  constructor(connection: HAConnection) {
    
    this.client = axios.create({
      baseURL: connection.url.replace(/\/$/, ''),
      headers: {
        'Authorization': `Bearer ${connection.token}`,
        'Content-Type': 'application/json'
      }
    })
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/api/')
      return true
    } catch (error) {
      console.error('Connection test failed:', error)
      return false
    }
  }

  async getStates(): Promise<HAEntity[]> {
    try {
      const response = await this.client.get<HAEntity[]>('/api/states')
      return response.data
    } catch (error) {
      console.error('Failed to fetch states:', error)
      throw new Error('Failed to fetch entity states')
    }
  }

  async getHistory(
    startTime: Date,
    endTime?: Date,
    entityIds?: string[]
  ): Promise<HAHistoryResponse> {
    try {
      const params: any = {}
      
      if (endTime) {
        params.end_time = endTime.toISOString()
      }
      
      if (entityIds && entityIds.length > 0) {
        params.filter_entity_id = entityIds.join(',')
      }

      params.significant_changes_only = false
      
      const startTimestamp = startTime.toISOString()
      const response = await this.client.get(`/api/history/period/${startTimestamp}`, { params })
      
      const historyArray = response.data as any[][]
      const result: HAHistoryResponse = {}
      
      historyArray.forEach(entityHistory => {
        if (entityHistory.length > 0) {
          const entityId = entityHistory[0].entity_id
          result[entityId] = entityHistory
        }
      })
      
      return result
    } catch (error) {
      console.error('Failed to fetch history:', error)
      throw new Error('Failed to fetch entity history')
    }
  }

  async getEntityHistory(
    entityId: string,
    startTime: Date,
    endTime?: Date
  ): Promise<HAHistoryResponse> {
    return this.getHistory(startTime, endTime, [entityId])
  }

  async getConfig(): Promise<any> {
    try {
      const response = await this.client.get('/api/config')
      return response.data
    } catch (error) {
      console.error('Failed to fetch config:', error)
      throw new Error('Failed to fetch Home Assistant configuration')
    }
  }
}