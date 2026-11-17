<template>
  <div class="generator">
    <p class="generator-intro">
      Use an existing entity as ground truth. Periods where it matched become
      <strong class="txt-true">TRUE</strong>, everything else (except unknown/unavailable) becomes
      <strong class="txt-false">FALSE</strong>.
    </p>

    <n-alert v-if="!haApi" type="info" :show-icon="false">
      Connect to Home Assistant to generate periods from an entity's history.
    </n-alert>

    <template v-else>
      <div class="form-grid">
        <n-form-item label="Entity" class="span-2" :show-feedback="false">
          <n-select
            v-model:value="settings.entityId"
            :options="entityOptions"
            filterable
            clearable
            placeholder="e.g. input_boolean.sleeping"
          />
        </n-form-item>

        <n-form-item label="Lookback" :show-feedback="false">
          <n-input-number v-model:value="settings.lookbackDays" :min="1" :max="90" :step="1">
            <template #suffix>days</template>
          </n-input-number>
        </n-form-item>

        <n-form-item label="Match" :show-feedback="false">
          <n-radio-group v-model:value="settings.matchMode" size="small">
            <n-radio-button value="state">State</n-radio-button>
            <n-radio-button value="numeric">Numeric</n-radio-button>
          </n-radio-group>
        </n-form-item>

        <n-form-item v-if="settings.matchMode === 'state'" label="TRUE when state is" class="span-2" :show-feedback="false">
          <n-select
            v-model:value="settings.states"
            :options="stateOptions"
            multiple
            filterable
            tag
            placeholder="Pick or type states (e.g. on, home)"
          />
        </n-form-item>

        <template v-else>
          <n-form-item label="TRUE when above" :show-feedback="false">
            <n-input-number v-model:value="settings.above" clearable placeholder="none" />
          </n-form-item>
          <n-form-item label="and below" :show-feedback="false">
            <n-input-number v-model:value="settings.below" clearable placeholder="none" />
          </n-form-item>
        </template>

        <n-form-item label="Ignore periods shorter than" :show-feedback="false">
          <n-input-number v-model:value="settings.minDurationMinutes" :min="0" :step="5">
            <template #suffix>min</template>
          </n-input-number>
        </n-form-item>

        <n-form-item label="Trim around transitions" :show-feedback="false">
          <n-input-number v-model:value="settings.bufferMinutes" :min="0" :step="5">
            <template #suffix>min</template>
          </n-input-number>
        </n-form-item>
      </div>

      <div class="fetch-row">
        <n-button :loading="loading" :disabled="!settings.entityId" @click="fetchHistory">
          {{ history ? 'Reload history' : 'Load history' }}
        </n-button>
        <n-text v-if="history && fetchedFor" depth="3">
          {{ history.length }} state changes for {{ fetchedFor }}
        </n-text>
        <n-text v-if="error" type="error">{{ error }}</n-text>
      </div>

      <GeneratorPreview
        v-if="history"
        :summary="summary"
        :existing-count="existingCount"
        @apply="apply"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, shallowRef, onBeforeUnmount } from 'vue'
import {
  NAlert,
  NButton,
  NFormItem,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NText
} from 'naive-ui'
import GeneratorPreview from './GeneratorPreview.vue'
import type { TimePeriod } from '../../types/bayesian'
import type { HAEntity } from '../../types/homeAssistant'
import {
  generateFromHistory,
  lookbackRange,
  summarize,
  toTimePeriods,
  type HistoryPoint,
  type Span,
  type StateMatcher
} from '../../utils/periodGenerators'
import { STORAGE_KEYS, readSettings, writeJSON } from '../../utils/sessionStore'

export interface HistoryApi {
  getHistory(
    startTime: Date,
    endTime: Date | undefined,
    entityIds: string[]
  ): Promise<Record<string, HistoryPoint[]>>
}

const props = defineProps<{
  haApi: HistoryApi | null
  entities: Pick<HAEntity, 'entity_id' | 'state' | 'attributes'>[]
  existingCount: number
}>()

