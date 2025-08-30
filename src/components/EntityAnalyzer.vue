<template>
  <div class="entity-analyzer">
    <h2>Entity Analysis Results</h2>
    
    <div v-if="isAnalyzing" class="analyzing">
      <div class="spinner"></div>
      <p>Analyzing entity states across time periods...</p>
      <div v-if="analysisProgress.total > 0" class="progress-info">
        <div class="progress-bar">
          <div 
            class="progress-fill" 
            :style="{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }"
          ></div>
        </div>
        <p class="progress-text">
          Processing {{ analysisProgress.current }} / {{ analysisProgress.total }} entities
        </p>
        <p v-if="analysisProgress.currentEntity" class="current-entity">
          Current: {{ analysisProgress.currentEntity }}
        </p>
      </div>
    </div>
    
    <div v-else-if="error" class="error">
      {{ error }}
    </div>
    
    <div v-else-if="analyzedEntities.length > 0">
      <div class="analysis-summary">
        <p>Analyzed <strong>{{ totalEntities }}</strong> entities across <strong>{{ periods.length }}</strong> time periods</p>
        <p>Found <strong>{{ groupedEntities.length }}</strong> entities with <strong>{{ analyzedEntities.length }}</strong> total state combinations</p>
        <p><em>Entities are grouped by ID. Each entity may have multiple states that behave differently during your TRUE/FALSE periods.</em></p>
      </div>
      
      <div class="filter-controls">
        <input
          v-model="searchFilter"
          type="text"
          placeholder="Filter entities..."
          class="search-input"
        />
        <select v-model="minDiscrimination" class="discrimination-filter">
          <option value="0">All discrimination levels</option>
          <option value="0.1">Min 10% difference</option>
          <option value="0.3">Min 30% difference</option>
          <option value="0.5">Min 50% difference</option>
          <option value="0.7">Min 70% difference</option>
        </select>
      </div>
      
      <div class="entity-cards">
        <div
          v-for="group in filteredEntities"
          :key="group.entityId"
          class="entity-group-card"
        >
          <div class="entity-group-header">
            <div class="entity-name">{{ group.entityId }}</div>
            <div class="entity-domain">{{ group.entityId.split('.')[0] }}</div>
            <div class="best-discrimination">
              <span>Best: </span>
              <strong :class="getDiscriminationClass(group.bestDiscrimination)">
                {{ (group.bestDiscrimination * 100).toFixed(1) }}%
              </strong>
            </div>
          </div>
          
          <!-- Numeric entity display -->
          <div v-if="group.isNumeric" class="numeric-entity">
            <div class="numeric-header">
              <span class="numeric-label">Numeric Sensor</span>
              <span class="numeric-discrimination" :class="getDiscriminationClass(group.bestDiscrimination)">
                {{ (group.bestDiscrimination * 100).toFixed(1) }}% discrimination
              </span>
            </div>
            
            <div 
              :class="['numeric-selection-card', { selected: isEntitySelected(group.states[0]) }]"
              @click="toggleEntitySelection(group.states[0])"
            >
              <div class="numeric-selection-checkbox">
                <input 
                  type="checkbox" 
                  :checked="isEntitySelected(group.states[0])"
                  @click.stop="toggleEntitySelection(group.states[0])"
                />
              </div>
              
              <div class="numeric-content">
                <div v-if="group.numericThresholds" class="optimal-thresholds">
                  <div class="thresholds-header">Optimal Thresholds:</div>
                  <div class="thresholds-values">
                    <span v-if="group.numericThresholds.above !== undefined" class="threshold-item above">
                      Above: {{ group.numericThresholds.above.toFixed(2) }}
                    </span>
                    <span v-if="group.numericThresholds.below !== undefined" class="threshold-item below">
                      Below: {{ group.numericThresholds.below.toFixed(2) }}
                    </span>
                    <span v-if="!group.numericThresholds.above && !group.numericThresholds.below" class="threshold-item none">
                      No optimal thresholds found
                    </span>
                  </div>
                </div>
                
                <div v-if="group.correctedProbabilities" class="numeric-probabilities">
                  <div class="threshold-probabilities">
                    <div class="prob-row-numeric">
                      <span class="prob-label-numeric">When TRUE:</span>
                      <div class="prob-bar-numeric">
                        <div class="prob-fill true-fill" :style="{ width: `${group.correctedProbabilities.probGivenTrue * 100}%` }"></div>
                      </div>
                      <span class="prob-text-numeric">{{ (group.correctedProbabilities.probGivenTrue * 100).toFixed(1) }}%</span>
                    </div>
                    
                    <div class="prob-row-numeric">
                      <span class="prob-label-numeric">When FALSE:</span>
                      <div class="prob-bar-numeric">
                        <div class="prob-fill false-fill" :style="{ width: `${group.correctedProbabilities.probGivenFalse * 100}%` }"></div>
                      </div>
                      <span class="prob-text-numeric">{{ (group.correctedProbabilities.probGivenFalse * 100).toFixed(1) }}%</span>
                    </div>
                  </div>
                  
                  <div class="prob-summary">
                    Based on threshold conditions across {{ group.states[0].totalTruePeriods }} TRUE and {{ group.states[0].totalFalsePeriods }} FALSE periods
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Categorical entity display -->
          <div v-else class="entity-states">
            <div class="states-header">
              <span>States found ({{ group.states.length }}):</span>
            </div>
            
            <div class="state-list">
              <div
                v-for="state in group.states"
                :key="`${state.entityId}-${state.state}`"
                :class="['state-card', { selected: isEntitySelected(state) }]"
                @click="toggleEntitySelection(state)"
              >
                <div class="state-selection">
                  <input 
                    type="checkbox" 
                    :checked="isEntitySelected(state)"
                    @click.stop="toggleEntitySelection(state)"
                  />
                </div>
                
                <div class="state-info">
                  <div class="state-header">
                    <span class="state-value">{{ state.state }}</span>
                    <span class="state-discrimination" :class="getDiscriminationClass(state.discriminationPower)">
                      {{ (state.discriminationPower * 100).toFixed(1) }}%
                    </span>
                  </div>
                  
                  <div class="state-probabilities">
                    <div class="prob-row">
                      <span class="prob-label">TRUE:</span>
                      <div class="prob-bar-mini">
                        <div class="prob-fill true-fill" :style="{ width: `${state.probGivenTrue * 100}%` }"></div>
                      </div>
                      <span class="prob-text">{{ (state.probGivenTrue * 100).toFixed(1) }}%</span>
                      <span class="occurrence-text">({{ state.trueOccurrences }}/{{ state.totalTruePeriods }})</span>
                    </div>
                    
                    <div class="prob-row">
                      <span class="prob-label">FALSE:</span>
                      <div class="prob-bar-mini">
                        <div class="prob-fill false-fill" :style="{ width: `${state.probGivenFalse * 100}%` }"></div>
                      </div>
                      <span class="prob-text">{{ (state.probGivenFalse * 100).toFixed(1) }}%</span>
                      <span class="occurrence-text">({{ state.falseOccurrences }}/{{ state.totalFalsePeriods }})</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="entity-selection-controls">
        <div class="selection-header">
          <h3>Select Entities for Bayesian Configuration</h3>
          <p>Click on entities above or use the buttons below to select which entities to include in your final Bayesian sensor configuration.</p>
        </div>
        
        <div class="selection-actions">
          <button @click="selectTop(5)" class="select-btn">Select Top 5</button>
          <button @click="selectTop(10)" class="select-btn recommended">Select Top 10</button>
          <button @click="selectTop(20)" class="select-btn">Select Top 20</button>
          <button @click="selectAll" class="select-btn">Select All Visible</button>
          <button @click="selectNone" class="select-btn">Clear Selection</button>
        </div>
        
        <div v-if="selectedEntities.length > 0" class="selection-summary">
          <p><strong>{{ selectedEntities.length }}</strong> entities selected for configuration</p>
          <button @click="generateConfig" class="generate-btn">
            Generate Bayesian Configuration
          </button>
        </div>
      </div>
    </div>
    
    <div v-else class="no-results">
      <p>No analysis results yet. Please:</p>
      <ol>
        <li>Connect to Home Assistant</li>
        <li>Add at least one TRUE and one FALSE time period</li>
        <li>Click "Analyze Entities"</li>
      </ol>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { EntityProbability, TimePeriod } from '../types/bayesian'

