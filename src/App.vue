<script setup lang="ts">
import { ref, onMounted, computed, defineAsyncComponent } from 'vue'
import { NConfigProvider, NMessageProvider, NButton, NSpace, NAlert, NText, NList, NListItem, NTag, NTabs, NTabPane, NSpin } from 'naive-ui'
import { useBayesianAnalysis } from './composables/useBayesianAnalysis'
// Lazy load components for better performance
const ConnectionForm = defineAsyncComponent(() => import('./components/ConnectionForm.vue'))
const EntityScoreDisplay = defineAsyncComponent(() => import('./components/EntityScoreDisplay.vue'))
const TimePeriodSelector = defineAsyncComponent(() => import('./components/TimePeriodSelector.vue')) 
const EntityAnalyzer = defineAsyncComponent(() => import('./components/EntityAnalyzer.vue'))
const ConfigOutput = defineAsyncComponent(() => import('./components/ConfigOutput.vue'))
import type { EntityProbability } from './types/bayesian'

const {
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
  entityBuffer, // NEW: Buffer access
  connectToHA,
  updatePeriods,
  analyzeEntities,
  updateGeneratedConfig,
  resetAnalysis
} = useBayesianAnalysis()

const selectedEntitiesForConfig = ref<EntityProbability[]>([])
const isAutoConnecting = ref(false)
const activeTab = ref('connection')

// Computed properties for tab states
const tabStates = computed(() => ({
  connection: {
    disabled: false,
    completed: isConnected.value,
    title: 'Connect to HA',
    badge: isConnected.value ? '✓' : '1'
  },
  periods: {
    disabled: !isConnected.value,
    completed: isConnected.value && periods.value.length > 0,
    title: 'Define Periods',
    badge: (isConnected.value && periods.value.length > 0) ? '✓' : '2'
  },
  analysis: {
    disabled: !isConnected.value || periods.value.length === 0,
    completed: analyzedEntities.value.length > 0,
    title: 'Analyze Entities',
    badge: analyzedEntities.value.length > 0 ? `✓ ${analyzedEntities.value.length}` : '3'
  },
  config: {
    disabled: !generatedConfig.value,
    completed: !!generatedConfig.value,
    title: 'Configuration',
    badge: generatedConfig.value ? '✓' : '4'
  }
}))

// No auto-advancement - let users control their navigation

const handleConnect = async (connection: any) => {
  const success = await connectToHA(connection)
  if (success) {
    resetAnalysis()
  }
  isAutoConnecting.value = false
}

const handleConnectionStatus = () => {
}

// Auto-connect on mount if credentials are saved
onMounted(async () => {
  const savedUrl = localStorage.getItem('ha_url')
  const savedToken = localStorage.getItem('ha_token')
  
  if (savedUrl && savedToken && !isConnected.value) {
    isAutoConnecting.value = true
    const connection = {
      url: savedUrl,
      token: savedToken
    }
    await connectToHA(connection)
    isAutoConnecting.value = false
  }
})

const handlePeriodsUpdate = (newPeriods: any) => {
  updatePeriods(newPeriods)
  // Don't auto-advance - let users review their periods first
}

const handleAnalyze = () => {
  analyzeEntities() // Analyze all entities
}

const handleEntitiesSelected = (selectedEntities: EntityProbability[]) => {
  selectedEntitiesForConfig.value = selectedEntities
  if (selectedEntities.length > 0) {
    // User explicitly selected these entities - use ALL of them, no filtering
    const config = calculator.generateBayesianConfig(
      selectedEntities,
      'Custom Bayesian Sensor',
      selectedEntities.length,
      true // skipFiltering = true for user selections
    )
    
    updateGeneratedConfig(config)
  }
}
</script>