const emit = defineEmits<{
  apply: [periods: TimePeriod[], replace: boolean]
}>()

interface EntityGeneratorSettings {
  entityId: string | null
  lookbackDays: number
  matchMode: 'state' | 'numeric'
  states: string[]
  above: number | null
  below: number | null
  minDurationMinutes: number
  bufferMinutes: number
}

const settings = ref<EntityGeneratorSettings>(
  readSettings<EntityGeneratorSettings>(STORAGE_KEYS.entityGenerator, {
    entityId: null,
    lookbackDays: 14,
    matchMode: 'state',
    states: ['on'],
    above: null,
    below: null,
    minDurationMinutes: 0,
    bufferMinutes: 0
  })
)

watch(settings, value => writeJSON(STORAGE_KEYS.entityGenerator, value), { deep: true })

const history = shallowRef<HistoryPoint[] | null>(null)
const fetchedRange = ref<Span | null>(null)
const fetchedFor = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const entityOptions = computed(() =>
  [...props.entities]
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
    .map(e => {
      const name = e.attributes?.friendly_name
      return { label: name ? `${name} (${e.entity_id})` : e.entity_id, value: e.entity_id }
    })
)

const stateOptions = computed(() => {
  const states = new Set<string>()
  history.value?.forEach(h => states.add(h.state))
  const current = props.entities.find(e => e.entity_id === settings.value.entityId)
  if (current) states.add(current.state)
  settings.value.states.forEach(s => states.add(s))
  states.delete('unavailable')
  states.delete('unknown')
  return [...states].sort().map(s => ({ label: s, value: s }))
})

const matcher = computed<StateMatcher>(() =>
  settings.value.matchMode === 'state'
    ? { kind: 'state', states: settings.value.states }
    : {
        kind: 'numeric',
        above: settings.value.above ?? undefined,
        below: settings.value.below ?? undefined
      }
)

const generated = computed(() => {
  if (!history.value || !fetchedRange.value) return { trueSpans: [], falseSpans: [] }
  return generateFromHistory(history.value, {
    matcher: matcher.value,
    range: fetchedRange.value,
    minDurationMinutes: settings.value.minDurationMinutes ?? 0,
    bufferMinutes: settings.value.bufferMinutes ?? 0
  })
})

const summary = computed(() => summarize(generated.value))

let fetchSeq = 0
const fetchHistory = async () => {
  const entityId = settings.value.entityId
  if (!props.haApi || !entityId) return
  const seq = ++fetchSeq
  loading.value = true
  error.value = null
  try {
    const range = lookbackRange(settings.value.lookbackDays || 14)
    const response = await props.haApi.getHistory(new Date(range.start), new Date(range.end), [entityId])
    if (seq !== fetchSeq) return
    history.value = response[entityId] ?? []
    fetchedRange.value = range
    fetchedFor.value = entityId
    if (history.value.length === 0) {
      error.value = 'No history returned for this entity in the selected range.'
    }
  } catch (e) {
    if (seq !== fetchSeq) return
    history.value = null
    error.value = e instanceof Error ? e.message : 'Failed to fetch history'
  } finally {
    if (seq === fetchSeq) loading.value = false
  }
}

// Refetch (debounced) when the entity or lookback changes
let refetchTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [settings.value.entityId, settings.value.lookbackDays, !!props.haApi] as const,
  ([entityId, , hasApi], old) => {
    if (old && old[0] && old[0] !== entityId && settings.value.matchMode === 'state') {
      // States of the previous entity rarely make sense for the new one
      settings.value.states = []
    }
    clearTimeout(refetchTimer)
    if (!entityId) {
      history.value = null
      return
    }
    if (!hasApi) return
    refetchTimer = setTimeout(fetchHistory, 400)
  },
  { immediate: true }
)

onBeforeUnmount(() => clearTimeout(refetchTimer))

const apply = (replace: boolean) => {
  const label = fetchedFor.value ?? 'Entity'
  emit('apply', toTimePeriods(generated.value, label), replace)
}
</script>