const props = defineProps<{
  analyzedEntities: EntityProbability[]
  periods: TimePeriod[]
  isAnalyzing: boolean
  error: string | null
  totalEntities: number
  analysisProgress: { current: number; total: number; currentEntity: string }
}>()

const emit = defineEmits<{
  entitiesSelected: [selectedEntities: EntityProbability[]]
}>()

const searchFilter = ref('')
const minDiscrimination = ref(0)
const selectedEntities = ref<EntityProbability[]>([])

const groupedEntities = computed(() => {
  const groups = new Map<string, {
    entityId: string
    states: EntityProbability[]
    bestDiscrimination: number
    isNumeric: boolean
    numericThresholds?: { above?: number; below?: number }
    correctedProbabilities?: { probGivenTrue: number; probGivenFalse: number; discriminationPower: number }
  }>()

  for (const entity of props.analyzedEntities) {
    if (!groups.has(entity.entityId)) {
      const isNumeric = entity.numericStats?.isNumeric || false
      const numericThresholds = entity.optimalThresholds || undefined
      
      groups.set(entity.entityId, {
        entityId: entity.entityId,
        states: [],
        bestDiscrimination: 0,
        isNumeric,
        numericThresholds,
        correctedProbabilities: isNumeric && numericThresholds ? 
          calculateThresholdBasedProbabilities(entity, numericThresholds) : undefined
      })
    }
    
    const group = groups.get(entity.entityId)!
    group.states.push(entity)
    group.bestDiscrimination = Math.max(group.bestDiscrimination, entity.discriminationPower)
  }

  for (const group of groups.values()) {
    if (group.isNumeric) {
      group.states = [group.states.reduce((best, current) => 
        current.discriminationPower > best.discriminationPower ? current : best
      )]
      
      if (group.correctedProbabilities) {
        group.bestDiscrimination = group.correctedProbabilities.discriminationPower
      }
    } else {
      group.states.sort((a, b) => b.discriminationPower - a.discriminationPower)
    }
  }

  return Array.from(groups.values())
})

