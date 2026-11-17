<script setup lang="ts">
import { ref, onMounted, computed, defineAsyncComponent, watchEffect } from 'vue'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NButton,
  NSpace,
  NText,
  NTag,
  NTabs,
  NTabPane,
  NSpin,
  darkTheme,
  useOsTheme
} from 'naive-ui'
import { useBayesianAnalysis } from './composables/useBayesianAnalysis'
import { generateBayesianConfig } from './services/configGenerator'
import HeaderActions, { type ThemePreference } from './components/HeaderActions.vue'
import { STORAGE_KEYS, readString, writeString, resetSession } from './utils/sessionStore'
import { isDarkTheme } from './utils/themeState'
// Lazy load components for better performance
const ConnectionForm = defineAsyncComponent(() => import('./components/ConnectionForm.vue'))
const EntityScoreDisplay = defineAsyncComponent(() => import('./components/EntityScoreDisplay.vue'))
const TimePeriodSelector = defineAsyncComponent(() => import('./components/TimePeriodSelector.vue'))
const EntityAnalyzer = defineAsyncComponent(() => import('./components/EntityAnalyzer.vue'))
const ConfigOutput = defineAsyncComponent(() => import('./components/ConfigOutput.vue'))
import type { EntityProbability, BayesianSensorConfig } from './types/bayesian'

const {
  isConnected,
  connectionError,
  entities,
  periods,
  analyzedEntities,
  generatedConfig,
  isAnalyzing,
  analysisError,
  analysisProgress,
  entityStatusMap,
  canAnalyze,
  haConnection,
  haApi,
  cachedHistoricalData,
  entityBuffer, // NEW: Buffer access
  connectToHA,
  resumeSession,
  hasResumableSession,
  disconnectFromHA,
  entityScope,
  scopeOptions,
  updatePeriods,
  analyzeEntities,
  updateGeneratedConfig,
  resetAnalysis
} = useBayesianAnalysis()

const selectedEntitiesForConfig = ref<EntityProbability[]>([])
const isAutoConnecting = ref(false)
const activeTab = ref<'connection' | 'periods' | 'results'>('connection')

// ---------------------------------------------------------------------------
// Theme: OS preference by default, manual override persisted
// ---------------------------------------------------------------------------
const osTheme = useOsTheme()
const storedTheme = readString(STORAGE_KEYS.theme)
const themePreference = ref<ThemePreference>(
  storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'auto'
)
const isDark = computed(() =>
  themePreference.value === 'dark' || (themePreference.value === 'auto' && osTheme.value === 'dark')
)
const naiveTheme = computed(() => (isDark.value ? darkTheme : null))
const themeOverrides = {
  common: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }
}

const setThemePreference = (value: ThemePreference) => {
  themePreference.value = value
  writeString(STORAGE_KEYS.theme, value)
}

watchEffect(() => {
  const root = document.documentElement
  root.dataset.theme = isDark.value ? 'dark' : 'light'
  root.style.colorScheme = isDark.value ? 'dark' : 'light'
  isDarkTheme.value = isDark.value
})

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
const truePeriodCount = computed(() => periods.value.filter(p => p.isTruePeriod).length)
const falsePeriodCount = computed(() => periods.value.filter(p => !p.isTruePeriod).length)

const tabStates = computed(() => ({
  connection: {
    disabled: false,
    completed: isConnected.value
  },
  periods: {
    disabled: !isConnected.value,
    completed: isConnected.value && truePeriodCount.value > 0 && falsePeriodCount.value > 0
  },
  results: {
    disabled: !isConnected.value || periods.value.length === 0,
    completed: !!generatedConfig.value && selectedEntitiesForConfig.value.length > 0
  }
}))

// No auto-advancement - let users control their navigation

const handleConnect = async (connection: any) => {
  const success = await connectToHA(connection)
  if (success) {
    resetAnalysis()
  }
  isAutoConnecting.value = false
}

const handleConnectionStatus = () => {
}

// Finish an OAuth redirect, or auto-connect with remembered credentials
onMounted(async () => {
  if (hasResumableSession() && !isConnected.value) {
    isAutoConnecting.value = true
    await resumeSession()
    isAutoConnecting.value = false
  }
})

const handlePeriodsUpdate = (newPeriods: any) => {
  updatePeriods(newPeriods)
  // Don't auto-advance - let users review their periods first
}

