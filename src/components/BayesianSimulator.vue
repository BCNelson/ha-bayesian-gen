<template>
  <div class="bayesian-simulator">
    <div class="simulator-header">
      <h3>Historical Bayesian Sensor Simulation</h3>
      <p>See how your sensor would have performed with historical data</p>
    </div>

    <div class="simulator-controls">
      <div class="time-range-selector">
        <label>Sample Rate:</label>
        <select v-model="selectedTimeRange" @change="runSimulation">
          <option value="1h">1 min intervals</option>
          <option value="6h">5 min intervals</option>
          <option value="24h">15 min intervals</option>
          <option value="3d">1 hour intervals</option>
          <option value="7d">4 hour intervals</option>
        </select>
        <button @click="runSimulation" :disabled="isLoading" class="btn btn-secondary">
          {{ isLoading ? 'Processing...' : 'Refresh' }}
        </button>
      </div>

      <div v-if="simulationResult" class="simulation-stats">
        <div class="stat-item">
          <span class="stat-label">Average Probability:</span>
          <span class="stat-value">{{ (simulationResult.statistics.avgProbability * 100).toFixed(1) }}%</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Trigger Count:</span>
          <span class="stat-value">{{ simulationResult.statistics.triggerCount }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Time ON:</span>
          <span class="stat-value">{{ calculateTimeOn() }}</span>
        </div>
      </div>
    </div>

    <div class="simulator-content">
      <div class="chart-section">
        <div v-if="error" class="error-message">
          {{ error }}
        </div>
        
        <div v-else-if="isLoading" class="loading-message">
          Loading historical data...
        </div>

        <div class="chart-container">
          <component
            :is="VueApexCharts"
            ref="chart"
            type="line"
            height="350"
            :options="chartOptions"
            :series="chartSeries"
          />
        </div>

        <div v-if="simulationResult && simulationResult.onPeriods.length > 0" class="on-periods">
          <h4>Sensor ON Periods</h4>
          <div class="periods-list">
            <div v-for="(period, index) in simulationResult.onPeriods" :key="index" class="period-item">
              <span class="period-time">{{ fmtDate(period.start) }} - {{ fmtDate(period.end) }}</span>
              <span class="period-duration">{{ formatDuration(period.start, period.end) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="observations-section">
        <h4>Entity Status During Simulation</h4>
        <div v-if="!simulationResult" class="no-data">
          Run simulation to see entity states
        </div>
        <div v-else class="observations-list">
          <div
            v-for="obs in config.observations"
            :key="obs.entity_id"
            class="observation-item"
          >
            <div class="observation-info">
              <span class="entity-id">{{ obs.entity_id }}</span>
              <span class="platform">{{ obs.platform }}</span>
            </div>
            
            <div class="observation-details">
              <div class="condition">
                <span v-if="obs.to_state">State: {{ obs.to_state }}</span>
                <span v-else-if="obs.above !== undefined && obs.below !== undefined">
                  {{ obs.above }} &lt; value &lt; {{ obs.below }}
                </span>
                <span v-else-if="obs.above !== undefined">
                  value &gt; {{ obs.above }}
                </span>
                <span v-else-if="obs.below !== undefined">
                  value &lt; {{ obs.below }}
                </span>
              </div>
              
              <div class="probabilities">
                <div class="prob-row">
                  <span class="prob-label">P(obs|true):</span>
                  <span class="prob-value">{{ (obs.prob_given_true * 100).toFixed(0) }}%</span>
                  <div class="prob-bar">
                    <div
                      class="prob-fill true"
                      :style="{ width: `${obs.prob_given_true * 100}%` }"
                    ></div>
                  </div>
                </div>
                <div class="prob-row">
                  <span class="prob-label">P(obs|false):</span>
                  <span class="prob-value">{{ (obs.prob_given_false * 100).toFixed(0) }}%</span>
                  <div class="prob-bar">
                    <div
                      class="prob-fill false"
                      :style="{ width: `${obs.prob_given_false * 100}%` }"
                    ></div>
                  </div>
                </div>
              </div>

              <div class="observation-summary">
                <span class="summary-label">Active:</span>
                <span class="summary-value">
                  {{ getObservationActivePercentage(obs.entity_id) }}% of time
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="simulator-footer">
      <div class="info-section">
        <h4>How it works</h4>
        <p>
          This simulation shows how your Bayesian sensor will behave based on the observations you've configured.
          Each observation updates the probability using Bayes' theorem. When the probability crosses the threshold
          ({{ (threshold * 100).toFixed(0) }}%), the sensor turns ON.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, defineAsyncComponent, nextTick, shallowRef } from 'vue'
import { SimulationService } from '../services/simulationService'
import { createBayesianChartOptions, transformSimulationData } from '../utils/chartConfig'
import { formatDate as fmtDate, formatDuration } from '../utils/formatters'
import type { BayesianSensorConfig } from '../types/bayesian'
import type { SimulationSummary } from '../services/cachedBayesianSimulator'

const VueApexCharts = defineAsyncComponent(() => import('vue3-apexcharts'))

const props = defineProps<{
  config: BayesianSensorConfig
  cachedHistoricalData: Map<string, any[]>
  entityBuffer?: any // NEW: Optional buffer for high-performance simulation
}>()

onUnmounted(() => {
  if (debounceTimer.value) {
    window.clearTimeout(debounceTimer.value)
  }
  simulationService.terminate()
})

// Use the HA connection from props

const chart = ref<any>(null)
const simulationService = new SimulationService()
const simulationResult = shallowRef<SimulationSummary | null>(null)
const threshold = computed(() => props.config.probability_threshold)
const isLoading = ref(false)
const error = ref<string | null>(null)
const selectedTimeRange = ref('24h')
const simulationInProgress = ref(false)
const debounceTimer = ref<number | null>(null)


const chartSeries = shallowRef([
  {
    name: 'Probability',
    data: [] as Array<{ x: number; y: number }>
  },
  {
    name: 'Sensor State',
    data: [] as Array<{ x: number; y: number }>
  }
])

const getSampleInterval = () => {
  switch (selectedTimeRange.value) {
    case '1h': return 1 // 1 minute
    case '6h': return 5 // 5 minutes
    case '24h': return 15 // 15 minutes
    case '3d': return 60 // 1 hour
    case '7d': return 240 // 4 hours
    default: return 15
  }
}

const getTimeRangeFromData = () => {
  if (!props.cachedHistoricalData || props.cachedHistoricalData.size === 0) {
    const now = new Date()
    return { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: now }
  }

  let earliest = new Date()
  let latest = new Date(0)

  for (const [_, history] of props.cachedHistoricalData.entries()) {
    if (history.length > 0) {
      const firstTime = new Date(history[0].last_changed)
      const lastTime = new Date(history[history.length - 1].last_changed)
      
      if (firstTime < earliest) earliest = firstTime
      if (lastTime > latest) latest = lastTime
    }
  }

  return { start: earliest, end: latest }
}

const runSimulation = async () => {
  if (!props.config || simulationInProgress.value) return
  
  simulationInProgress.value = true
  isLoading.value = true
  error.value = null

  try {
    const { start, end } = getTimeRangeFromData()
    const sampleInterval = getSampleInterval()
    
    // Check if we should use buffer-based or legacy simulation
    const shouldUseBuffer = props.entityBuffer && typeof props.entityBuffer.getTransferableBuffers === 'function'
    
    if (shouldUseBuffer) {
      console.log('Using high-performance buffer simulation')
      
      // NEW: High-performance buffer-based simulation
      const entityIds = props.config.observations.map(obs => obs.entity_id)
      
      // Check if all required entities have buffer data
      const availableEntities = entityIds.filter(entityId => 
        props.entityBuffer.hasEntity(entityId)
      )
      
      if (availableEntities.length === 0) {
        error.value = 'No buffer data available for configured entities. Analysis is still running...'
        return
      }
      
      // Get transferable buffers (zero-copy transfer)
      const { buffers, metadata } = props.entityBuffer.getTransferableBuffers(availableEntities)
      
      if (buffers.length === 0) {
        error.value = 'No transferable buffer data available'
        return
      }
      
      console.log(`Transferring ${buffers.length} buffers to worker`)
      
      try {
        // Run efficient buffer simulation
        simulationResult.value = await simulationService.simulateWithBuffers(
          props.config.prior,
          props.config.probability_threshold,
          props.config.observations.filter(obs => availableEntities.includes(obs.entity_id)),
          buffers,
          metadata,
          { start, end },
          sampleInterval
        )
      } catch (bufferError) {
        console.warn('Buffer simulation failed, falling back to legacy:', bufferError)
        
        // Fallback to legacy simulation
        const availableEntities = props.config.observations.filter(obs => 
          props.cachedHistoricalData.has(obs.entity_id)
        )
        
        if (availableEntities.length === 0) {
          throw new Error('No historical data available for configured entities')
        }

        const plainConfig = {
          prior: props.config.prior,
          probability_threshold: props.config.probability_threshold,
          observations: props.config.observations.map(obs => ({...obs}))
        }
        
        const plainCachedData = new Map(props.cachedHistoricalData)
        
        simulationResult.value = await simulationService.simulate(
          plainConfig.prior,
          plainConfig.probability_threshold,
          plainConfig.observations,
          plainCachedData,
          { start, end },
          sampleInterval
        )
      }
      
    } else {
      console.log('Using legacy object-based simulation')
      
      // LEGACY: Object-based simulation (fallback)
      const availableEntities = props.config.observations.filter(obs => 
        props.cachedHistoricalData.has(obs.entity_id)
      )
      
      if (availableEntities.length === 0) {
        error.value = 'No historical data available for configured entities. Analysis is still running...'
        return
      }

      // Defer heavy serialization work to next tick to prevent blocking
      await nextTick()
      
      // Serialize reactive objects to plain data before passing to worker
      const plainConfig = {
        prior: props.config.prior,
        probability_threshold: props.config.probability_threshold,
        observations: props.config.observations.map(obs => ({...obs})) // shallow clone
      }
      
      // Convert Map to plain object (still expensive but better than JSON)
      const plainCachedData = new Map(props.cachedHistoricalData)
      
      // Run legacy simulation
      simulationResult.value = await simulationService.simulate(
        plainConfig.prior,
        plainConfig.probability_threshold,
        plainConfig.observations,
        plainCachedData,
        { start, end },
        sampleInterval
      )
    }

    updateChart()
  } catch (err) {
    error.value = `Simulation failed: ${err}`
    console.error('Simulation error:', err)
  } finally {
    isLoading.value = false
    simulationInProgress.value = false
  }
}

const chartOptions = computed(() => 
  createBayesianChartOptions({
    height: 400,
    threshold: props.config.probability_threshold
  })
)

const updateChart = () => {
  if (!simulationResult.value) return
  // Use nextTick to defer chart update to prevent blocking
  nextTick(() => {
    if (simulationResult.value) {
      chartSeries.value = transformSimulationData(simulationResult.value.points)
    }
  })
}




const calculateTimeOn = () => {
  if (!simulationResult.value) return '0m'
  
  const totalTime = simulationResult.value.statistics.onTime
  const percentage = simulationResult.value.statistics.onPercentage.toFixed(1)
  
  const hours = Math.floor(totalTime / (1000 * 60 * 60))
  const minutes = Math.floor((totalTime % (1000 * 60 * 60)) / (1000 * 60))
  
  if (hours > 0) {
    return `${hours}h ${minutes}m (${percentage}%)`
  }
  return `${minutes}m (${percentage}%)`
}

const getObservationActivePercentage = (entityId: string) => {
  if (!simulationResult.value) return 0
  
  const totalPoints = simulationResult.value.points.length
  if (totalPoints === 0) return 0
  
  const activePoints = simulationResult.value.points.filter(point => 
    point.activeObservations.includes(entityId)
  ).length
  
  return ((activePoints / totalPoints) * 100).toFixed(1)
}

// Debounced simulation to prevent excessive runs
const debouncedRunSimulation = () => {
  if (debounceTimer.value) {
    window.clearTimeout(debounceTimer.value)
  }
  debounceTimer.value = window.setTimeout(() => {
    if (props.config && props.cachedHistoricalData.size > 0) {
      runSimulation()
    }
  }, 300) // 300ms debounce
}

watch(() => props.config, () => {
  if (props.config) {
    debouncedRunSimulation()
  }
}, { immediate: true, deep: true })

watch(() => props.cachedHistoricalData.size, () => {
  if (props.cachedHistoricalData.size > 0) {
    debouncedRunSimulation()
  }
})

onMounted(() => {
  if (props.config && props.cachedHistoricalData.size > 0) {
    runSimulation()
  }
})
</script>

<style scoped>

.bayesian-simulator {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.simulator-header {
  margin-bottom: 1.5rem;
}

.simulator-header h3 {
  margin: 0 0 0.5rem 0;
  color: #333;
}

.simulator-header p {
  margin: 0;
  color: #666;
  font-size: 0.95rem;
}

.simulator-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
  flex-wrap: wrap;
  gap: 1rem;
}

.time-range-selector {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.time-range-selector label {
  font-weight: 500;
  color: #333;
}

.time-range-selector select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.95rem;
}


.simulation-stats {
  display: flex;
  gap: 2rem;
  align-items: center;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.stat-label {
  font-size: 0.85rem;
  color: #666;
  font-weight: 500;
}

.stat-value {
  font-size: 1.2rem;
  font-weight: bold;
  color: #333;
}

.simulator-content {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 2rem;
  margin-bottom: 1.5rem;
}

.chart-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.error-message,
.loading-message {
  padding: 2rem;
  text-align: center;
  color: #666;
  background: #f8f9fa;
  border-radius: 8px;
}

.error-message {
  color: #d32f2f;
  background: #ffebee;
}

.chart-container {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1rem;
}

.on-periods {
  margin-top: 1rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
}

.on-periods h4 {
  margin: 0 0 0.75rem 0;
  color: #333;
  font-size: 0.95rem;
}

.periods-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 200px;
  overflow-y: auto;
}

.period-item {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 0.85rem;
}

.period-time {
  color: #333;
  font-family: monospace;
}

.period-duration {
  color: #666;
  font-weight: 500;
}

.observations-section {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 1rem;
  max-height: 600px;
  overflow-y: auto;
}

.observations-section h4 {
  margin: 0 0 1rem 0;
  color: #333;
}

.no-data {
  padding: 2rem;
  text-align: center;
  color: #999;
  background: white;
  border-radius: 4px;
}

.observations-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.observation-item {
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 0.75rem;
  transition: all 0.3s;
}

.observation-item.active {
  border-color: #4CAF50;
  background: #e8f5e9;
}

.observation-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}

.entity-id {
  font-family: monospace;
  font-size: 0.85rem;
  color: #333;
  word-break: break-all;
}

.platform {
  font-size: 0.75rem;
  color: #666;
  background: #e3f2fd;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  align-self: flex-start;
}

.observation-details {
  margin-left: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.condition {
  font-size: 0.85rem;
  color: #666;
}

.probabilities {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.prob-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.prob-label {
  font-size: 0.75rem;
  color: #999;
  min-width: 70px;
}

.prob-value {
  font-size: 0.75rem;
  font-weight: 500;
  min-width: 35px;
  text-align: right;
}

.prob-bar {
  flex: 1;
  height: 10px;
  background: #f0f0f0;
  border-radius: 5px;
  overflow: hidden;
}

.prob-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.prob-fill.true {
  background: #4CAF50;
}

.prob-fill.false {
  background: #f44336;
}

.observation-summary {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-top: 0.25rem;
  border-top: 1px solid #e0e0e0;
}

.summary-label {
  font-size: 0.75rem;
  color: #666;
  font-weight: 500;
}

.summary-value {
  font-size: 0.85rem;
  font-weight: bold;
  color: #2196F3;
}

.simulator-footer {
  border-top: 1px solid #e0e0e0;
  padding-top: 1rem;
}

.info-section h4 {
  margin: 0 0 0.5rem 0;
  color: #333;
  font-size: 0.95rem;
}

.info-section p {
  margin: 0;
  color: #666;
  font-size: 0.9rem;
  line-height: 1.5;
}

@media (max-width: 1024px) {
  .simulator-content {
    grid-template-columns: 1fr;
  }

  .observations-section {
    max-height: 400px;
  }
}
</style>