const calculateThresholdBasedProbabilities = (
  entity: EntityProbability, 
  thresholds: { above?: number; below?: number }
): { probGivenTrue: number; probGivenFalse: number; discriminationPower: number } => {
  if (!entity.numericStats?.isNumeric || !entity.numericStats.trueChunks || !entity.numericStats.falseChunks) {
    return { probGivenTrue: 0.5, probGivenFalse: 0.5, discriminationPower: 0 }
  }

  const { trueChunks, falseChunks } = entity.numericStats
  
  
  let trueMatchingDuration = 0
  let trueTotalDuration = 0
  
  for (const chunk of trueChunks) {
    trueTotalDuration += chunk.duration
    
    const matches = chunkMatchesThreshold(chunk.value, thresholds.above, thresholds.below)
    if (matches) {
      trueMatchingDuration += chunk.duration
    }
  }
  
  let falseMatchingDuration = 0
  let falseTotalDuration = 0
  
  for (const chunk of falseChunks) {
    falseTotalDuration += chunk.duration
    
    const matches = chunkMatchesThreshold(chunk.value, thresholds.above, thresholds.below)
    if (matches) {
      falseMatchingDuration += chunk.duration
    }
  }

  const probGivenTrue = trueTotalDuration > 0 ? trueMatchingDuration / trueTotalDuration : 0
  const probGivenFalse = falseTotalDuration > 0 ? falseMatchingDuration / falseTotalDuration : 0
  const discriminationPower = Math.abs(probGivenTrue - probGivenFalse)

  return {
    probGivenTrue: Math.min(0.99, Math.max(0.01, probGivenTrue)),
    probGivenFalse: Math.min(0.99, Math.max(0.01, probGivenFalse)),
    discriminationPower
  }
}

const chunkMatchesThreshold = (value: number, above?: number, below?: number): boolean => {
  if (above !== undefined && below !== undefined) {
    return value > above && value <= below
  } else if (above !== undefined) {
    return value > above
  } else if (below !== undefined) {
    return value <= below
  }
  return false
}

const filteredEntities = computed(() => {
  return groupedEntities.value.filter(group => {
    const matchesSearch = !searchFilter.value || 
      group.entityId.toLowerCase().includes(searchFilter.value.toLowerCase()) ||
      group.states.some(state => state.state.toLowerCase().includes(searchFilter.value.toLowerCase()))
    
    const matchesDiscrimination = group.bestDiscrimination >= Number(minDiscrimination.value)
    
    return matchesSearch && matchesDiscrimination
  }).sort((a, b) => b.bestDiscrimination - a.bestDiscrimination)
})

watch(() => props.analyzedEntities, (newEntities) => {
  if (newEntities.length > 0 && selectedEntities.value.length === 0) {
    const topEntities = newEntities
      .sort((a, b) => b.discriminationPower - a.discriminationPower)
      .slice(0, 10)
    
    selectedEntities.value = topEntities
    emit('entitiesSelected', selectedEntities.value)
  }
}, { immediate: true })

const getDiscriminationClass = (power: number) => {
  if (power >= 0.7) return 'excellent'
  if (power >= 0.5) return 'good'
  if (power >= 0.3) return 'moderate'
  return 'low'
}

const isEntitySelected = (entity: EntityProbability) => {
  return selectedEntities.value.some(e => 
    e.entityId === entity.entityId && e.state === entity.state
  )
}

