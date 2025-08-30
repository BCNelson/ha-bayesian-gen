import { ref, computed, onUnmounted } from 'vue'
import { HomeAssistantAPI } from '../services/homeAssistant'
import { BayesianCalculator } from '../services/bayesianCalculator'
import { WorkerPool } from '../services/workerPool'
import type { HAConnection, HAEntity } from '../types/homeAssistant'
import type { TimePeriod, EntityProbability, BayesianSensorConfig } from '../types/bayesian'

export const useBayesianAnalysis = () => {
  const haConnection = ref<HAConnection | null>(null)
  const haApi = ref<HomeAssistantAPI | null>(null)
  const isConnected = ref(false)
  const connectionError = ref<string | null>(null)
  
  const entities = ref<HAEntity[]>([])
  const periods = ref<TimePeriod[]>([])
  const analyzedEntities = ref<EntityProbability[]>([])
  const generatedConfig = ref<BayesianSensorConfig | null>(null)
  
  const isAnalyzing = ref(false)
  const analysisError = ref<string | null>(null)
  const analysisProgress = ref({ current: 0, total: 0, currentEntity: '' })
  
  const calculator = new BayesianCalculator()
  const workerPool = new WorkerPool()
  
  onUnmounted(() => {
    workerPool.terminate()
  })
  
  const canAnalyze = computed(() => {
    const truePeriods = periods.value.filter(p => p.isTruePeriod)
    const falsePeriods = periods.value.filter(p => !p.isTruePeriod)
    return isConnected.value && truePeriods.length > 0 && falsePeriods.length > 0
  })
  
  const connectToHA = async (connection: HAConnection) => {
    try {
      connectionError.value = null
      haConnection.value = connection
      haApi.value = new HomeAssistantAPI(connection)
      
      const connected = await haApi.value.testConnection()
      if (!connected) {
        throw new Error('Failed to connect to Home Assistant')
      }
      
      const fetchedEntities = await haApi.value.getStates()
      entities.value = fetchedEntities
      isConnected.value = true
      
      return true
    } catch (error) {
      connectionError.value = error instanceof Error ? error.message : 'Connection failed'
      isConnected.value = false
      haApi.value = null
      return false
    }
  }
  
  const updatePeriods = (newPeriods: TimePeriod[]) => {
    periods.value = newPeriods
    if (analyzedEntities.value.length > 0 && canAnalyze.value) {
      analyzeEntities()
    }
  }
  
  const analyzeEntities = async (selectedEntityIds?: string[]) => {
    if (!canAnalyze.value || !haApi.value) return
    
    isAnalyzing.value = true
    analysisError.value = null
    
    try {
      const allPeriods = [...periods.value]
      const earliestStart = new Date(Math.min(...allPeriods.map(p => p.start.getTime())))
      const latestEnd = new Date(Math.max(...allPeriods.map(p => p.end.getTime())))
      
      let relevantEntityIds: string[]
      
      if (selectedEntityIds && selectedEntityIds.length > 0) {
        relevantEntityIds = selectedEntityIds
      } else {
        relevantEntityIds = entities.value
          .filter(entity => {
            const domain = entity.entity_id.split('.')[0]
            return !['automation', 'script', 'scene', 'group', 'zone', 'update', 'button', 'persistent_notification'].includes(domain) &&
                   entity.state !== 'unavailable' &&
                   entity.state !== 'unknown' &&
                   entity.state !== ''
          })
          .map(entity => entity.entity_id)
      }
      
      const allProbabilities: EntityProbability[] = []
      analysisProgress.value = { current: 0, total: relevantEntityIds.length, currentEntity: '' }
      
      const entityQueue = [...relevantEntityIds]
      const maxConcurrentFetches = 2
      let activeFetches = 0
      let completedCount = 0
      
      await new Promise<void>((resolve) => {
        const processSingleEntity = async (entityId: string) => {
          try {
            analysisProgress.value = { 
              current: completedCount, 
              total: relevantEntityIds.length, 
              currentEntity: `Fetching: ${entityId}` 
            }
            
            const rawEntityHistory = await haApi.value!.getHistory(
              earliestStart,
              latestEnd,
              [entityId]
            )
            
            const entityHistory = JSON.parse(JSON.stringify(rawEntityHistory))
            
            analysisProgress.value = { 
              current: completedCount, 
              total: relevantEntityIds.length, 
              currentEntity: `Analyzing: ${entityId}` 
            }
            
            const serializedPeriods = periods.value.map(p => ({
              ...p,
              start: p.start.toISOString(),
              end: p.end.toISOString()
            }))
            const entityProbabilities = await workerPool.analyzeEntity(
              entityHistory, 
              serializedPeriods
            )
            
            if (Array.isArray(entityProbabilities)) {
              allProbabilities.push(...entityProbabilities)
            }
            
            completedCount++
            analysisProgress.value = { 
              current: completedCount, 
              total: relevantEntityIds.length, 
              currentEntity: entityId 
            }
            
          } catch (error) {
            console.warn(`Failed to process entity ${entityId}:`, error)
            completedCount++
          } finally {
            activeFetches--
            processNextEntity()
          }
        }
        
        const processNextEntity = () => {
          if (entityQueue.length === 0 && activeFetches === 0) {
            resolve()
            return
          }
          
          while (activeFetches < maxConcurrentFetches && entityQueue.length > 0) {
            const entityId = entityQueue.shift()!
            activeFetches++
            
            processSingleEntity(entityId).catch(error => {
              console.error(`Error processing entity ${entityId}:`, error)
              activeFetches--
              completedCount++
              processNextEntity()
            })
          }
        }
        
        processNextEntity()
      })
      
      const sortedProbabilities = allProbabilities.sort((a, b) => b.discriminationPower - a.discriminationPower)
      analyzedEntities.value = sortedProbabilities
      
      if (sortedProbabilities.length > 0) {
        const config = calculator.generateBayesianConfig(
          sortedProbabilities,
          'Bayesian Sensor',
          10
        )
        generatedConfig.value = config
      }
      
    } catch (error) {
      analysisError.value = error instanceof Error ? error.message : 'Analysis failed'
    } finally {
      isAnalyzing.value = false
    }
  }
  
  const updateGeneratedConfig = (config: BayesianSensorConfig) => {
    generatedConfig.value = config
  }
  
  const resetAnalysis = () => {
    analyzedEntities.value = []
    generatedConfig.value = null
    analysisError.value = null
    analysisProgress.value = { current: 0, total: 0, currentEntity: '' }
  }
  
  return {
    haConnection,
    isConnected,
    connectionError,
    entities,
    periods,
    analyzedEntities,
    generatedConfig,
    isAnalyzing,
    analysisError,
    analysisProgress,
    canAnalyze,
    calculator,
    connectToHA,
    updatePeriods,
    analyzeEntities,
    updateGeneratedConfig,
    resetAnalysis
  }
}