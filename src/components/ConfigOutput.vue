<template>
  <n-space vertical size="large">
    <n-empty v-if="!config" description="No configuration generated yet">
      <template #extra>
        <n-text depth="3">Complete the analysis first.</n-text>
      </template>
    </n-empty>

    <template v-else>
      <n-card>
        <n-grid :cols="4" :x-gap="12" :y-gap="12" responsive="screen">
          <n-form-item-gi label="Sensor Name">
            <n-input v-model:value="sensorName" @update:value="updateConfig" />
          </n-form-item-gi>

          <n-form-item-gi label="Prior Probability">
            <n-input-number 
              v-model:value="prior" 
              :min="0.01" 
              :max="0.99" 
              :step="0.01"
              @update:value="updateConfig"
            />
          </n-form-item-gi>

          <n-form-item-gi label="Probability Threshold">
            <n-input-number 
              v-model:value="threshold" 
              :min="0.01" 
              :max="0.99" 
              :step="0.01"
              @update:value="updateConfig"
            />
          </n-form-item-gi>

          <n-form-item-gi label="Max Observations">
            <n-select
              v-model:value="maxObservations"
              :options="maxObsOptions"
              @update:value="updateConfig"
            />
          </n-form-item-gi>
        </n-grid>

        <template #action>
          <n-space>
            <n-button type="primary" @click="copyToClipboard">
              {{ copyText }}
            </n-button>
            <n-button type="info" @click="downloadConfig">
              Download YAML
            </n-button>
            <n-button type="tertiary" @click="toggleSimulator">
              {{ showSimulator ? 'Hide' : 'Show' }} Simulation
            </n-button>
          </n-space>
        </template>
      </n-card>

      <n-card title="Configuration Preview">
        <n-space>
          <n-tag type="info">{{ currentConfig?.observations.length || 0 }} observations</n-tag>
          <n-tag type="success">Discrimination: {{ discriminationRange }}</n-tag>
        </n-space>
      </n-card>

      <n-collapse-transition :show="showSimulator && !!currentConfig">
        <n-card v-if="currentConfig" title="Bayesian Simulation" style="margin-bottom: 1rem">
          <BayesianSimulator 
            :config="currentConfig" 
            :cached-historical-data="cachedHistoricalData"
            :entity-buffer="entityBuffer"
            :periods="periods"
          />
        </n-card>
      </n-collapse-transition>

      <n-card v-show="!showSimulator" title="YAML Configuration">
        <n-code 
          :code="yamlOutput" 
          language="yaml" 
          show-line-numbers
        />
      </n-card>

      <n-card title="Observation Details">
        <n-grid :cols="2" :x-gap="12" :y-gap="12" responsive="screen">
          <n-grid-item v-for="(obs, index) in currentConfig?.observations || []" :key="index">
            <n-card size="small">
              <template #header>
                <n-space justify="space-between" align="center">
                  <n-ellipsis style="max-width: 200px">
                    <n-text code>{{ obs.entity_id }}</n-text>
                  </n-ellipsis>
                  <n-tag size="small" :bordered="false">{{ obs.platform }}</n-tag>
                </n-space>
              </template>
              
              <n-space vertical size="small">
                <n-text depth="3">
                  <template v-if="obs.to_state">State: {{ obs.to_state }}</template>
                  <template v-if="obs.above !== undefined && obs.below !== undefined">
                    Range: {{ obs.above }} - {{ obs.below }}
                  </template>
                </n-text>
                
                <n-space vertical size="small">
                  <div>
                    <n-text style="display: inline-block; width: 60px">True:</n-text>
                    <n-progress
                      type="line"
                      :percentage="Math.round(obs.prob_given_true * 100)"
                      :height="16"
                      :border-radius="8"
                      :fill-border-radius="8"
                      status="success"
                      style="width: calc(100% - 65px); display: inline-block; vertical-align: middle"
                    />
                    <n-text style="margin-left: 8px">{{ (obs.prob_given_true * 100).toFixed(1) }}%</n-text>
                  </div>
                  
                  <div>
                    <n-text style="display: inline-block; width: 60px">False:</n-text>
                    <n-progress
                      type="line"
                      :percentage="Math.round(obs.prob_given_false * 100)"
                      :height="16"
                      :border-radius="8"
                      :fill-border-radius="8"
                      status="error"
                      style="width: calc(100% - 65px); display: inline-block; vertical-align: middle"
                    />
                    <n-text style="margin-left: 8px">{{ (obs.prob_given_false * 100).toFixed(1) }}%</n-text>
                  </div>
                </n-space>
              </n-space>
            </n-card>
          </n-grid-item>
        </n-grid>
      </n-card>
    </template>
  </n-space>
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
  NCode,
  NEmpty,
  NText,
  NTag,
  NGrid,
  NGridItem,
  NFormItemGi,
  NProgress,
  NEllipsis,
  NCollapseTransition,
  useMessage
} from 'naive-ui'
import BayesianSimulator from './BayesianSimulator.vue'
import type { BayesianSensorConfig, EntityProbability } from '../types/bayesian'

const props = defineProps<{
  config: BayesianSensorConfig | null
  entityProbabilities: EntityProbability[]
  haConnection: any
  cachedHistoricalData: Map<string, any[]>
  entityBuffer?: any // NEW: Buffer for high-performance simulation
  periods?: any[] // Time periods for desired state
}>()

const emit = defineEmits<{
  configUpdated: [config: BayesianSensorConfig]
}>()

const message = useMessage()

const sensorName = ref('Bayesian Sensor')
const prior = ref(0.5)
const threshold = ref(0.5)
const maxObservations = ref(10)
const copyText = ref('Copy YAML')
const showSimulator = ref(false)

const maxObsOptions = [
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
    observations: props.config.observations.slice(0, maxObservations.value)
  }
})

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

  const topEntities = props.entityProbabilities.slice(0, maxObservations.value)
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

const toggleSimulator = () => {
  showSimulator.value = !showSimulator.value
}
</script>

<style scoped>
</style>