const toggleEntitySelection = (entity: EntityProbability) => {
  const index = selectedEntities.value.findIndex(e => 
    e.entityId === entity.entityId && e.state === entity.state
  )
  
  if (index === -1) {
    selectedEntities.value.push(entity)
  } else {
    selectedEntities.value.splice(index, 1)
  }
  
  emit('entitiesSelected', selectedEntities.value)
}

const selectTop = (count: number) => {
  const allStates = filteredEntities.value
    .flatMap(group => group.states)
    .sort((a, b) => b.discriminationPower - a.discriminationPower)
    .slice(0, count)
  
  selectedEntities.value = allStates
  emit('entitiesSelected', selectedEntities.value)
}

const selectAll = () => {
  const allStates = filteredEntities.value.flatMap(group => group.states)
  selectedEntities.value = allStates
  emit('entitiesSelected', selectedEntities.value)
}

const selectNone = () => {
  selectedEntities.value = []
  emit('entitiesSelected', selectedEntities.value)
}

const generateConfig = () => {
  emit('entitiesSelected', selectedEntities.value)
}
</script>

<style scoped>
.entity-analyzer {
  max-width: 1200px;
  margin: 2rem auto;
}

h2 {
  color: #333;
  margin-bottom: 1.5rem;
}

.analyzing {
  text-align: center;
  padding: 3rem;
}

.spinner {
  width: 40px;
  height: 40px;
  margin: 0 auto 1rem;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #4CAF50;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.progress-info {
  margin-top: 1.5rem;
  max-width: 400px;
  margin-left: auto;
  margin-right: auto;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: #f0f0f0;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4CAF50, #66BB6A);
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.9rem;
  color: #666;
  margin: 0.5rem 0;
}

.current-entity {
  font-size: 0.8rem;
  color: #999;
  font-family: monospace;
  margin: 0.25rem 0;
  word-break: break-all;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error {
  padding: 1rem;
  background: #ffebee;
  color: #c62828;
  border-radius: 4px;
  margin-bottom: 1rem;
}

.analysis-summary {
  background: #e3f2fd;
  padding: 1rem;
  border-radius: 4px;
  margin-bottom: 1.5rem;
}

.analysis-summary p {
  margin: 0.25rem 0;
  color: #1976d2;
}

.filter-controls {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.search-input,
.discrimination-filter {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.95rem;
}

.search-input {
  flex: 1;
}

.entity-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 1.5rem;
}

.entity-group-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 12px;
  overflow: hidden;
  transition: box-shadow 0.3s;
}