<template>
  <n-config-provider>
    <n-message-provider>
      <div class="app">
        <header class="minimal-header">
          <div class="header-content">
            <h1 class="app-title">HA Bayesian Generator</h1>
            <n-tabs 
              v-model:value="activeTab" 
              type="line" 
              size="medium"
              animated
              class="header-tabs"
            >
              <!-- Step 1: Connection -->
              <n-tab-pane 
                name="connection" 
                :disabled="tabStates.connection.disabled"
              >
                <template #tab>
                  <span class="tab-label">
                    <span v-if="tabStates.connection.completed" class="tab-icon">✓</span>
                    Connect
                  </span>
                </template>
              </n-tab-pane>
              
              <!-- Step 2: Time Periods -->
              <n-tab-pane 
                name="periods" 
                :disabled="tabStates.periods.disabled"
              >
                <template #tab>
                  <span class="tab-label">
                    <span v-if="tabStates.periods.completed" class="tab-icon">✓</span>
                    Periods
                  </span>
                </template>
              </n-tab-pane>
              
              <!-- Step 3: Analysis -->
              <n-tab-pane 
                name="analysis" 
                :disabled="tabStates.analysis.disabled"
              >
                <template #tab>
                  <span class="tab-label">
                    <span v-if="tabStates.analysis.completed" class="tab-icon">✓</span>
                    Analyze
                    <span v-if="analyzedEntities.length > 0" class="tab-count">{{ analyzedEntities.length }}</span>
                  </span>
                </template>
              </n-tab-pane>
              
              <!-- Step 4: Configuration -->
              <n-tab-pane 
                name="config" 
                :disabled="tabStates.config.disabled"
              >
                <template #tab>
                  <span class="tab-label">
                    <span v-if="tabStates.config.completed" class="tab-icon">✓</span>
                    Config
                  </span>
                </template>
              </n-tab-pane>
            </n-tabs>
          </div>
        </header>
        
        <main class="main-content">
          <div class="content-wrapper">
            <!-- Connection Panel -->
            <div v-show="activeTab === 'connection'" class="panel-content">
              <n-space vertical size="medium">
                  <Suspense>
                    <ConnectionForm 
                      :is-connected="isConnected"
                      :connection-error="connectionError"
                      :is-auto-connecting="isAutoConnecting"
                      @connect="handleConnect"
                      @connection-status="handleConnectionStatus"
                    />
                    <template #fallback>
                      <n-space justify="center" style="padding: 2rem">
                        <n-spin size="large" />
                      </n-space>
                    </template>
                  </Suspense>
                  
                  <Suspense>
                    <EntityScoreDisplay 
                      v-if="isConnected && entities.length > 0"
                      :entities="entities"
                    />
                    <template #fallback>
                      <div v-if="isConnected && entities.length > 0">
                        <n-spin size="small" />
                      </div>
                    </template>
                  </Suspense>
              </n-space>
            </div>
            
            <!-- Periods Panel -->
            <div v-show="activeTab === 'periods'" class="panel-content periods-panel">
              <Suspense>
                <TimePeriodSelector @periods-updated="handlePeriodsUpdate" />
                <template #fallback>
                  <n-space justify="center" style="padding: 2rem">
                    <n-spin size="large" />
                  </n-space>
                </template>
              </Suspense>
            </div>
            
            <!-- Analysis Panel -->
            <div v-show="activeTab === 'analysis'" class="panel-content">
              <n-space vertical class="analyze-section">
                  <n-button
                    @click="handleAnalyze"
                    :disabled="!canAnalyze || isAnalyzing"
                    :loading="isAnalyzing"
                    type="primary"
                    size="large"
                  >
                    {{ isAnalyzing ? 'Analyzing...' : 'Analyze All Entities' }}
                  </n-button>
                  <n-text v-if="entities.length > 0" depth="3">
                    Found {{ entities.length }} entities to analyze
                  </n-text>
                  
                  <n-alert
                    v-if="!canAnalyze && !isAnalyzing"
                    type="warning"
                    title="Requirements for analysis"
                  >
                    <n-list>
                      <n-list-item>
                        <n-tag :type="isConnected ? 'success' : 'error'" size="small">
                          {{ isConnected ? '✅' : '❌' }}
                        </n-tag>
                        Connected to Home Assistant
                      </n-list-item>
                      <n-list-item>
                        <n-tag :type="periods.filter(p => p.isTruePeriod).length > 0 ? 'success' : 'error'" size="small">
                          {{ periods.filter(p => p.isTruePeriod).length > 0 ? '✅' : '❌' }}
                        </n-tag>
                        At least 1 TRUE period ({{ periods.filter(p => p.isTruePeriod).length }} found)
                      </n-list-item>
                      <n-list-item>
                        <n-tag :type="periods.filter(p => !p.isTruePeriod).length > 0 ? 'success' : 'error'" size="small">
                          {{ periods.filter(p => !p.isTruePeriod).length > 0 ? '✅' : '❌' }}
                        </n-tag>
                        At least 1 FALSE period ({{ periods.filter(p => !p.isTruePeriod).length }} found)
                      </n-list-item>
                    </n-list>
                  </n-alert>
              </n-space>
              
              <Suspense>
                <EntityAnalyzer 
                  :analyzed-entities="analyzedEntities"
                  :periods="periods"
                  :is-analyzing="isAnalyzing"
                  :error="analysisError"
                  :total-entities="entities.length"
                  :analysis-progress="analysisProgress"
                  :entity-status-map="entityStatusMap"
                  @entities-selected="handleEntitiesSelected"
                />
                <template #fallback>
                  <n-space justify="center" style="padding: 2rem">
                    <n-spin size="large" />
                  </n-space>
                </template>
              </Suspense>
            </div>
            
            <!-- Configuration Panel -->
            <div v-show="activeTab === 'config'" class="panel-content">
              <Suspense>
                <ConfigOutput 
                  :config="generatedConfig"
                  :entity-probabilities="analyzedEntities"
                  :ha-connection="haConnection"
                  :cached-historical-data="cachedHistoricalData"
                  :entity-buffer="entityBuffer"
                  :entity-status-map="entityStatusMap"
                  :periods="periods"
                  @config-updated="updateGeneratedConfig"
                />
                <template #fallback>
                  <n-space justify="center" style="padding: 2rem">
                    <n-spin size="large" />
                  </n-space>
                </template>
              </Suspense>
            </div>
          </div>
        </main>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background-color: #ffffff;
}

