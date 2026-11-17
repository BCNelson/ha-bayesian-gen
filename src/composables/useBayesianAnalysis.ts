import { ref, computed, onUnmounted, shallowRef, markRaw } from 'vue'
import type { Auth } from 'home-assistant-js-websocket'
import { HomeAssistantClient } from '../services/homeAssistant'
import {
  createAuth,
  completeAuthCallback,
  describeAuthError,
  forgetCredentials,
  getSavedConnection,
  isAuthCallback
} from '../services/haAuth'
import { EMPTY_SCOPE, entityDomain, enrichEntities, filterByScope } from '../services/haRegistries'
import { generateBayesianConfig, informationScore } from '../services/configGenerator'
import { AnalysisOrchestrator } from '../services/analysisOrchestrator'
import { StreamingEntityBuffer } from '../services/entityBuffer'
import { EntityScorer } from '../services/entityScorer'
import type {
  EntityScope,
  EntityScopeOptions,
  HAConnection,
  HAEntity,
  HARegistries,
  ScopeOption
} from '../types/homeAssistant'
import type { TimePeriod, EntityProbability, BayesianSensorConfig } from '../types/bayesian'

export const useBayesianAnalysis = () => {
  const haConnection = ref<HAConnection | null>(null)
  const haApi = shallowRef<HomeAssistantClient | null>(null)
  const isConnected = ref(false)
  const connectionError = ref<string | null>(null)
  const registries = shallowRef<HARegistries | null>(null)

  const entities = ref<HAEntity[]>([])

  // Entity scope (areas / floors / labels / domains) chosen on the connection step
  const entityScope = ref<EntityScope>({ ...EMPTY_SCOPE })
  const scopedEntities = computed(() => filterByScope(entities.value, entityScope.value))
  const scopeScorer = new EntityScorer()
  /** In-scope entities that pass the default filters, i.e. what "Analyze" will process */
  const scopedCandidateCount = computed(() => scopeScorer.filterRelevantEntities(scopedEntities.value).length)
  const scopeOptions = computed<EntityScopeOptions>(() => {
    const byLabel = (a: ScopeOption, b: ScopeOption) => a.label.localeCompare(b.label)
    const regs = registries.value
    const usedAreas = new Set(entities.value.map(e => e.meta?.area_id).filter(Boolean))
    const usedFloors = new Set(entities.value.map(e => e.meta?.floor_id).filter(Boolean))
    const usedLabels = new Set(entities.value.flatMap(e => e.meta?.labels ?? []))
    const domains = Array.from(new Set(entities.value.map(e => entityDomain(e.entity_id))))
    return {
      areas: (regs?.areas ?? []).filter(a => usedAreas.has(a.area_id))
        .map(a => ({ label: a.name, value: a.area_id })).sort(byLabel),
      floors: (regs?.floors ?? []).filter(f => usedFloors.has(f.floor_id))
        .map(f => ({ label: f.name, value: f.floor_id })).sort(byLabel),
      labels: (regs?.labels ?? []).filter(l => usedLabels.has(l.label_id))
        .map(l => ({ label: l.name, value: l.label_id })).sort(byLabel),
      domains: domains.map(d => ({ label: d, value: d })).sort(byLabel)
    }
  })
  const setEntityScope = (scope: EntityScope) => {
    entityScope.value = scope
  }
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
  const entityStatusMap = shallowRef<Map<string, { status: 'queued' | 'fetching' | 'fetched' | 'analyzing' | 'completed' | 'error', message?: string }>>(new Map())
  const entityScores = shallowRef<Map<string, { score: number, reasons: string[] }>>(new Map())
  
  const orchestrator = new AnalysisOrchestrator()
  
  // Set up orchestrator callbacks
  orchestrator.setCallbacks({
    onProgress: (progress) => {
      analysisProgress.value = progress
    },
    onEntityStatus: (entityId, status) => {
      console.log('Entity status update:', entityId, status.status)
      const newMap = new Map(entityStatusMap.value)
      newMap.set(entityId, status)
      entityStatusMap.value = newMap
    },
    onResult: (newResults) => {
      // Add new results immediately and sort - create new array reference for shallow reactivity
      const currentResults = [...analyzedEntities.value, ...newResults]
      currentResults.sort((a, b) => informationScore(b) - informationScore(a))
      analyzedEntities.value = currentResults
    },
    onEntityFetched: (entityId, history) => {
      // NEW: Stream data to efficient buffer
      entityBuffer.loadEntityHistory(entityId, history)
      
      // Keep legacy cache for backwards compatibility
      cachedHistoricalData.value.set(entityId, history)
      // Trigger reactivity manually since Map is markRaw
      cachedHistoricalData.value = new Map(cachedHistoricalData.value)
    },
    onEntityScored: (scores) => {
      entityScores.value = new Map(
        Array.from(scores.entries()).map(([id, score]) => [
          id,
          { score: score.score, reasons: score.reasons }
        ])
      )
    }
  })
  
  onUnmounted(() => {
    orchestrator.terminate()
    closeClient()
  })
  
  const canAnalyze = computed(() => {
    const truePeriods = periods.value.filter(p => p.isTruePeriod)
    const falsePeriods = periods.value.filter(p => !p.isTruePeriod)
    return isConnected.value && truePeriods.length > 0 && falsePeriods.length > 0
  })
  
  const closeClient = () => {
    haApi.value?.close()
    haApi.value = null
  }

  const connectWithAuth = async (auth: Auth, connection: HAConnection) => {
    try {
      connectionError.value = null
      closeClient()
      const client = await HomeAssistantClient.connect(auth)
      const [states, regs] = await Promise.all([client.getStates(), client.getRegistries()])
      registries.value = regs
      entities.value = enrichEntities(states, regs)
      haConnection.value = { ...connection, url: auth.data.hassUrl }
      haApi.value = client
      isConnected.value = true
      return true
    } catch (error) {
      connectionError.value = describeAuthError(error)
      isConnected.value = false
      closeClient()
      return false
    }
  }

  /**
   * Connect with explicit settings. For OAuth without stored tokens this
   * navigates to the Home Assistant login page (the promise never resolves);
   * the redirect back is handled by `resumeSession()`.
   */
  const connectToHA = async (connection: HAConnection) => {
    let auth: Auth
    try {
      connectionError.value = null
      auth = await createAuth(connection)
    } catch (error) {
      connectionError.value = describeAuthError(error)
      isConnected.value = false
      return false
    }
    return connectWithAuth(auth, connection)
  }

  /** True when there is an OAuth callback to finish or saved credentials to auto-connect with. */
  const hasResumableSession = () => isAuthCallback() || getSavedConnection() !== null

  /** Finish an OAuth redirect, or auto-connect with remembered credentials. */
  const resumeSession = async () => {
    if (isConnected.value) return true
    if (isAuthCallback()) {
      try {
        const auth = await completeAuthCallback()
        const saved = getSavedConnection()
        return connectWithAuth(auth, {
          url: auth.data.hassUrl,
          method: 'oauth',
          remember: saved?.method === 'oauth'
        })
      } catch (error) {
        connectionError.value = describeAuthError(error)
        return false
      }
    }
    const saved = getSavedConnection()
    return saved ? connectToHA(saved) : false
  }

  /** Close the connection; with `forget` also revoke OAuth tokens and clear saved credentials. */
  const disconnectFromHA = async (forget = false) => {
    const auth = haApi.value?.auth
    closeClient()
    isConnected.value = false
    entities.value = []
    registries.value = null
    entityScope.value = { ...EMPTY_SCOPE }
    if (forget) {
      if (auth?.data.refresh_token) {
        await auth.revoke().catch(err => console.warn('Token revoke failed:', err))
      }
      forgetCredentials()
      haConnection.value = null
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
    entityStatusMap.value = new Map()
    analyzedEntities.value = []
    
    try {
      const results = await orchestrator.analyzeEntities(
        haApi.value!,
        // Only in-scope entities (scope filter on the connection step)
        scopedEntities.value,
        periods.value,
        selectedEntityIds
      )
      
      // Generate final config
      if (results.length > 0) {
        const config = generateBayesianConfig(results, 'Bayesian Sensor', {
          periods: periods.value,
          maxObservations: 10
        })
        
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
    entityStatusMap.value = new Map()
    entityScores.value = new Map()
    
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
    entityScores,
    canAnalyze,
    haConnection,
    haApi,
    registries,
    entityScope,
    scopeOptions,
    scopedEntities,
    scopedCandidateCount,
    setEntityScope,
    cachedHistoricalData,
    entityBuffer, // NEW: Efficient buffer access
    connectToHA,
    resumeSession,
    hasResumableSession,
    disconnectFromHA,
    updatePeriods,
    analyzeEntities,
    updateGeneratedConfig,
    resetAnalysis
  }
}