const handleAnalyze = () => {
  analyzeEntities() // Analyze all entities
}

const goToResults = () => {
  activeTab.value = 'results'
  if (analyzedEntities.value.length === 0 && canAnalyze.value && !isAnalyzing.value) {
    handleAnalyze()
  }
}

// Sensor-level settings the user edited in the output panel survive
// selection changes (which regenerate the config).
const sensorOverrides = ref<Pick<BayesianSensorConfig, 'name' | 'prior' | 'probability_threshold'> | null>(null)

const slug = (name: string) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

const handleEntitiesSelected = (selectedEntities: EntityProbability[]) => {
  selectedEntitiesForConfig.value = selectedEntities
  // User explicitly selected these entities - use ALL of them, no filtering
  const config = generateBayesianConfig(selectedEntities, 'Bayesian Sensor', {
    periods: periods.value,
    maxObservations: selectedEntities.length,
    skipFiltering: true // user selections are used as-is
  })
  if (sensorOverrides.value) {
    Object.assign(config, sensorOverrides.value, { unique_id: `bayesian_${slug(sensorOverrides.value.name)}` })
  }
  updateGeneratedConfig(config)
}

const handleConfigUpdated = (config: BayesianSensorConfig) => {
  sensorOverrides.value = {
    name: config.name,
    prior: config.prior,
    probability_threshold: config.probability_threshold
  }
  // Keep the full observation list; the output panel only trims it for display
  updateGeneratedConfig({
    ...config,
    unique_id: `bayesian_${slug(config.name)}`,
    observations: generatedConfig.value?.observations ?? config.observations
  })
}

const configForOutput = computed(() =>
  selectedEntitiesForConfig.value.length > 0 ? generatedConfig.value : null
)

const handleReset = () => {
  resetSession()
  window.location.reload()
}
</script>

