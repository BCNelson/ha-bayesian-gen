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
  const entityStatusMap = ref<Map<string, { status: 'queued' | 'fetching' | 'fetched' | 'analyzing' | 'completed' | 'error', message?: string }>>(new Map())
  
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
    entityStatusMap.value.clear()
    analyzedEntities.value = [] // Clear previous results
    
    // Set up progress callback for worker pool
    workerPool.setProgressCallback((entityId: string, status: string, message?: string) => {
      if (status === 'analyzing') {
        entityStatusMap.value.set(entityId, { status: 'analyzing', message })
      } else if (status === 'completed') {
        entityStatusMap.value.set(entityId, { status: 'completed', message })
      }
    })
    
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
      
      analysisProgress.value = { current: 0, total: relevantEntityIds.length, currentEntity: '' }
      
      // Initialize all entities as queued
      relevantEntityIds.forEach(entityId => {
        entityStatusMap.value.set(entityId, { status: 'queued' })
      })
      
      const fetchQueue = [...relevantEntityIds]
      const analysisQueue: { entityId: string; history: any; periods: any }[] = []
      const maxConcurrentFetches = 2
      let activeFetches = 0
      let activeAnalyses = 0
      let completedCount = 0
      let fetchedCount = 0
      
      const serializedPeriods = periods.value.map(p => ({
        ...p,
        start: p.start.toISOString(),
        end: p.end.toISOString()
      }))
      
      await new Promise<void>((resolve) => {
        // Check if we're done
        const checkCompletion = () => {
          if (fetchQueue.length === 0 && analysisQueue.length === 0 && 
              activeFetches === 0 && activeAnalyses === 0) {
            resolve()
          }
        }
        
        // Fetch entities from Home Assistant
        const fetchEntity = async (entityId: string) => {
          try {
            // Update status to fetching
            entityStatusMap.value.set(entityId, { status: 'fetching', message: 'Fetching history...' })
            
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
            
            fetchedCount++
            
            // Mark as fetched (waiting for analysis)
            entityStatusMap.value.set(entityId, { status: 'fetched', message: 'Waiting for analysis...' })
            
            // Add to analysis queue
            analysisQueue.push({
              entityId,
              history: entityHistory,
              periods: serializedPeriods
            })
            
            // Trigger analysis processing
            processAnalysisQueue()
            
          } catch (error) {
            console.warn(`Failed to fetch entity ${entityId}:`, error)
            entityStatusMap.value.set(entityId, { status: 'error', message: `Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}` })
            completedCount++
          } finally {
            activeFetches--
            processFetchQueue()
          }
        }
        
        // Analyze entities using workers
        const analyzeEntity = async (entityId: string, history: any, periods: any) => {
          try {
            // Update status to analyzing
            entityStatusMap.value.set(entityId, { status: 'analyzing', message: 'Analyzing states...' })
            
            analysisProgress.value = { 
              current: completedCount, 
              total: relevantEntityIds.length, 
              currentEntity: `Analyzing: ${entityId}` 
            }
            
            const entityProbabilities = await workerPool.analyzeEntity(history, periods)
            
            if (Array.isArray(entityProbabilities)) {
              // Add results immediately to displayed results
              analyzedEntities.value.push(...entityProbabilities)
              // Sort by discrimination power to maintain order
              analyzedEntities.value.sort((a, b) => b.discriminationPower - a.discriminationPower)
            }
            
            completedCount++
            analysisProgress.value = { 
              current: completedCount, 
              total: relevantEntityIds.length, 
              currentEntity: entityId 
            }
            
            // Mark as completed
            entityStatusMap.value.set(entityId, { status: 'completed', message: 'Analysis complete' })
            
          } catch (error) {
            console.warn(`Failed to analyze entity ${entityId}:`, error)
            entityStatusMap.value.set(entityId, { status: 'error', message: `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}` })
            completedCount++
          } finally {
            activeAnalyses--
            processAnalysisQueue()
            checkCompletion()
          }
        }
        
        // Process fetch queue
        const processFetchQueue = () => {
          while (activeFetches < maxConcurrentFetches && fetchQueue.length > 0) {
            const entityId = fetchQueue.shift()!
            activeFetches++
            fetchEntity(entityId)
          }
          checkCompletion()
        }
        
        // Process analysis queue (send to workers)
        const processAnalysisQueue = () => {
          // Process as many as we have workers available
          while (analysisQueue.length > 0 && activeAnalyses < 8) { // Assuming max 8 workers
            const task = analysisQueue.shift()!
            activeAnalyses++
            analyzeEntity(task.entityId, task.history, task.periods)
          }
        }
        
        // Start processing
        processFetchQueue()
      })
      
      // Generate final config after all entities are analyzed
      if (analyzedEntities.value.length > 0) {
        const config = calculator.generateBayesianConfig(
          analyzedEntities.value.slice(0, 10), // Take top 10 for default config
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
    entityStatusMap.value.clear()
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
    entityStatusMap,
    canAnalyze,
    calculator,
    connectToHA,
    updatePeriods,
    analyzeEntities,
    updateGeneratedConfig,
    resetAnalysis
  }
}