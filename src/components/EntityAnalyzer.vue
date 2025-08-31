<template>
  <div class="entity-analyzer">
    <h2>Entity Analysis Results</h2>
    
    <div v-if="isAnalyzing" class="analyzing">
      <div class="progress-header">
        <div class="spinner"></div>
        <p>Analyzing entity states across time periods...</p>
      </div>
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
      
      <!-- Entity Status Cards during analysis -->
      <div v-if="entityStatusMap.size > 0" class="entity-cards">
        <EntityCard
          v-for="[entityId, status] in sortedEntityStatusMap" 
          :key="entityId"
          :group="getEntityGroupForAnalysis(entityId)"
          :entity-status="status"
          :selected-entities="selectedEntities"
          @toggle-selection="toggleEntitySelection"
        />
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
        <EntityCard
          v-for="group in filteredEntities"
          :key="group.entityId"
          :group="group"
          :selected-entities="selectedEntities"
          @toggle-selection="toggleEntitySelection"
        />
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
import EntityCard from './EntityCard.vue'

const props = defineProps<{
  analyzedEntities: EntityProbability[]
  periods: TimePeriod[]
  isAnalyzing: boolean
  error: string | null
  totalEntities: number
  analysisProgress: { current: number; total: number; currentEntity: string }
  entityStatusMap: Map<string, { status: 'queued' | 'fetching' | 'fetched' | 'analyzing' | 'completed' | 'error'; message?: string }>
}>()

const emit = defineEmits<{
  entitiesSelected: [selectedEntities: EntityProbability[]]
}>()

const searchFilter = ref('')
const minDiscrimination = ref(0.3)
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

// Sort entity status map: completed entities by discrimination, incomplete by processing order
const sortedEntityStatusMap = computed(() => {
  const entries = Array.from(props.entityStatusMap.entries())
  
  // Separate completed and incomplete entities
  const completed: Array<[string, any]> = []
  const incomplete: Array<[string, any]> = []
  
  entries.forEach(([entityId, status]) => {
    if (status.status === 'completed') {
      completed.push([entityId, status])
    } else {
      incomplete.push([entityId, status])
    }
  })
  
  // Sort completed by discrimination power (best first)
  completed.sort((a, b) => {
    const groupA = groupedEntities.value.find(g => g.entityId === a[0])
    const groupB = groupedEntities.value.find(g => g.entityId === b[0])
    const discrimA = groupA?.bestDiscrimination || 0
    const discrimB = groupB?.bestDiscrimination || 0
    return discrimB - discrimA
  })
  
  // Sort incomplete by status priority (processing order)
  const statusPriority: Record<string, number> = {
    'analyzing': 1,
    'fetched': 2,
    'fetching': 3,
    'queued': 4,
    'error': 5
  }
  
  incomplete.sort((a, b) => {
    const priorityA = statusPriority[a[1].status] || 99
    const priorityB = statusPriority[b[1].status] || 99
    return priorityA - priorityB
  })
  
  // Combine: completed first (sorted by discrimination), then incomplete (sorted by status)
  return [...completed, ...incomplete]
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

// Helper to create entity group for analysis display
const getEntityGroupForAnalysis = (entityId: string) => {
  // Check if we already have analysis results for this entity
  const existingGroup = groupedEntities.value.find(g => g.entityId === entityId)
  if (existingGroup) {
    return existingGroup
  }
  
  // Create a placeholder group for entities being analyzed
  return {
    entityId,
    states: [],
    bestDiscrimination: 0,
    isNumeric: false,
    numericThresholds: undefined,
    correctedProbabilities: undefined
  }
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


.progress-header {
  text-align: center;
  margin-bottom: 1.5rem;
}

.spinner {
  width: 30px;
  height: 30px;
  margin: 0 auto 1rem;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #4CAF50;
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

/* Entity cards grid is used for both analysis and results */

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