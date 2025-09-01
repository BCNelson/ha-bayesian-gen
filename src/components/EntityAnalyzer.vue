<template>
  <n-space vertical size="large">
    <div v-if="isAnalyzing">
      <n-space vertical align="center">
        <n-spin size="large" />
        <n-text>Analyzing entity states across time periods...</n-text>
      </n-space>
      
      <n-progress
        v-if="analysisProgress.total > 0"
        type="line"
        :percentage="Math.round((analysisProgress.current / analysisProgress.total) * 100)"
        :show-indicator="false"
        style="margin: 1rem 0"
      />
      
      <n-space justify="center" style="margin-bottom: 1rem">
        <n-text depth="3">
          Processing {{ analysisProgress.current }} / {{ analysisProgress.total }} entities
        </n-text>
      </n-space>
      
      <n-text 
        v-if="analysisProgress.currentEntity" 
        depth="3"
        tag="div"
        style="text-align: center; font-family: monospace; font-size: 0.9rem"
      >
        Current: {{ analysisProgress.currentEntity }}
      </n-text>
      
      <!-- Show completed results immediately during analysis -->
      <n-alert 
        v-if="analyzedEntities.length > 0" 
        type="info"
        style="margin: 1.5rem 0"
      >
        <n-text>Found </n-text>
        <n-text strong>{{ analyzedEntities.length }}</n-text>
        <n-text> state combinations from </n-text>
        <n-text strong>{{ analysisProgress.current }}</n-text>
        <n-text> completed entities</n-text>
        <br />
        <n-text italic depth="3">Results appear as entities are analyzed. Analysis continues in the background...</n-text>
      </n-alert>
      
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
      
      <!-- Show status cards for entities not yet analyzed -->
      <n-card v-if="pendingEntityStatusMap.size > 0" title="Processing Queue" style="margin-top: 2rem">
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
      </n-card>
    </div>
    
    <n-alert v-else-if="error" type="error">
      {{ error }}
    </n-alert>
    
    <div v-else-if="analyzedEntities.length > 0">
      <n-alert type="info" style="margin-bottom: 1.5rem">
        <n-text>Analyzed </n-text>
        <n-text strong>{{ totalEntities }}</n-text>
        <n-text> entities across </n-text>
        <n-text strong>{{ periods.length }}</n-text>
        <n-text> time periods</n-text>
        <br />
        <n-text>Found </n-text>
        <n-text strong>{{ groupedEntities.length }}</n-text>
        <n-text> entities with </n-text>
        <n-text strong>{{ analyzedEntities.length }}</n-text>
        <n-text> total state combinations</n-text>
        <br />
        <n-text italic depth="3">Entities are grouped by ID. Each entity may have multiple states that behave differently during your TRUE/FALSE periods.</n-text>
      </n-alert>
      
      <n-space style="margin-bottom: 1.5rem">
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
      
      <div class="entity-cards">
        <EntityCard
          v-for="group in filteredEntities"
          :key="group.entityId"
          :group="group"
          :selected-entities="selectedEntities"
          @toggle-selection="toggleEntitySelection"
        />
      </div>
      
      <n-card style="margin-top: 2rem">
        <template #header>
          <n-text strong>Select Entities for Bayesian Configuration</n-text>
        </template>
        <n-text depth="3" style="display: block; margin-bottom: 1.5rem">
          Click on entities above or use the buttons below to select which entities to include in your final Bayesian sensor configuration.
        </n-text>
        
        <n-space style="margin-bottom: 1.5rem">
          <n-button @click="selectTop(5)">Select Top 5</n-button>
          <n-button @click="selectTop(10)" type="info">Select Top 10 (Recommended)</n-button>
          <n-button @click="selectTop(20)">Select Top 20</n-button>
          <n-button @click="selectAll">Select All Visible</n-button>
          <n-button @click="selectNone">Clear Selection</n-button>
        </n-space>
        
        <n-alert 
          v-if="selectedEntities.length > 0" 
          type="success"
          style="text-align: center"
        >
          <n-text strong>{{ selectedEntities.length }}</n-text>
          <n-text> entities selected for configuration</n-text>
          <br />
          <n-button 
            @click="generateConfig" 
            type="primary"
            size="large"
            style="margin-top: 1rem"
          >
            Generate Bayesian Configuration
          </n-button>
        </n-alert>
      </n-card>
    </div>
    
    <n-empty v-else description="No analysis results yet">
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
  NLi
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

  // DEBUG: Log calculations for target entity
  const targetEntity = 'sensor.0xe406bffffe000eea_pm25'
  if (entity.entityId === targetEntity) {
    console.log(`UI CORRECTED PROB DEBUG - ${targetEntity}:`, {
      rawProbGivenTrue: probGivenTrue,
      rawProbGivenFalse: probGivenFalse,
      clampedProbGivenTrue: Math.min(0.99, Math.max(0.01, probGivenTrue)),
      clampedProbGivenFalse: Math.min(0.99, Math.max(0.01, probGivenFalse)),
      originalEntityProbTrue: entity.probGivenTrue,
      originalEntityProbFalse: entity.probGivenFalse
    })
  }

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
.entity-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 1.5rem;
}

@media (max-width: 768px) {
  .entity-cards {
    grid-template-columns: 1fr;
  }
}
</style>