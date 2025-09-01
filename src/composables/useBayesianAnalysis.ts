import { ref, computed, onUnmounted, shallowRef, markRaw } from 'vue'
import { HomeAssistantAPI } from '../services/homeAssistant'
import { BayesianCalculator } from '../services/bayesianCalculator'
import { AnalysisOrchestrator } from '../services/analysisOrchestrator'
import { StreamingEntityBuffer } from '../services/entityBuffer'
import type { HAConnection, HAEntity } from '../types/homeAssistant'
import type { TimePeriod, EntityProbability, BayesianSensorConfig } from '../types/bayesian'

export const useBayesianAnalysis = () => {
  const haConnection = ref<HAConnection | null>(null)
  const haApi = ref<HomeAssistantAPI | null>(null)
  const isConnected = ref(false)
  const connectionError = ref<string | null>(null)
  
  const entities = ref<HAEntity[]>([])
  const periods = ref<TimePeriod[]>([])
  const analyzedEntities = shallowRef<EntityProbability[]>([])
  const generatedConfig = ref<BayesianSensorConfig | null>(null)
  
  // NEW: Streaming buffer for efficient data storage and transfer
  const entityBuffer = new StreamingEntityBuffer()
  
  // Keep legacy cache for backwards compatibility (will be phased out)
  const cachedHistoricalData = ref<Map<string, any[]>>(markRaw(new Map()))
  
  const isAnalyzing = ref(false)
  const analysisError = ref<string | null>(null)
  const analysisProgress = ref({ current: 0, total: 0, currentEntity: '' })
  const entityStatusMap = shallowRef<Map<string, { status: 'queued' | 'fetching' | 'fetched' | 'analyzing' | 'completed' | 'error', message?: string }>>(markRaw(new Map()))
  
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
      // Add new results immediately and sort - create new array reference for shallow reactivity
      const currentResults = [...analyzedEntities.value, ...newResults]
      currentResults.sort((a, b) => b.discriminationPower - a.discriminationPower)
      analyzedEntities.value = currentResults
    },
    onEntityFetched: (entityId, history) => {
      // NEW: Stream data to efficient buffer
      entityBuffer.loadEntityHistory(entityId, history)
      
      // Keep legacy cache for backwards compatibility
      cachedHistoricalData.value.set(entityId, history)
      // Trigger reactivity manually since Map is markRaw
      cachedHistoricalData.value = new Map(cachedHistoricalData.value)
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
    // Only re-analyze if periods actually changed significantly
    const periodsChanged = periods.value.length !== newPeriods.length || 
      periods.value.some((p, i) => {
        const newP = newPeriods[i]
        return !newP || p.isTruePeriod !== newP.isTruePeriod || 
               p.start.getTime() !== newP.start.getTime() || 
               p.end.getTime() !== newP.end.getTime()
      })
      
    periods.value = newPeriods
    
    if (periodsChanged && analyzedEntities.value.length > 0 && canAnalyze.value) {
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
    
    // Clear both buffer and legacy cache
    entityBuffer.clearAll()
    cachedHistoricalData.value = markRaw(new Map())
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
    entityBuffer, // NEW: Efficient buffer access
    connectToHA,
    updatePeriods,
    analyzeEntities,
    updateGeneratedConfig,
    resetAnalysis
  }
}