<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
      <div class="app">
        <header class="app-header">
          <div class="header-content">
            <h1 class="app-title">
              <span class="title-full">HA Bayesian Generator</span>
              <span class="title-short">HA Bayesian</span>
            </h1>
            <n-tabs
              v-model:value="activeTab"
              type="line"
              size="medium"
              animated
              class="header-tabs"
            >
              <n-tab-pane name="connection" :disabled="tabStates.connection.disabled">
                <template #tab>
                  <span class="tab-label">
                    <span class="step-badge" :class="{ done: tabStates.connection.completed }">
                      {{ tabStates.connection.completed ? '✓' : '1' }}
                    </span>
                    Connect
                  </span>
                </template>
              </n-tab-pane>

              <n-tab-pane name="periods" :disabled="tabStates.periods.disabled">
                <template #tab>
                  <span class="tab-label">
                    <span class="step-badge" :class="{ done: tabStates.periods.completed }">
                      {{ tabStates.periods.completed ? '✓' : '2' }}
                    </span>
                    Periods
                  </span>
                </template>
              </n-tab-pane>

              <n-tab-pane name="results" :disabled="tabStates.results.disabled">
                <template #tab>
                  <span class="tab-label">
                    <span class="step-badge" :class="{ done: tabStates.results.completed }">
                      {{ tabStates.results.completed ? '✓' : '3' }}
                    </span>
                    Results
                    <span v-if="analyzedEntities.length > 0" class="tab-count">{{ analyzedEntities.length }}</span>
                  </span>
                </template>
              </n-tab-pane>
            </n-tabs>
            <HeaderActions :theme="themePreference" @update:theme="setThemePreference" @reset="handleReset" />
          </div>
        </header>

        <main class="main-content">
          <div class="content-wrapper">
            <!-- Connection Panel -->
            <div v-show="activeTab === 'connection'" class="panel-content">
              <n-space vertical size="medium" class="connect-column">
                  <Suspense>
                    <ConnectionForm
                      :is-connected="isConnected"
                      :connection-error="connectionError"
                      :is-auto-connecting="isAutoConnecting"
                      @connect="handleConnect"
                      @disconnect="disconnectFromHA"
                      @connection-status="handleConnectionStatus"
                    />
                    <template #fallback>
                      <n-space justify="center" style="padding: 2rem">
                        <n-spin size="large" />
                      </n-space>
                    </template>
                  </Suspense>

                  <div v-if="isConnected" class="step-cta">
                    <n-text depth="3">Connected. Next, tell the generator when the sensor should be on.</n-text>
                    <n-button type="primary" @click="activeTab = 'periods'">Define periods</n-button>
                  </div>

                  <Suspense>
                    <EntityScoreDisplay
                      v-if="isConnected && entities.length > 0"
                      :entities="entities"
                      v-model:scope="entityScope"
                      :scope-options="scopeOptions"
                    />
                    <template #fallback>
                      <div v-if="isConnected && entities.length > 0">
                        <n-spin size="small" />
                      </div>
                    </template>
                  </Suspense>
              </n-space>
            </div>

            <!-- Periods Panel -->
            <div v-show="activeTab === 'periods'" class="panel-content periods-panel">
              <div class="step-cta periods-cta">
                <n-space size="small" align="center">
                  <n-tag size="small" :type="truePeriodCount > 0 ? 'success' : 'default'" :bordered="false">
                    {{ truePeriodCount }} TRUE
                  </n-tag>
                  <n-tag size="small" :type="falsePeriodCount > 0 ? 'error' : 'default'" :bordered="false">
                    {{ falsePeriodCount }} FALSE
                  </n-tag>
                  <n-text v-if="truePeriodCount === 0 || falsePeriodCount === 0" depth="3" class="cta-hint">
                    Add at least one TRUE and one FALSE period.
                  </n-text>
                  <n-text v-else-if="!isConnected" depth="3" class="cta-hint">
                    Connect to Home Assistant to analyze.
                  </n-text>
                </n-space>
                <n-button type="primary" :disabled="!canAnalyze" @click="goToResults">
                  {{ analyzedEntities.length > 0 ? 'View results' : 'Analyze entities' }}
                </n-button>
              </div>
              <Suspense>
                <TimePeriodSelector
                  :ha-api="haApi"
                  :entities="entities"
                  @periods-updated="handlePeriodsUpdate"
                />
                <template #fallback>
                  <n-space justify="center" style="padding: 2rem">
                    <n-spin size="large" />
                  </n-space>
                </template>
              </Suspense>
            </div>

            <!-- Results Panel: ranked entities (left) + live config (right) -->
            <div v-show="activeTab === 'results'" class="panel-content results-panel">
              <div class="results-toolbar">
                <n-button
                  @click="handleAnalyze"
                  :disabled="!canAnalyze || isAnalyzing"
                  :loading="isAnalyzing"
                  type="primary"
                >
                  {{ isAnalyzing ? 'Analyzing...' : analyzedEntities.length > 0 ? 'Re-analyze' : 'Analyze entities' }}
                </n-button>
                <n-text depth="3" class="toolbar-text">
                  {{ entities.length }} entities · {{ truePeriodCount }} TRUE / {{ falsePeriodCount }} FALSE periods
                </n-text>
                <n-space v-if="!canAnalyze && !isAnalyzing" size="small" class="toolbar-requirements">
                  <n-tag size="small" :type="isConnected ? 'success' : 'error'" :bordered="false">
                    {{ isConnected ? '✓' : '✗' }} Connected
                  </n-tag>
                  <n-tag size="small" :type="truePeriodCount > 0 ? 'success' : 'error'" :bordered="false">
                    {{ truePeriodCount > 0 ? '✓' : '✗' }} TRUE period
                  </n-tag>
                  <n-tag size="small" :type="falsePeriodCount > 0 ? 'success' : 'error'" :bordered="false">
                    {{ falsePeriodCount > 0 ? '✓' : '✗' }} FALSE period
                  </n-tag>
                </n-space>
              </div>

              <div class="results-grid">
                <section class="results-column results-entities" aria-label="Ranked entities">
                  <h2 class="column-title">Entities <span class="column-sub">ranked by discrimination</span></h2>
                  <Suspense>
                    <EntityAnalyzer
                      :analyzed-entities="analyzedEntities"
                      :periods="periods"
                      :is-analyzing="isAnalyzing"
                      :error="analysisError"
                      :total-entities="entities.length"
                      :analysis-progress="analysisProgress"
                      :entity-status-map="entityStatusMap"
                      @entities-selected="handleEntitiesSelected"
                    />
                    <template #fallback>
                      <n-space justify="center" style="padding: 2rem">
                        <n-spin size="large" />
                      </n-space>
                    </template>
                  </Suspense>
                </section>

                <section class="results-column results-config" aria-label="Sensor configuration">
                  <h2 class="column-title">Sensor <span class="column-sub">updates as you select</span></h2>
                  <Suspense>
                    <ConfigOutput
                      :config="configForOutput"
                      :entity-probabilities="selectedEntitiesForConfig"
                      :ha-connection="haConnection"
                      :cached-historical-data="cachedHistoricalData"
                      :entity-buffer="entityBuffer"
                      :entity-status-map="entityStatusMap"
                      :periods="periods"
                      @config-updated="handleConfigUpdated"
                    />
                    <template #fallback>
                      <n-space justify="center" style="padding: 2rem">
                        <n-spin size="large" />
                      </n-space>
                    </template>
                  </Suspense>
                </section>
              </div>
            </div>
          </div>
        </main>
      </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background-color: var(--app-bg);
  color: var(--app-text);
}

