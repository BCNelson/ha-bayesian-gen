<template>
  <div class="config-output">
    <n-empty v-if="!config || !currentConfig" description="No sensor configuration yet" class="config-empty">
      <template #extra>
        <n-text depth="3">Tick entities in the list to build the sensor. The output updates as you go.</n-text>
      </template>
    </n-empty>

    <template v-else>
      <n-card size="small" class="settings-card">
        <n-grid cols="1 480:2 820:4" :x-gap="12" :y-gap="4" responsive="self">
          <n-form-item-gi label="Sensor name" :show-feedback="false">
            <n-input v-model:value="sensorName" @update:value="updateConfig" />
          </n-form-item-gi>

          <n-form-item-gi label="Prior" :show-feedback="false">
            <n-input-number
              v-model:value="prior"
              :min="0.01"
              :max="0.99"
              :step="0.01"
              @update:value="updateConfig"
            />
          </n-form-item-gi>

          <n-form-item-gi label="Probability threshold" :show-feedback="false">
            <n-input-number
              v-model:value="threshold"
              :min="0.01"
              :max="0.99"
              :step="0.01"
              @update:value="updateConfig"
            />
          </n-form-item-gi>

          <n-form-item-gi label="Max observations" :show-feedback="false">
            <n-select
              v-model:value="maxObservations"
              :options="maxObsOptions"
              @update:value="updateConfig"
            />
          </n-form-item-gi>
        </n-grid>

        <n-space size="small" class="summary-tags">
          <n-tag size="small" type="info" :bordered="false">{{ currentConfig.observations.length }} observations</n-tag>
          <n-tag size="small" type="success" :bordered="false">Discrimination {{ discriminationRange }}</n-tag>
          <n-tag v-if="warnings.length" size="small" type="warning" :bordered="false">
            {{ warnings.length }} warning{{ warnings.length === 1 ? '' : 's' }}
          </n-tag>
        </n-space>
      </n-card>

      <n-alert v-if="warnings.length" type="warning" title="Check these observations" class="warnings">
        <ul class="warning-list">
          <li v-for="(w, i) in warnings" :key="i">{{ w.message }}</li>
        </ul>
      </n-alert>

      <n-tabs v-model:value="outputTab" type="segment" size="small" animated class="output-tabs">
        <!-- YAML -->
        <n-tab-pane name="yaml" tab="YAML">
          <div class="pane-actions">
            <n-button type="primary" size="small" @click="copyToClipboard">{{ copyText }}</n-button>
            <n-button size="small" @click="downloadConfig">Download .yaml</n-button>
          </div>
          <p class="pane-hint">
            Paste into <n-text code>configuration.yaml</n-text>. If you already have a
            <n-text code>binary_sensor:</n-text> section, add only the list entry under it. Restart Home Assistant
            (or reload YAML) afterwards.
          </p>
          <div class="code-block">
            <pre class="yaml-pre"><code>{{ yamlOutput }}</code></pre>
          </div>
        </n-tab-pane>

        <!-- UI setup -->
        <n-tab-pane name="ui" tab="UI setup">
          <div class="pane-actions">
            <a
              class="my-ha-button"
              :href="MY_HA_URL"
              target="_blank"
              rel="noopener noreferrer"
            >
              Add Bayesian helper to my Home Assistant
            </a>
          </div>
          <ol class="ui-steps">
            <li>
              Open the link above (or <em>Settings → Devices &amp; services → Helpers → Create helper → Bayesian</em>).
            </li>
            <li>
              Name: <n-text code>{{ currentConfig.name }}</n-text>, prior
              <n-text code>{{ toPercent(currentConfig.prior) }}%</n-text>, probability threshold
              <n-text code>{{ toPercent(currentConfig.probability_threshold) }}%</n-text>.
            </li>
            <li>Add each observation below. The UI uses percentages (0–100); YAML uses 0–1.</li>
          </ol>

          <div class="observation-list">
            <div
              v-for="(obs, index) in currentConfig.observations"
              :key="`${obs.entity_id}-${obs.to_state ?? ''}-${index}`"
              class="observation-row"
              :class="{ flagged: flaggedIndexes.has(index) }"
            >
              <div class="obs-head">
                <n-tag size="tiny" :bordered="false">{{ obsTypeLabel(obs.platform) }}</n-tag>
                <span class="obs-entity">{{ obs.entity_id }}</span>
                <n-button size="tiny" quaternary @click="copyValue(obs.entity_id)">Copy</n-button>
              </div>
              <div class="obs-fields">
                <div v-if="obs.to_state !== undefined" class="obs-field">
                  <span class="field-label">To state</span>
                  <span class="field-value">{{ obs.to_state }}</span>
                  <n-button size="tiny" quaternary @click="copyValue(obs.to_state)">Copy</n-button>
                </div>
                <div v-if="obs.above !== undefined" class="obs-field">
                  <span class="field-label">Above</span>
                  <span class="field-value">{{ obs.above }}</span>
                  <n-button size="tiny" quaternary @click="copyValue(String(obs.above))">Copy</n-button>
                </div>
                <div v-if="obs.below !== undefined" class="obs-field">
                  <span class="field-label">Below</span>
                  <span class="field-value">{{ obs.below }}</span>
                  <n-button size="tiny" quaternary @click="copyValue(String(obs.below))">Copy</n-button>
                </div>
                <div class="obs-field">
                  <span class="field-label">Probability when ON</span>
                  <span class="field-value txt-true">{{ toPercent(obs.prob_given_true) }}%</span>
                  <n-button size="tiny" quaternary @click="copyValue(toPercent(obs.prob_given_true))">Copy</n-button>
                </div>
                <div class="obs-field">
                  <span class="field-label">Probability when OFF</span>
                  <span class="field-value txt-false">{{ toPercent(obs.prob_given_false) }}%</span>
                  <n-button size="tiny" quaternary @click="copyValue(toPercent(obs.prob_given_false))">Copy</n-button>
                </div>
              </div>
            </div>
          </div>
        </n-tab-pane>

        <!-- Simulation -->
        <n-tab-pane name="simulation" tab="Simulation">
          <BayesianSimulator
            :config="currentConfig"
            :cached-historical-data="cachedHistoricalData"
            :entity-buffer="entityBuffer"
            :entity-status-map="entityStatusMap"
            :periods="periods"
          />
        </n-tab-pane>
      </n-tabs>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { stringify as yamlStringify } from 'yaml'
