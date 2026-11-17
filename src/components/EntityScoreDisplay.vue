<template>
  <n-card title="Entity Scope & Priority" v-if="props.entities && props.entities.length > 0">
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
      <div class="scope-filter">
        <n-text strong>Limit analysis to</n-text>
        <div class="scope-grid">
          <n-select
            v-if="scopeOptions.floors.length > 0"
            :value="scopeModel.floors"
            :options="scopeOptions.floors"
            multiple
            filterable
            clearable
            placeholder="All floors"
            @update:value="(v: string[]) => updateScope('floors', v)"
          />
          <n-select
            :value="scopeModel.areas"
            :options="scopeOptions.areas"
            multiple
            filterable
            clearable
            placeholder="All areas"
            @update:value="(v: string[]) => updateScope('areas', v)"
          />
          <n-select
            v-if="scopeOptions.labels.length > 0"
            :value="scopeModel.labels"
            :options="scopeOptions.labels"
            multiple
            filterable
            clearable
            placeholder="All labels"
            @update:value="(v: string[]) => updateScope('labels', v)"
          />
          <n-select
            :value="scopeModel.domains"
            :options="scopeOptions.domains"
            multiple
            filterable
            clearable
            placeholder="All domains"
            @update:value="(v: string[]) => updateScope('domains', v)"
          />
        </div>
        <n-text depth="3">
          {{ scopedEntities.length }} of {{ props.entities.length }} entities match;
          {{ sortedEntities.length }} will be analyzed
          (disabled, hidden, config/diagnostic and unavailable entities are skipped).
        </n-text>
      </div>

      <n-input
        v-model:value="searchQuery"
        placeholder="Search entities by ID, name, area, domain, or state..."
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
              <strong>Metadata:</strong> Entities with a device class or an assigned area get a small bonus
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
  NSelect,
  type SelectOption,
  type DataTableColumns
} from 'naive-ui'
import type { EntityScope, EntityScopeOptions, HAEntity } from '../types/homeAssistant'
import { EntityScorer } from '../services/entityScorer'
import { EMPTY_SCOPE, filterByScope } from '../services/haRegistries'

const props = defineProps<{
  entities: HAEntity[]
  scope?: EntityScope
  scopeOptions?: EntityScopeOptions
}>()

const emit = defineEmits<{
  'update:scope': [scope: EntityScope]
}>()

const scopeModel = computed<EntityScope>(() => props.scope ?? EMPTY_SCOPE)
const scopeOptions = computed<Record<keyof EntityScopeOptions, SelectOption[]>>(() => {
  const o = props.scopeOptions
  return {
    areas: (o?.areas ?? []) as SelectOption[],
    floors: (o?.floors ?? []) as SelectOption[],
    labels: (o?.labels ?? []) as SelectOption[],
    domains: (o?.domains ?? []) as SelectOption[]
  }
})
const updateScope = (key: keyof EntityScope, value: string[] | null) => {
  emit('update:scope', { ...scopeModel.value, [key]: value ?? [] })
}

const entityById = computed(() => new Map(props.entities.map(e => [e.entity_id, e])))
const scopedEntities = computed(() => filterByScope(props.entities ?? [], scopeModel.value))

const showAll = ref(false)
const searchQuery = ref('')
const scorer = new EntityScorer()

const sortedEntities = computed(() => {
  if (!props.entities || props.entities.length === 0) return []
  return scorer.scoreEntities(scorer.filterRelevantEntities(scopedEntities.value))
})

const filteredEntities = computed(() => {
  if (!searchQuery.value.trim()) return sortedEntities.value
  
  const query = searchQuery.value.toLowerCase().trim()
  return sortedEntities.value.filter(entity => {
    const entityId = entity.entityId.toLowerCase()
    const domain = entity.entityId.split('.')[0].toLowerCase()
    const reasons = entity.reasons.join(' ').toLowerCase()
    
    const haEntity = entityById.value.get(entity.entityId)
    const state = haEntity?.state?.toLowerCase() || ''
    const name = haEntity?.meta?.name?.toLowerCase() || ''
    const area = haEntity?.meta?.area_name?.toLowerCase() || ''
    
    return entityId.includes(query) || 
           name.includes(query) ||
           area.includes(query) ||
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
    title: 'Name',
    key: 'name',
    ellipsis: { tooltip: true },
    minWidth: 160,
    render: (row) => entityById.value.get(row.entityId)?.meta?.name ?? ''
  },
  {
    title: 'Area',
    key: 'area',
    width: 120,
    ellipsis: { tooltip: true },
    render: (row) => entityById.value.get(row.entityId)?.meta?.area_name ?? ''
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
      const haEntity = entityById.value.get(row.entityId)
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
.scope-filter {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scope-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}

:deep(.n-data-table) {
  font-size: 0.9em;
}

:deep(.n-tag) {
  font-size: 0.85em;
}
</style>