.minimal-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.header-content {
  display: flex;
  align-items: center;
  height: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 1rem;
  gap: 2rem;
}

.app-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
  white-space: nowrap;
  color: #333;
}

.header-tabs {
  flex: 1;
}

.header-tabs :deep(.n-tabs-nav) {
  background: transparent;
}

.header-tabs :deep(.n-tabs-tab) {
  padding: 0 16px;
  height: 48px;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}

.tab-icon {
  color: #18a058;
  font-weight: bold;
}

.tab-count {
  background: #18a058;
  color: white;
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 0.75rem;
  margin-left: 4px;
}

.main-content {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  background-color: #ffffff;
}

.content-wrapper {
  height: 100%;
  max-width: 1400px;
  margin: 0 auto;
  box-sizing: border-box;
}

.panel-content {
  height: 100%;
  padding: 1rem;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: #ffffff;
  box-sizing: border-box;
}

.analyze-section {
  margin-bottom: 1rem;
  width: 100%;
  padding: 0.75rem;
  background: #f0f4f8;
  border-radius: 6px;
  border: 1px solid #d1d9e0;
  box-sizing: border-box;
}

.analyze-section .n-button {
  width: auto;
}

.analyze-section .n-alert {
  margin-top: 1rem;
}

/* Responsive adjustments */
.periods-panel {
  overflow-y: auto !important;
  height: 100% !important;
  padding: 0.5rem !important;
}

@media (max-width: 768px) {
  .app-title {
    font-size: 0.9rem;
  }
  
  .header-content {
    gap: 1rem;
    padding: 0 0.5rem;
  }
  
  .tab-label {
    font-size: 0.85rem;
  }
  
  .panel-content {
    padding: 0.5rem;
  }
  
  .periods-panel {
    overflow-y: visible !important;
  }
}

/* High density screens */
@media (min-width: 1600px) {
  .content-wrapper {
    max-width: 1600px;
  }
}

/* Loading state */
.panel-content :deep(.n-spin) {
  color: #18a058;
}
</style>