import {
  NSpace,
  NCard,
  NButton,
  NInput,
  NInputNumber,
  NSelect,
  NEmpty,
  NText,
  NTag,
  NGrid,
  NFormItemGi,
  NAlert,
  NTabs,
  NTabPane,
  useMessage
} from 'naive-ui'
import BayesianSimulator from './BayesianSimulator.vue'
import { limitObservationsByEntity } from '../services/configGenerator'
import type { BayesianSensorConfig, EntityProbability } from '../types/bayesian'
import { findObservationWarnings, toPercent } from '../utils/observationWarnings'

const props = defineProps<{
  config: BayesianSensorConfig | null
  entityProbabilities: EntityProbability[]
  haConnection: any
  cachedHistoricalData: Map<string, any[]>
  entityBuffer?: any // NEW: Buffer for high-performance simulation
  entityStatusMap?: Map<string, { status: string; message?: string }> // Entity analysis status
  periods?: any[] // Time periods for desired state
}>()

const emit = defineEmits<{
  configUpdated: [config: BayesianSensorConfig]
}>()

// my.home-assistant.io redirect that starts the Bayesian config flow
const MY_HA_URL = 'https://my.home-assistant.io/redirect/config_flow_start/?domain=bayesian'

const message = useMessage()

const sensorName = ref('Bayesian Sensor')
const prior = ref(0.5)
const threshold = ref(0.5)
const maxObservations = ref(0) // 0 = all selected
const copyText = ref('Copy YAML')
const outputTab = ref<'yaml' | 'ui' | 'simulation'>('yaml')

const maxObsOptions = [
  { label: 'All selected', value: 0 },
  { label: 'Top 5', value: 5 },
  { label: 'Top 10', value: 10 },
  { label: 'Top 15', value: 15 },
  { label: 'Top 20', value: 20 }
]

const currentConfig = computed(() => {
  if (!props.config) return null

  return {
    ...props.config,
    name: sensorName.value,
    prior: prior.value,
    probability_threshold: threshold.value,
    observations: maxObservations.value
      ? limitObservationsByEntity(props.config.observations, maxObservations.value)
      : props.config.observations
  }
})

const warnings = computed(() => (currentConfig.value ? findObservationWarnings(currentConfig.value.observations) : []))
const flaggedIndexes = computed(() => new Set(warnings.value.flatMap(w => w.indexes)))

