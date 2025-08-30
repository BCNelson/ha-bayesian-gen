<script setup lang="ts">
import { ref } from 'vue'
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
  canAnalyze,
  calculator,
  connectToHA,
  updatePeriods,
  analyzeEntities,
  updateGeneratedConfig,
  resetAnalysis
} = useBayesianAnalysis()

const selectedEntitiesForConfig = ref<EntityProbability[]>([])

const handleConnect = async (connection: any) => {
  const success = await connectToHA(connection)
  if (success) {
    resetAnalysis()
  }
}

const handleConnectionStatus = () => {
}

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
  <div class="app">
    <header>
      <h1>Home Assistant Bayesian Sensor Generator</h1>
      <p>Generate optimized Bayesian sensor configurations based on your historical data</p>
    </header>
    
    <main>
      <div class="step" :class="{ completed: isConnected }">
        <div class="step-header">
          <span class="step-number">1</span>
          <h2>Connect to Home Assistant</h2>
        </div>
        <ConnectionForm 
          :is-connected="isConnected"
          :connection-error="connectionError"
          @connect="handleConnect"
          @connection-status="handleConnectionStatus"
        />
      </div>
      
      <div v-if="isConnected" class="step" :class="{ completed: periods.length > 0 }">
        <div class="step-header">
          <span class="step-number">2</span>
          <h2>Define Time Periods</h2>
        </div>
        <TimePeriodSelector @periods-updated="handlePeriodsUpdate" />
      </div>
      
      <div v-if="isConnected && periods.length > 0" class="step">
        <div class="step-header">
          <span class="step-number">3</span>
          <h2>Analyze Entities</h2>
        </div>
        
        <div class="analyze-section">
          <button 
            @click="handleAnalyze" 
            :disabled="!canAnalyze || isAnalyzing"
            class="analyze-btn"
          >
            {{ isAnalyzing ? 'Analyzing...' : 'Analyze All Entities' }}
          </button>
          <p v-if="entities.length > 0" class="entity-count">
            Found {{ entities.length }} entities to analyze
          </p>
          
          <!-- Debug info when button is disabled -->
          <div v-if="!canAnalyze && !isAnalyzing" class="analyze-requirements">
            <p><strong>Requirements for analysis:</strong></p>
            <ul>
              <li :class="{ completed: isConnected }">
                {{ isConnected ? '✅' : '❌' }} Connected to Home Assistant
              </li>
              <li :class="{ completed: periods.filter(p => p.isTruePeriod).length > 0 }">
                {{ periods.filter(p => p.isTruePeriod).length > 0 ? '✅' : '❌' }} 
                At least 1 TRUE period ({{ periods.filter(p => p.isTruePeriod).length }} found)
              </li>
              <li :class="{ completed: periods.filter(p => !p.isTruePeriod).length > 0 }">
                {{ periods.filter(p => !p.isTruePeriod).length > 0 ? '✅' : '❌' }} 
                At least 1 FALSE period ({{ periods.filter(p => !p.isTruePeriod).length }} found)
              </li>
            </ul>
          </div>
        </div>
        
        <EntityAnalyzer 
          :analyzed-entities="analyzedEntities"
          :periods="periods"
          :is-analyzing="isAnalyzing"
          :error="analysisError"
          :total-entities="entities.length"
          :analysis-progress="analysisProgress"
          @entities-selected="handleEntitiesSelected"
        />
      </div>
      
      <div v-if="generatedConfig" class="step">
        <div class="step-header">
          <span class="step-number">4</span>
          <h2>Configuration</h2>
        </div>
        <ConfigOutput 
          :config="generatedConfig"
          :entity-probabilities="analyzedEntities"
          @config-updated="updateGeneratedConfig"
        />
      </div>
    </main>
  </div>
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

header p {
  color: #666;
  font-size: 1.1rem;
}

.step {
  margin-bottom: 3rem;
  padding: 2rem;
  border: 2px solid #e0e0e0;
  border-radius: 12px;
  transition: all 0.3s ease;
}

.step.completed {
  border-color: #4CAF50;
  background: rgba(76, 175, 80, 0.05);
}

.step-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.step-number {
  width: 40px;
  height: 40px;
  background: #f0f0f0;
  color: #666;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1.2rem;
}

.step.completed .step-number {
  background: #4CAF50;
  color: white;
}

.step-header h2 {
  margin: 0;
  color: #333;
}

.analyze-section {
  margin-bottom: 2rem;
  text-align: center;
}

.analyze-btn {
  padding: 1rem 2rem;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1.1rem;
  cursor: pointer;
  transition: background 0.3s;
  margin-bottom: 1rem;
}

.analyze-btn:hover:not(:disabled) {
  background: #45a049;
}

.analyze-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.entity-count {
  color: #666;
  margin: 0;
}

.analyze-requirements {
  margin-top: 1rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 4px;
  border-left: 4px solid #ffc107;
}

.analyze-requirements p {
  margin: 0 0 0.5rem 0;
  color: #333;
}

.analyze-requirements ul {
  margin: 0;
  padding-left: 1.5rem;
}

.analyze-requirements li {
  margin: 0.25rem 0;
  color: #666;
}

.analyze-requirements li.completed {
  color: #28a745;
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
