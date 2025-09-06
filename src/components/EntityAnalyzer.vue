<template>
  <n-space vertical size="large">
    <!-- Unified Analysis Status Card -->
    <n-card v-if="isAnalyzing || analyzedEntities.length > 0" style="margin-bottom: 1rem">
      <template #header>
        <n-space justify="space-between" align="center">
          <n-text strong>Analysis Status</n-text>
          <n-button 
            v-if="pendingEntityStatusMap.size > 0"
            size="small" 
            @click="showProcessingQueue = !showProcessingQueue"
            :type="showProcessingQueue ? 'primary' : 'default'"
          >
            {{ showProcessingQueue ? 'Hide' : 'Show' }} Queue ({{ pendingEntityStatusMap.size }})
          </n-button>
        </n-space>
      </template>
      
      <!-- Progress Bar -->
      <n-progress
        v-if="analysisProgress.total > 0"
        type="line"
        :percentage="Math.round((analysisProgress.current / analysisProgress.total) * 100)"
        :indicator-placement="'inside'"
        style="margin-bottom: 1rem"
      />
      
      <!-- Status Summary -->
      <n-space vertical size="small">
        <n-space align="center">
          <n-spin v-if="isAnalyzing" size="small" />
          <n-text>
            <template v-if="isAnalyzing">
              Processing {{ analysisProgress.current }} / {{ analysisProgress.total }} entities
              <span v-if="analysisProgress.currentEntity"> • Current: {{ analysisProgress.currentEntity }}</span>
            </template>
            <template v-else-if="analyzedEntities.length > 0">
              Analyzed {{ totalEntities }} entities across {{ periods.length }} time periods
            </template>
          </n-text>
        </n-space>
        
        <n-text v-if="analyzedEntities.length > 0">
          Found <n-text strong>{{ groupedEntities.length }}</n-text> entities with 
          <n-text strong>{{ analyzedEntities.length }}</n-text> total state combinations
        </n-text>
      </n-space>
      
      <!-- Expandable Processing Queue -->
      <n-collapse-transition v-if="pendingEntityStatusMap.size > 0" :show="showProcessingQueue">
        <n-divider style="margin: 1rem 0 0.5rem 0" />
        <n-text depth="3" style="display: block; margin-bottom: 0.5rem">Processing Queue:</n-text>
        <n-grid :cols="3" :x-gap="8" :y-gap="8" responsive="screen" style="max-height: 200px; overflow-y: auto">
          <n-grid-item 
            v-for="[entityId, status] in pendingEntityStatusMap" 
            :key="entityId"
            :span="1"
          >
            <n-tag
              :type="getStatusType(status.status)"
              style="width: 100%"
            >
              <n-ellipsis style="max-width: 150px">
                {{ entityId }}
              </n-ellipsis>
              <template #icon>
                <n-text depth="3" style="margin-left: 0.5rem">
                  {{ status.status }}
                </n-text>
              </template>
            </n-tag>
          </n-grid-item>
        </n-grid>
      </n-collapse-transition>
    </n-card>

    <div v-if="isAnalyzing">
      
      <!-- Filter controls available during analysis -->
      <n-space v-if="analyzedEntities.length > 0" style="margin-bottom: 1.5rem">
        <n-input
          v-model:value="searchFilter"
          placeholder="Filter entities..."
          clearable
          style="flex: 1"
        />
        <n-select
          v-model:value="minDiscrimination"
          :options="discriminationOptions"
          style="width: 200px"
        />
      </n-space>
      
      <!-- Show analyzed entities as they come in -->
      <div v-if="filteredEntities.length > 0" class="entity-cards">
        <EntityCard
          v-for="group in filteredEntities"
          :key="group.entityId"
          :group="group"
          :selected-entities="selectedEntities"
          @toggle-selection="toggleEntitySelection"
        />
      </div>
    </div>
    
    <n-alert v-else-if="error" type="error" class="error-alert">
      {{ error }}
    </n-alert>
    
    <div v-else-if="!isAnalyzing && analyzedEntities.length > 0" class="entity-cards">
        <EntityCard
          v-for="group in filteredEntities"
          :key="group.entityId"
          :group="group"
          :selected-entities="selectedEntities"
          @toggle-selection="toggleEntitySelection"
        />
    </div>
    
    <!-- Compact Action Bar -->
    <div v-if="analyzedEntities.length > 0 && !isAnalyzing" class="action-bar">
      <div class="selection-buttons">
        <n-button @click="selectTop(5)" size="small">Top 5</n-button>
        <n-button @click="selectTop(10)" size="small" type="info">Top 10</n-button>
        <n-button @click="selectTop(20)" size="small">Top 20</n-button>
        <n-button @click="selectAll" size="small">All</n-button>
        <n-button @click="selectNone" size="small">Clear</n-button>
      </div>
      <div class="generate-section">
        <n-text v-if="selectedEntities.length > 0" style="margin-right: 1rem">
          <strong>{{ selectedEntities.length }}</strong> selected
        </n-text>
        <n-button 
          @click="generateConfig" 
          type="primary"
          size="small"
          :disabled="selectedEntities.length === 0"
        >
          Generate Config
        </n-button>
      </div>
    </div>
    
    <n-empty v-else description="No analysis results yet" class="empty-state">
      <template #extra>
        <n-ol>
          <n-li>Connect to Home Assistant</n-li>
          <n-li>Add at least one TRUE and one FALSE time period</n-li>
          <n-li>Click "Analyze Entities"</n-li>
        </n-ol>
      </template>
    </n-empty>
  </n-space>
