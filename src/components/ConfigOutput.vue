<template>
  <div class="config-output">
    <h2>Generated Configuration</h2>
    
    <div v-if="!config" class="no-config">
      <p>No configuration generated yet. Complete the analysis first.</p>
    </div>
    
    <div v-else>
      <div class="config-header">
        <div class="config-settings">
          <div class="setting-group">
            <label for="sensor-name">Sensor Name:</label>
            <input
              id="sensor-name"
              v-model="sensorName"
              type="text"
              @input="updateConfig"
            />
          </div>
          
          <div class="setting-group">
            <label for="prior">Prior Probability:</label>
            <input
              id="prior"
              v-model.number="prior"
              type="number"
              min="0.01"
              max="0.99"
              step="0.01"
              @input="updateConfig"
            />
            <small>Initial probability (0.01-0.99)</small>
          </div>
          
          <div class="setting-group">
            <label for="threshold">Probability Threshold:</label>
            <input
              id="threshold"
              v-model.number="threshold"
              type="number"
              min="0.01"
              max="0.99"
              step="0.01"
              @input="updateConfig"
            />
            <small>Activation threshold (0.01-0.99)</small>
          </div>
          
          <div class="setting-group">
            <label for="max-observations">Max Observations:</label>
            <select
              id="max-observations"
              v-model.number="maxObservations"
              @change="updateConfig"
            >
              <option value="5">Top 5</option>
              <option value="10">Top 10</option>
              <option value="15">Top 15</option>
              <option value="20">Top 20</option>
            </select>
          </div>
        </div>
        
        <div class="actions">
          <button @click="copyToClipboard" class="copy-btn">
            {{ copyText }}
          </button>
          <button @click="downloadConfig" class="download-btn">
            Download YAML
          </button>
        </div>
      </div>
      
      <div class="config-preview">
        <h3>Configuration Preview</h3>
        <div class="config-stats">
          <span>{{ currentConfig?.observations.length || 0 }} observations</span>
          <span>Discrimination range: {{ discriminationRange }}</span>
        </div>
      </div>
      
      <div class="yaml-output">
        <pre><code>{{ yamlOutput }}</code></pre>
      </div>
      
      <div class="observations-details">
        <h3>Observation Details</h3>
        <div class="observation-cards">
          <div
            v-for="(obs, index) in currentConfig?.observations || []"
            :key="index"
            class="observation-card"
          >
            <div class="obs-header">
              <span class="obs-entity">{{ obs.entity_id }}</span>
              <span class="obs-platform">{{ obs.platform }}</span>
            </div>
            <div class="obs-condition">
              <span v-if="obs.to_state">State: {{ obs.to_state }}</span>
              <span v-if="obs.above !== undefined && obs.below !== undefined">
                Range: {{ obs.above }} - {{ obs.below }}
              </span>
            </div>
            <div class="obs-probabilities">
              <div class="prob-item">
                <span>True: {{ (obs.prob_given_true * 100).toFixed(1) }}%</span>
                <div class="prob-bar">
                  <div 
                    class="prob-fill true-fill"
                    :style="{ width: `${obs.prob_given_true * 100}%` }"
                  ></div>
                </div>
              </div>
              <div class="prob-item">
                <span>False: {{ (obs.prob_given_false * 100).toFixed(1) }}%</span>
                <div class="prob-bar">
                  <div 
                    class="prob-fill false-fill"
                    :style="{ width: `${obs.prob_given_false * 100}%` }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { stringify as yamlStringify } from 'yaml'
import type { BayesianSensorConfig, EntityProbability } from '../types/bayesian'

const props = defineProps<{
  config: BayesianSensorConfig | null
  entityProbabilities: EntityProbability[]
}>()

const emit = defineEmits<{
  configUpdated: [config: BayesianSensorConfig]
}>()

const sensorName = ref('Bayesian Sensor')
const prior = ref(0.5)
const threshold = ref(0.5)
const maxObservations = ref(10)
const copyText = ref('Copy YAML')

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
  
  return yamlStringify({
    binary_sensor: [currentConfig.value]
  }, {
    indent: 2,
    lineWidth: 0
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
    setTimeout(() => {
      copyText.value = 'Copy YAML'
    }, 2000)
  } catch (error) {
    console.error('Failed to copy to clipboard:', error)
    copyText.value = 'Copy failed'
    setTimeout(() => {
      copyText.value = 'Copy YAML'
    }, 2000)
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
}
</script>

<style scoped>
.config-output {
  max-width: 1200px;
  margin: 2rem auto;
}

h2 {
  color: #333;
  margin-bottom: 1.5rem;
}

.no-config {
  background: #f5f5f5;
  padding: 2rem;
  border-radius: 8px;
  text-align: center;
  color: #666;
}

.config-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
  gap: 2rem;
}

.config-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  flex: 1;
}

.setting-group {
  display: flex;
  flex-direction: column;
}

.setting-group label {
  font-weight: 500;
  margin-bottom: 0.25rem;
  color: #555;
}

.setting-group input,
.setting-group select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.95rem;
}

.setting-group small {
  margin-top: 0.25rem;
  color: #777;
  font-size: 0.8rem;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.copy-btn,
.download-btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: background 0.3s;
}

.copy-btn {
  background: #4CAF50;
  color: white;
}

.copy-btn:hover {
  background: #45a049;
}

.download-btn {
  background: #2196F3;
  color: white;
}

.download-btn:hover {
  background: #1976D2;
}

.config-preview {
  margin-bottom: 1rem;
}

.config-preview h3 {
  margin-bottom: 0.5rem;
  color: #333;
}

.config-stats {
  display: flex;
  gap: 1rem;
  font-size: 0.9rem;
  color: #666;
}

.yaml-output {
  background: #f8f8f8;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-bottom: 2rem;
  overflow-x: auto;
}

.yaml-output pre {
  margin: 0;
  padding: 1rem;
  white-space: pre;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.85rem;
  line-height: 1.4;
}

.observations-details h3 {
  margin-bottom: 1rem;
  color: #333;
}

.observation-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.observation-card {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
}

.obs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.obs-entity {
  font-family: monospace;
  font-size: 0.85rem;
  color: #555;
  word-break: break-all;
}

.obs-platform {
  background: #e3f2fd;
  color: #1976d2;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.obs-condition {
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
  color: #666;
}

.obs-probabilities {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.prob-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.prob-item span {
  min-width: 80px;
  font-size: 0.85rem;
  font-weight: 500;
}

.prob-bar {
  flex: 1;
  height: 16px;
  background: #f0f0f0;
  border-radius: 8px;
  overflow: hidden;
}

.prob-fill {
  height: 100%;
  border-radius: 8px;
  transition: width 0.3s ease;
}

.true-fill {
  background: linear-gradient(90deg, #4CAF50, #66BB6A);
}

.false-fill {
  background: linear-gradient(90deg, #f44336, #ef5350);
}
</style>