.app-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: var(--app-surface);
  border-bottom: 1px solid var(--app-border);
  z-index: 100;
  box-shadow: var(--app-shadow-sm);
}

.header-content {
  display: flex;
  align-items: center;
  height: 100%;
  max-width: 1600px;
  margin: 0 auto;
  padding: 0 1rem;
  gap: 1.5rem;
}

.app-title {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0;
  white-space: nowrap;
  color: var(--app-text);
  line-height: 1;
}

.title-short {
  display: none;
}

.header-tabs {
  flex: 1;
  min-width: 0;
}

.header-tabs :deep(.n-tabs-nav) {
  background: transparent;
}

.header-tabs :deep(.n-tabs-tab) {
  padding: 0 12px;
  height: 48px;
}

.header-tabs :deep(.n-tab-pane) {
  display: none;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}

.step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 0.75rem;
  font-weight: 700;
  background: var(--app-surface-muted);
  color: var(--app-text-2);
  border: 1px solid var(--app-border);
}

.step-badge.done {
  background: var(--app-true);
  border-color: var(--app-true);
  color: var(--app-on-accent);
}

.tab-count {
  background: var(--app-true);
  color: var(--app-on-accent);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.75rem;
}

.main-content {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  background-color: var(--app-bg);
}

.content-wrapper {
  height: 100%;
  max-width: 1600px;
  margin: 0 auto;
  box-sizing: border-box;
}

.panel-content {
  height: 100%;
  padding: 1rem;
  overflow-y: auto;
  overflow-x: hidden;
  box-sizing: border-box;
}

.connect-column {
  max-width: 760px;
  margin: 1rem auto 0;
}

.step-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  background: var(--app-surface-muted);
  border: 1px solid var(--app-border);
  border-radius: 8px;
}

.periods-cta {
  margin-bottom: 0.75rem;
}

.cta-hint {
  font-size: 0.85rem;
}

/* Results: two independent scrolling columns on wide screens */
.results-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.results-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  background: var(--app-surface-muted);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  flex-shrink: 0;
}

.toolbar-text {
  font-size: 0.875rem;
}

.toolbar-requirements {
  margin-left: auto;
}

.results-grid {
  display: grid;
  grid-template-columns: minmax(340px, 5fr) minmax(0, 7fr);
  gap: 1rem;
  flex: 1;
  min-height: 0;
}

.results-column {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.column-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
  color: var(--app-text);
}

.column-sub {
  font-weight: 400;
  font-size: 0.8rem;
  color: var(--app-text-3);
  margin-left: 0.25rem;
}

.periods-panel {
  padding: 0.75rem;
}

@media (max-width: 1100px) {
  .results-panel {
    display: block;
  }

  .results-toolbar {
    margin-bottom: 0.75rem;
  }

  .results-grid {
    grid-template-columns: 1fr;
  }

  .results-column {
    overflow: visible;
    padding-right: 0;
  }
}

@media (max-width: 768px) {
  .title-full {
    display: none;
  }

  .title-short {
    display: inline;
  }

  .header-content {
    gap: 0.5rem;
    padding: 0 0.5rem;
  }

  .header-tabs :deep(.n-tabs-tab) {
    padding: 0 6px;
  }

  .tab-label {
    font-size: 0.85rem;
  }

  .panel-content {
    padding: 0.5rem;
  }
}

@media (max-width: 480px) {
  .app-title {
    display: none;
  }

  .tab-count,
  .step-badge:not(.done) {
    display: none;
  }

  .step-badge.done {
    width: 14px;
    height: 14px;
    font-size: 0.6rem;
  }
}
</style>
