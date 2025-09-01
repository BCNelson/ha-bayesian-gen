import { ref, computed, onUnmounted } from 'vue'
import { HomeAssistantAPI } from '../services/homeAssistant'
import { BayesianCalculator } from '../services/bayesianCalculator'
import { AnalysisOrchestrator } from '../services/analysisOrchestrator'
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
  
  // Cache historical data for simulation
  const cachedHistoricalData = ref<Map<string, any[]>>(new Map())
  
  const isAnalyzing = ref(false)
  const analysisError = ref<string | null>(null)
  const analysisProgress = ref({ current: 0, total: 0, currentEntity: '' })
  const entityStatusMap = ref<Map<string, { status: 'queued' | 'fetching' | 'fetched' | 'analyzing' | 'completed' | 'error', message?: string }>>(new Map())
  
  const calculator = new BayesianCalculator()
  const orchestrator = new AnalysisOrchestrator()
  
  // Set up orchestrator callbacks
  orchestrator.setCallbacks({
    onProgress: (progress) => {
      analysisProgress.value = progress
    },
    onEntityStatus: (entityId, status) => {
      entityStatusMap.value.set(entityId, status)
    },
    onResult: (newResults) => {
      // Add new results immediately and sort
      analyzedEntities.value.push(...newResults)
      analyzedEntities.value.sort((a, b) => b.discriminationPower - a.discriminationPower)
    },
    onEntityFetched: (entityId, history) => {
      // Cache historical data immediately for simulation
      cachedHistoricalData.value.set(entityId, history)
    }
  })
  
  onUnmounted(() => {
    orchestrator.terminate()
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
    analyzedEntities.value = []
    
    try {
      const results = await orchestrator.analyzeEntities(
        haApi.value!,
        entities.value,
        periods.value,
        selectedEntityIds
      )
      
      // Cache historical data for simulation
      results.forEach(result => {
        if (!cachedHistoricalData.value.has(result.entityId)) {
          cachedHistoricalData.value.set(result.entityId, [])
        }
      })
      
      // Generate final config
      if (results.length > 0) {
        const config = calculator.generateBayesianConfig(
          results.slice(0, 10),
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
    cachedHistoricalData.value.clear()
  }
  
  return {
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
    haConnection,
    cachedHistoricalData,
    connectToHA,
    updatePeriods,
    analyzeEntities,
    updateGeneratedConfig,
    resetAnalysis
  }
}