const obsTypeLabel = (platform: string) =>
  platform === 'numeric_state' ? 'Numeric state' : platform === 'template' ? 'Template' : 'State'

const yamlOutput = computed(() => {
  if (!currentConfig.value) return ''

  // Create a clean config object for YAML output
  const cleanConfig = {
    platform: currentConfig.value.platform,
    name: currentConfig.value.name,
    unique_id: currentConfig.value.unique_id,
    prior: currentConfig.value.prior,
    probability_threshold: currentConfig.value.probability_threshold,
    observations: currentConfig.value.observations.map(obs => {
      const cleanObs: any = {
        platform: obs.platform,
        entity_id: obs.entity_id,
        prob_given_true: obs.prob_given_true,
        prob_given_false: obs.prob_given_false
      }

      // Only add optional fields if they exist
      if (obs.to_state) cleanObs.to_state = obs.to_state
      if (obs.above !== undefined) cleanObs.above = obs.above
      if (obs.below !== undefined) cleanObs.below = obs.below
      if (obs.value_template) cleanObs.value_template = obs.value_template

      return cleanObs
    })
  }

  return yamlStringify({
    binary_sensor: [cleanConfig]
  }, {
    indent: 2,
    lineWidth: 80
  })
})

const discriminationRange = computed(() => {
  if (!props.entityProbabilities || props.entityProbabilities.length === 0) return 'N/A'

  const topEntities = props.entityProbabilities.slice(0, maxObservations.value || undefined)
  const min = Math.min(...topEntities.map(e => e.discriminationPower))
  const max = Math.max(...topEntities.map(e => e.discriminationPower))

  return `${(min * 100).toFixed(1)}% - ${(max * 100).toFixed(1)}%`
})

watch(() => props.config, (newConfig) => {
  if (newConfig) {
    sensorName.value = newConfig.name
    prior.value = newConfig.prior
    threshold.value = newConfig.probability_threshold
  }
}, { immediate: true })

const updateConfig = () => {
  if (!currentConfig.value) return
  emit('configUpdated', currentConfig.value)
}

const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(yamlOutput.value)
    copyText.value = 'Copied!'
    message.success('Configuration copied to clipboard!')
    setTimeout(() => {
      copyText.value = 'Copy YAML'
    }, 2000)
  } catch (error) {
    console.error('Failed to copy to clipboard:', error)
    message.error('Failed to copy to clipboard')
    copyText.value = 'Copy YAML'
  }
}

const copyValue = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value)
    message.success(`Copied ${value}`)
  } catch {
    message.error('Failed to copy to clipboard')
  }
}

const downloadConfig = () => {
  const blob = new Blob([yamlOutput.value], { type: 'text/yaml' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sensorName.value.toLowerCase().replace(/\s+/g, '_')}_bayesian_config.yaml`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  message.success('Configuration downloaded!')
}
</script>

<style scoped>
.config-output {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.config-empty {
  padding: 3rem 1rem;
}

.summary-tags {
  margin-top: 0.5rem;
}

.warning-list {
  margin: 0;
  padding-left: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.pane-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.5rem 0;
}

.pane-hint {
  color: var(--app-text-2);
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.code-block {
  border: 1px solid var(--app-border);
  border-radius: 6px;
  padding: 0.5rem;
  background: var(--app-surface-muted);
  overflow-x: auto;
}

.yaml-pre {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--app-text);
  white-space: pre;
}

.my-ha-button {
  display: inline-flex;
  align-items: center;
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  background: var(--app-ha-blue);
  color: #fff;
  font-weight: 600;
  font-size: 0.9rem;
  text-decoration: none;
}

.my-ha-button:hover {
  filter: brightness(1.1);
  color: #fff;
}

.ui-steps {
  margin: 0.5rem 0 0.75rem;
  padding-left: 1.25rem;
  font-size: 0.9rem;
  color: var(--app-text-2);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.observation-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.observation-row {
  border: 1px solid var(--app-border);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  background: var(--app-surface);
}

.observation-row.flagged {
  border-color: var(--app-warning);
}

.obs-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.obs-entity {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.obs-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 0.25rem 1rem;
  margin-top: 0.35rem;
}

.obs-field {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
}

.field-label {
  color: var(--app-text-3);
}

.field-value {
  font-weight: 600;
  color: var(--app-text);
}

.field-value.txt-true {
  color: var(--app-true);
}

.field-value.txt-false {
  color: var(--app-false);
}
</style>