</template>

<script setup lang="ts">
import { ref, computed, watch, shallowRef } from 'vue'
import { 
  NSpace, 
  NCard, 
  NAlert, 
  NText, 
  NButton,
  NInput,
  NSelect,
  NProgress,
  NSpin,
  NEmpty,
  NGrid,
  NGridItem,
  NTag,
  NEllipsis,
  NOl,
  NLi,
  NCollapseTransition,
  NDivider
} from 'naive-ui'
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
const selectedEntities = shallowRef<EntityProbability[]>([])
const showProcessingQueue = ref(false)

const discriminationOptions = [
  { label: 'All discrimination levels', value: 0 },
  { label: 'Min 10% difference', value: 0.1 },
  { label: 'Min 30% difference', value: 0.3 },
  { label: 'Min 50% difference', value: 0.5 },
  { label: 'Min 70% difference', value: 0.7 }
]

const getStatusType = (status: string) => {
  switch (status) {
    case 'analyzing': return 'success'
    case 'fetching': return 'info'
    case 'fetched': return 'warning'
    case 'error': return 'error'
    default: return 'default'
  }
}

const groupedEntities = computed(() => {
  // Use a regular Map for better performance in computed
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

// Separate pending entities that haven't been analyzed yet
const pendingEntityStatusMap = computed(() => {
  const entries = Array.from(props.entityStatusMap.entries())
  const incomplete: Array<[string, any]> = []
  
  entries.forEach(([entityId, status]) => {
    if (status.status !== 'completed' && status.status !== 'error') {
      incomplete.push([entityId, status])
    }
  })
  
  // Sort by status priority (processing order)
  const statusPriority: Record<string, number> = {
    'analyzing': 1,
    'fetched': 2,
    'fetching': 3,
    'queued': 4
  }
  
  incomplete.sort((a, b) => {
    const priorityA = statusPriority[a[1].status] || 99
    const priorityB = statusPriority[b[1].status] || 99
    return priorityA - priorityB
  })
  
  return new Map(incomplete)
})

watch(() => props.isAnalyzing, (isAnalyzing, wasAnalyzing) => {
  // Only auto-select when analysis completes (goes from true to false)
  // and only if user hasn't manually selected any entities
  if (wasAnalyzing && !isAnalyzing && selectedEntities.value.length === 0 && props.analyzedEntities.length > 0) {
    const topEntities = props.analyzedEntities
      .sort((a, b) => b.discriminationPower - a.discriminationPower)
      .slice(0, 10)
    
    selectedEntities.value = topEntities
    emit('entitiesSelected', selectedEntities.value)
  }
})


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
.analyzer-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 0.75rem;
  overflow: hidden;
}

.status-bar {
  background: #ffffff;
  border-radius: 6px;
  padding: 0.75rem;
  border: 1px solid #dee2e6;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

.status-content {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.status-text {
  display: flex;
  align-items: center;
  flex: 1;
}

.current-entity {
  color: #495057;
  margin-left: 0.5rem;
  font-weight: 500;
}

.queue-container {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #dee2e6;
  max-height: 120px;
  overflow-y: auto;
}

.filter-bar {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.5rem;
  background: white;
  border-radius: 4px;
  border: 1px solid #dee2e6;
  box-shadow: 0 1px 2px rgba(0,0,0,0.03);
}

.entity-cards-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0.5rem;
  min-height: 0;
}

.entity-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 0.75rem;
}

.update-message {
  display: block;
  text-align: center;
  margin-top: 0.5rem;
  font-size: 0.85rem;
}

.error-alert {
  margin-top: 0.5rem;
}

.action-bar {
  display: flex;
  justify-content: center;
  gap: 1rem;
  padding: 0.75rem;
  background: #ffffff;
  border-radius: 6px;
  border: 1px solid #dee2e6;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

.selection-buttons {
  display: flex;
  gap: 0.5rem;
}

.generate-section {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
}

@media (max-width: 768px) {
  .entity-cards {
    grid-template-columns: 1fr;
  }
  
  .status-content {
    flex-wrap: wrap;
  }
  
  .filter-bar {
    flex-direction: column;
    align-items: stretch;
  }
  
  .filter-bar .n-input,
  .filter-bar .n-select {
    max-width: 100% !important;
    width: 100% !important;
  }
}

@media (min-width: 1600px) {
  .entity-cards {
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  }
}
</style>