.entity-group-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.entity-group-header {
  background: #f8f9fa;
  padding: 1rem;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.entity-name {
  font-family: monospace;
  font-size: 0.9rem;
  color: #333;
  font-weight: 500;
  word-break: break-all;
  flex: 1;
}

.entity-domain {
  background: #e3f2fd;
  color: #1976d2;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
}

.best-discrimination {
  font-size: 0.85rem;
  color: #666;
}

.entity-states {
  padding: 1rem;
}

.states-header {
  font-size: 0.9rem;
  color: #666;
  margin-bottom: 0.75rem;
  font-weight: 500;
}

.state-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.state-card {
  background: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 0.75rem;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  cursor: pointer;
  transition: all 0.3s;
}

.state-card:hover {
  background: #f0f0f0;
  border-color: #ccc;
}

.state-card.selected {
  background: rgba(76, 175, 80, 0.1);
  border-color: #4CAF50;
}

.state-selection input[type="checkbox"] {
  cursor: pointer;
  margin-top: 0.25rem;
}

.state-info {
  flex: 1;
}

.state-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.state-value {
  font-weight: 500;
  color: #333;
  background: white;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  border: 1px solid #ddd;
  font-family: monospace;
  font-size: 0.85rem;
}

.state-discrimination {
  font-size: 0.8rem;
  font-weight: 600;
}

.state-probabilities {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.prob-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.prob-label {
  min-width: 45px;
  font-weight: 500;
  color: #666;
}

.prob-bar-mini {
  width: 60px;
  height: 12px;
  background: #f0f0f0;
  border-radius: 6px;
  overflow: hidden;
}

.prob-fill {
  height: 100%;
  border-radius: 6px;
  transition: width 0.3s ease;
}

.true-fill {
  background: linear-gradient(90deg, #4CAF50, #66BB6A);
}

.false-fill {
  background: linear-gradient(90deg, #f44336, #ef5350);
}

.prob-text {
  min-width: 35px;
  text-align: right;
  font-weight: 500;
}

.occurrence-text {
  color: #999;
  font-size: 0.75rem;
}

.state-thresholds {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.threshold-mini {
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
  font-size: 0.7rem;
  font-weight: 500;
  font-family: monospace;
}

.threshold-mini.above {
  background: #e8f5e9;
  color: #2e7d32;
  border: 1px solid #4CAF50;
}

.threshold-mini.below {
  background: #e3f2fd;
  color: #1976d2;
  border: 1px solid #2196f3;
}

.numeric-entity {
  padding: 1rem;
}

.numeric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.numeric-label {
  background: #fff3e0;
  color: #f57c00;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  text-transform: uppercase;
}

.numeric-discrimination {
  font-size: 0.85rem;
  font-weight: 600;
}

.numeric-selection-card {
  background: #fafafa;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
  cursor: pointer;
  transition: all 0.3s;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.numeric-selection-card:hover {
  background: #f0f0f0;
  border-color: #ccc;
}

.numeric-selection-card.selected {
  background: rgba(76, 175, 80, 0.1);
  border-color: #4CAF50;
}

.numeric-selection-checkbox input[type="checkbox"] {
  cursor: pointer;
  margin-top: 0.25rem;
}

.numeric-content {
  flex: 1;
}

.optimal-thresholds {
  margin-bottom: 1rem;
}

.thresholds-header {
  font-size: 0.9rem;
  font-weight: 500;
  color: #333;
  margin-bottom: 0.5rem;
}

.thresholds-values {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.threshold-item {
  padding: 0.4rem 0.7rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  font-family: monospace;
}

.threshold-item.above {
  background: #e8f5e9;
  color: #2e7d32;
  border: 1px solid #4CAF50;
}

.threshold-item.below {
  background: #e3f2fd;
  color: #1976d2;
  border: 1px solid #2196f3;
}

.threshold-item.none {
  background: #f5f5f5;
  color: #666;
  border: 1px solid #ddd;
  font-style: italic;
}

.numeric-probabilities {
  padding-top: 0.75rem;
  border-top: 1px solid #e0e0e0;
}

.threshold-probabilities {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.prob-row-numeric {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.prob-label-numeric {
  min-width: 70px;
  font-weight: 500;
  color: #666;
}

.prob-bar-numeric {
  flex: 1;
  height: 16px;
  background: #f0f0f0;
  border-radius: 8px;
  overflow: hidden;
}

.prob-text-numeric {
  min-width: 40px;
  text-align: right;
  font-weight: 500;
}

.prob-summary {
  font-size: 0.8rem;
  color: #666;
  font-style: italic;
}

.excellent {
  color: #4CAF50;
}

.good {
  color: #8BC34A;
}

.moderate {
  color: #FFC107;
}

.low {
  color: #FF9800;
}

.no-results {
  background: #f5f5f5;
  padding: 2rem;
  border-radius: 8px;
  text-align: center;
}

.no-results ol {
  text-align: left;
  display: inline-block;
  margin-top: 1rem;
}

.entity-card {
  cursor: pointer;
  transition: all 0.3s ease;
}

.entity-card.selected {
  border-color: #4CAF50;
  background: rgba(76, 175, 80, 0.05);
}

.selection-checkbox {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 10;
}

.selection-checkbox input[type="checkbox"] {
  cursor: pointer;
}

.entity-selection-controls {
  margin-top: 2rem;
  padding: 1.5rem;
  background: #f8f9fa;
  border-radius: 8px;
  border: 2px solid #e0e0e0;
}

.selection-header h3 {
  margin: 0 0 0.5rem 0;
  color: #333;
}

.selection-header p {
  margin: 0 0 1.5rem 0;
  color: #666;
  line-height: 1.4;
}

.selection-actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
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
  border-color: #bbb;
}

.select-btn.recommended {
  background: #e3f2fd;
  border-color: #2196f3;
  color: #1976d2;
  font-weight: 500;
}

.select-btn.recommended:hover {
  background: #bbdefb;
  border-color: #1976d2;
}

.selection-summary {
  text-align: center;
  padding: 1rem;
  background: #e8f5e9;
  border: 1px solid #4CAF50;
  border-radius: 4px;
}

.selection-summary p {
  margin: 0 0 1rem 0;
  color: #2e7d32;
  font-weight: 500;
}

.generate-btn {
  padding: 0.75rem 2rem;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 500;
  transition: background 0.3s;
}

.generate-btn:hover {
  background: #45a049;
}

@media (max-width: 768px) {
  .selection-actions {
    justify-content: center;
  }
  
  .select-btn {
    font-size: 0.85rem;
    padding: 0.4rem 0.8rem;
  }
}
</style>