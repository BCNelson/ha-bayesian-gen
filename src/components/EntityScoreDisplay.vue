<template>
  <n-card title="Entity Priority Scores" v-if="sortedEntities.length > 0">
    <template #header-extra>
      <n-space>
        <n-text depth="3">{{ filteredEntities.length }} of {{ sortedEntities.length }} entities</n-text>
        <n-button 
          size="small" 
          @click="showAll = !showAll"
          quaternary
        >
          {{ showAll ? 'Show Top 20' : 'Show All' }}
        </n-button>
      </n-space>
    </template>
    
    <n-space vertical>
      <n-input
        v-model:value="searchQuery"
        placeholder="🔍 Search entities by ID, domain, or state..."
        clearable
        :style="{ maxWidth: '400px' }"
      />
    
    <n-collapse>
      <n-collapse-item title="What do these scores mean?" name="explanation">
        <n-alert type="info" :show-icon="false">
          <n-text>Entities are scored based on:</n-text>
          <n-list>
            <n-list-item>
              <strong>Domain type:</strong> Binary sensors, switches, and lights score higher
            </n-list-item>
            <n-list-item>
              <strong>State type:</strong> Boolean states (on/off) are preferred for Bayesian analysis
            </n-list-item>
            <n-list-item>
              <strong>Recent activity:</strong> Recently changed entities score higher
            </n-list-item>
            <n-list-item>
              <strong>Rich attributes:</strong> Entities with meaningful attributes get bonus points
            </n-list-item>
            <n-list-item>
              <strong>Availability:</strong> Unavailable or unknown states reduce scores
            </n-list-item>
          </n-list>
          <n-divider />
          <n-text depth="3">Higher scoring entities will be analyzed first for better performance.</n-text>
        </n-alert>
      </n-collapse-item>
    </n-collapse>
    
      <n-data-table
        :columns="columns"
        :data="displayedEntities"
        :max-height="400"
        :scroll-x="800"
        striped
        size="small"
        :row-key="(row: any) => row.entityId"
      >
        <template #empty>
          <n-empty description="No entities match your search" />
        </template>
      </n-data-table>
    </n-space>
  </n-card>
</template>

<script setup lang="ts">
import { computed, ref, h } from 'vue'
import { 
  NCard, 
  NDataTable, 
  NText, 
  NTag, 
  NSpace,
  NButton,
  NCollapse,
  NCollapseItem,
  NAlert,
  NList,
  NListItem,
  NDivider,
  NEmpty,
  NInput,
  type DataTableColumns
} from 'naive-ui'
import type { HAEntity } from '../types/homeAssistant'
import { EntityScorer } from '../services/entityScorer'

const props = defineProps<{
  entities: HAEntity[]
}>()

const showAll = ref(false)
const searchQuery = ref('')
const scorer = new EntityScorer()

const sortedEntities = computed(() => {
  if (!props.entities || props.entities.length === 0) return []
  return scorer.scoreEntities(props.entities)
})

const filteredEntities = computed(() => {
  if (!searchQuery.value.trim()) return sortedEntities.value
  
  const query = searchQuery.value.toLowerCase().trim()
  return sortedEntities.value.filter(entity => {
    const entityId = entity.entityId.toLowerCase()
    const domain = entity.entityId.split('.')[0].toLowerCase()
    const reasons = entity.reasons.join(' ').toLowerCase()
    
    // Find the actual entity to get its state
    const haEntity = props.entities.find(e => e.entity_id === entity.entityId)
    const state = haEntity?.state?.toLowerCase() || ''
    
    return entityId.includes(query) || 
           domain.includes(query) || 
           state.includes(query) ||
           reasons.includes(query)
  })
})

const displayedEntities = computed(() => {
  const entities = filteredEntities.value
  return showAll.value ? entities : entities.slice(0, 20)
})

const getScoreType = (score: number) => {
  if (score >= 150) return 'success'
  if (score >= 100) return 'info'
  if (score >= 50) return 'warning'
  if (score >= 0) return 'default'
  return 'error'
}

const getDomainType = (domain: string) => {
  const highPriority = ['binary_sensor', 'switch', 'light', 'input_boolean']
  const mediumPriority = ['sensor', 'cover', 'lock', 'climate']
  
  if (highPriority.includes(domain)) return 'success'
  if (mediumPriority.includes(domain)) return 'info'
  return 'default'
}

const columns: DataTableColumns<any> = [
  {
    title: 'Rank',
    key: 'rank',
    width: 60,
    render: (_, index) => index + 1
  },
  {
    title: 'Entity ID',
    key: 'entityId',
    ellipsis: {
      tooltip: true
    },
    minWidth: 200
  },
  {
    title: 'Domain',
    key: 'domain',
    width: 100,
    render: (row) => {
      const domain = row.entityId.split('.')[0]
      return h(NTag, {
        type: getDomainType(domain),
        size: 'small'
      }, () => domain)
    }
  },
  {
    title: 'State',
    key: 'state',
    width: 100,
    ellipsis: {
      tooltip: true
    },
    render: (row) => {
      const haEntity = props.entities.find(e => e.entity_id === row.entityId)
      const state = haEntity?.state || 'unknown'
      const truncatedState = state.length > 12 ? state.substring(0, 9) + '...' : state
      return h(NTag, {
        size: 'small',
        type: 'default'
      }, () => truncatedState)
    }
  },
  {
    title: 'Score',
    key: 'score',
    width: 80,
    sorter: (a, b) => b.score - a.score,
    render: (row) => {
      return h(NTag, {
        type: getScoreType(row.score),
        round: true
      }, () => row.score)
    }
  },
  {
    title: 'Scoring Reasons',
    key: 'reasons',
    minWidth: 250,
    render: (row) => {
      return h(NSpace, { size: 'small', wrap: true }, () =>
        row.reasons.slice(0, 3).map((reason: string) =>
          h(NTag, { 
            size: 'small', 
            type: 'default'
          }, () => reason)
        )
      )
    }
  }
]
</script>

<style scoped>
:deep(.n-data-table) {
  font-size: 0.9em;
}

:deep(.n-tag) {
  font-size: 0.85em;
}
</style>