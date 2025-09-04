<script setup lang="ts">
import { ref, onMounted, computed, defineAsyncComponent } from 'vue'
import { NConfigProvider, NMessageProvider, NCard, NButton, NSpace, NAlert, NText, NList, NListItem, NTag, NTabs, NTabPane, NBadge, NSpin } from 'naive-ui'
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
        <header>
          <h1>Home Assistant Bayesian Sensor Generator</h1>
          <n-text depth="3">Generate optimized Bayesian sensor configurations based on your historical data</n-text>
        </header>
        
        <main>
          <n-tabs 
            v-model:value="activeTab" 
            type="card" 
            size="large"
            animated
            class="main-tabs"
          >
            <!-- Step 1: Connection -->
            <n-tab-pane 
              name="connection" 
              :disabled="tabStates.connection.disabled"
              class="tab-pane"
            >
              <template #tab>
                <div class="tab-header">
                  <n-badge 
                    :value="tabStates.connection.badge"
                    :type="tabStates.connection.completed ? 'success' : 'default'"
                    :show="true"
                  >
                    {{ tabStates.connection.title }}
                  </n-badge>
                </div>
              </template>
              
              <n-card :bordered="false" class="tab-content">
                <template #header>
                  <h2>Connect to Home Assistant</h2>
                  <n-text depth="3">Establish connection to fetch entity data</n-text>
                </template>
                
                <n-space vertical size="large">
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
              </n-card>
            </n-tab-pane>
            
            <!-- Step 2: Time Periods -->
            <n-tab-pane 
              name="periods" 
              :disabled="tabStates.periods.disabled"
              class="tab-pane"
            >
              <template #tab>
                <div class="tab-header">
                  <n-badge 
                    :value="tabStates.periods.badge"
                    :type="tabStates.periods.completed ? 'success' : 'default'"
                    :show="true"
                  >
                    {{ tabStates.periods.title }}
                  </n-badge>
                </div>
              </template>
              
              <n-card :bordered="false" class="tab-content">
                <template #header>
                  <h2>Define Time Periods</h2>
                  <n-text depth="3">Set when your sensor should be TRUE or FALSE</n-text>
                </template>
                
                <Suspense>
                  <TimePeriodSelector @periods-updated="handlePeriodsUpdate" />
                  <template #fallback>
                    <n-space justify="center" style="padding: 2rem">
                      <n-spin size="large" />
                    </n-space>
                  </template>
                </Suspense>
              </n-card>
            </n-tab-pane>
            
            <!-- Step 3: Analysis -->
            <n-tab-pane 
              name="analysis" 
              :disabled="tabStates.analysis.disabled"
              class="tab-pane"
            >
              <template #tab>
                <div class="tab-header">
                  <n-badge 
                    :value="tabStates.analysis.badge"
                    :type="tabStates.analysis.completed ? 'success' : 'default'"
                    :show="true"
                  >
                    {{ tabStates.analysis.title }}
                  </n-badge>
                </div>
              </template>
              
              <n-card :bordered="false" class="tab-content">
                <template #header>
                  <h2>Analyze Entities</h2>
                  <n-text depth="3">Find the best entities for your Bayesian sensor</n-text>
                </template>
                
                <n-space vertical align="center" class="analyze-section">
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
              </n-card>
            </n-tab-pane>
            
            <!-- Step 4: Configuration -->
            <n-tab-pane 
              name="config" 
              :disabled="tabStates.config.disabled"
              class="tab-pane"
            >
              <template #tab>
                <div class="tab-header">
                  <n-badge 
                    :value="tabStates.config.badge"
                    :type="tabStates.config.completed ? 'success' : 'default'"
                    :show="true"
                  >
                    {{ tabStates.config.title }}
                  </n-badge>
                </div>
              </template>
              
              <n-card :bordered="false" class="tab-content">
                <template #header>
                  <h2>Configuration & Testing</h2>
                  <n-text depth="3">Generate YAML config and test with historical data</n-text>
                </template>
                
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
              </n-card>
            </n-tab-pane>
          </n-tabs>
        </main>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1rem;
}

header {
  text-align: center;
  margin-bottom: 3rem;
  padding: 2rem 0;
  border-bottom: 2px solid #e0e0e0;
}

header h1 {
  color: #333;
  margin-bottom: 0.5rem;
}

.step {
  margin-bottom: 2rem;
  transition: all 0.3s ease;
}

.step.completed :deep(.n-card) {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.05);
}

.step-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.step-header h2 {
  margin: 0;
  color: #333;
}

.analyze-section {
  margin-bottom: 2rem;
  width: 100%;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
}

/* Responsive design for tabs */
@media (max-width: 768px) {
  .app {
    padding: 0.5rem;
  }
  
  header {
    padding: 1rem 0;
  }
  
  header h1 {
    font-size: 1.8rem;
  }
  
  .main-tabs :deep(.n-tab-pane) {
    padding: 1rem;
  }
  
  .tab-content h2 {
    font-size: 1.3rem;
  }
}

/* Loading state for suspense fallback */
.tab-content :deep(.n-spin) {
  color: #18a058;
}

</style>