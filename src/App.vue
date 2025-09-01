<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { NConfigProvider, NMessageProvider, NCard, NButton, NSpace, NAlert, NText, NList, NListItem, NTag } from 'naive-ui'
import { useBayesianAnalysis } from './composables/useBayesianAnalysis'
import ConnectionForm from './components/ConnectionForm.vue'
import TimePeriodSelector from './components/TimePeriodSelector.vue'
import EntityAnalyzer from './components/EntityAnalyzer.vue'
import ConfigOutput from './components/ConfigOutput.vue'
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
  connectToHA,
  updatePeriods,
  analyzeEntities,
  updateGeneratedConfig,
  resetAnalysis
} = useBayesianAnalysis()

const selectedEntitiesForConfig = ref<EntityProbability[]>([])
const isAutoConnecting = ref(false)

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
}

const handleAnalyze = () => {
  analyzeEntities() // Analyze all entities
}

const handleEntitiesSelected = (selectedEntities: EntityProbability[]) => {
  selectedEntitiesForConfig.value = selectedEntities
  if (selectedEntities.length > 0) {
    const config = calculator.generateBayesianConfig(
      selectedEntities,
      'Custom Bayesian Sensor',
      selectedEntities.length // Use ALL selected entities, no limit
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
        <n-card
          class="step"
          :class="{ completed: isConnected }"
          :bordered="false"
        >
          <template #header>
            <div class="step-header">
              <n-tag :type="isConnected ? 'success' : 'default'" round size="large">
                1
              </n-tag>
              <h2>Connect to Home Assistant</h2>
            </div>
          </template>
          <ConnectionForm 
            :is-connected="isConnected"
            :connection-error="connectionError"
            :is-auto-connecting="isAutoConnecting"
            @connect="handleConnect"
            @connection-status="handleConnectionStatus"
          />
        </n-card>
        
        <n-card
          v-if="isConnected"
          class="step"
          :class="{ completed: periods.length > 0 }"
          :bordered="false"
        >
          <template #header>
            <div class="step-header">
              <n-tag :type="periods.length > 0 ? 'success' : 'default'" round size="large">
                2
              </n-tag>
              <h2>Define Time Periods</h2>
            </div>
          </template>
          <TimePeriodSelector @periods-updated="handlePeriodsUpdate" />
        </n-card>
        
        <n-card
          v-if="isConnected && periods.length > 0"
          class="step"
          :bordered="false"
        >
          <template #header>
            <div class="step-header">
              <n-tag :type="analyzedEntities.length > 0 ? 'success' : 'default'" round size="large">
                3
              </n-tag>
              <h2>Analyze Entities</h2>
            </div>
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
        </n-card>
        
        <n-card
          v-if="generatedConfig"
          class="step"
          :bordered="false"
        >
          <template #header>
            <div class="step-header">
              <n-tag type="success" round size="large">
                4
              </n-tag>
              <h2>Configuration</h2>
            </div>
          </template>
          <ConfigOutput 
            :config="generatedConfig"
            :entity-probabilities="analyzedEntities"
            :ha-connection="haConnection"
            :cached-historical-data="cachedHistoricalData"
            @config-updated="updateGeneratedConfig"
          />
        </n-card>
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
}

.entity-selection {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1.5rem;
  margin-bottom: 2rem;
}

.entity-selection h3 {
  margin: 0 0 0.5rem 0;
  color: #333;
}

.entity-selection p {
  margin: 0 0 1.5rem 0;
  color: #666;
}

.selection-controls {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 2rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.filter-section {
  flex: 1;
  min-width: 300px;
}

.entity-filter {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  margin-bottom: 1rem;
}

.domain-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.domain-btn {
  padding: 0.5rem 1rem;
  border: 2px solid #e0e0e0;
  background: white;
  color: #666;
  border-radius: 20px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.3s;
}

.domain-btn:hover {
  border-color: #4CAF50;
}

.domain-btn.active {
  border-color: #4CAF50;
  background: #4CAF50;
  color: white;
}

.selection-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.select-btn {
  padding: 0.5rem 1rem;
  border: 1px solid #ddd;
  background: white;
  color: #333;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.3s;
  white-space: nowrap;
}

.select-btn:hover {
  background: #f0f0f0;
}

.select-btn.recommended {
  background: #e3f2fd;
  border-color: #2196f3;
  color: #1976d2;
}

.select-btn.recommended:hover {
  background: #bbdefb;
}

.entity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 0.5rem;
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 1rem;
  background: white;
}

.entity-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.entity-item:hover {
  background: #f8f9fa;
  border-color: #e0e0e0;
}

.entity-item input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}

.entity-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.entity-id {
  font-family: monospace;
  font-size: 0.85rem;
  color: #333;
  font-weight: 500;
}

.entity-state {
  font-size: 0.8rem;
  color: #666;
  background: #f0f0f0;
  padding: 0.2rem 0.5rem;
  border-radius: 3px;
  align-self: flex-start;
}

.entity-domain {
  font-size: 0.75rem;
  color: #999;
  text-transform: uppercase;
  font-weight: 500;
}

.selection-summary {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #e8f5e9;
  border: 1px solid #4CAF50;
  border-radius: 4px;
  text-align: center;
}

.selection-summary p {
  margin: 0;
  color: #2e7d32;
  font-weight: 500;
}

@media (max-width: 768px) {
  .selection-controls {
    flex-direction: column;
    align-items: stretch;
  }
  
  .filter-section {
    min-width: auto;
  }
  
  .selection-actions {
    flex-direction: row;
    justify-content: center;
    flex-wrap: wrap;
  }
  
  .entity-grid {
    grid-template-columns: 1fr;
  }
}
</style>