<template>
  <div class="config-controls">
    <div class="config-status">
      <span v-if="currentConfigName" class="current-config">
        📋 <strong>{{ currentConfigName }}</strong>
        <span class="auto-save-indicator">• Auto-saving</span>
      </span>
      <span v-else class="no-config">No configuration loaded</span>
    </div>
    <button 
      @click="showConfigDialog = true"
      class="btn btn-secondary config-btn"
    >
      🔄 Switch/New Config
    </button>
  </div>

  <!-- Config Dialog -->
  <div v-if="showConfigDialog" class="dialog-overlay" @click.self="showConfigDialog = false">
    <div class="dialog">
      <h3>{{ isCreatingNew ? 'Create New Configuration' : 'Manage Configurations' }}</h3>
      
      <div v-if="!isCreatingNew" class="dialog-content">
        <div class="create-new-section">
          <button @click="isCreatingNew = true" class="btn btn-primary create-new-btn">
            ➕ Create New Configuration
          </button>
        </div>
        
        <div v-if="savedConfigs.length > 0" class="config-list">
          <h4>Existing Configurations</h4>
          <div 
            v-for="config in savedConfigs" 
            :key="config.name"
            class="config-item"
            :class="{ active: config.name === currentConfigName }"
          >
            <div class="config-info">
              <span class="config-name">{{ config.name }}</span>
              <span class="config-details">
                {{ config.periods.length }} periods • 
                {{ format(new Date(config.lastModified), 'MMM d, h:mm a') }}
              </span>
            </div>
            <div class="config-actions">
              <button 
                v-if="config.name !== currentConfigName"
                @click="switchConfig(config.name)"
                class="btn btn-outline switch-btn"
              >
                Switch
              </button>
              <span v-else class="current-badge">Current</span>
              <button 
                @click="deleteConfig(config.name)"
                class="btn btn-warning delete-btn"
                title="Delete configuration"
              >
                🗑️
              </button>
            </div>
          </div>
        </div>
        <div v-else class="empty-state">
          No saved configurations yet
        </div>
      </div>
      
      <div v-else class="dialog-content">
        <input 
          v-model="newConfigName"
          type="text"
          placeholder="Enter configuration name"
          @keyup.enter="createNewConfig"
          @keyup.escape="isCreatingNew = false"
          autofocus
          class="form-input"
        />
        <p class="dialog-info">This will create a new empty configuration</p>
      </div>
      
      <div class="dialog-actions">
        <button 
          v-if="isCreatingNew" 
          @click="isCreatingNew = false" 
          class="btn btn-outline cancel-btn"
        >
          Back
        </button>
        <button 
          v-else
          @click="showConfigDialog = false" 
          class="btn btn-outline cancel-btn"
        >
          Close
        </button>
        <button 
          v-if="isCreatingNew"
          @click="createNewConfig" 
          :disabled="!newConfigName.trim()" 
          class="btn btn-primary save-btn"
        >
          Create
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { format } from 'date-fns'
import type { TimePeriod } from '../../types/bayesian'

interface SavedConfig {
  name: string
  periods: TimePeriod[]
  lastModified: string
}

const props = defineProps<{
  periods: TimePeriod[]
}>()

const emit = defineEmits<{
  configSwitched: [periods: TimePeriod[], configName: string]
  configCreated: [configName: string]
}>()

const savedConfigs = ref<SavedConfig[]>([])
const currentConfigName = ref('')
const showConfigDialog = ref(false)
const newConfigName = ref('')
const isCreatingNew = ref(false)

const loadSavedConfigs = () => {
  const saved = localStorage.getItem('ha_bayesian_configs')
  if (saved) {
    try {
      const configs = JSON.parse(saved)
      savedConfigs.value = configs.map((config: any) => ({
        name: config.name,
        periods: config.periods.map((p: any) => ({
          ...p,
          start: new Date(p.start),
          end: new Date(p.end)
        })),
        lastModified: config.lastModified || new Date().toISOString()
      }))
    } catch (e) {
      console.error('Failed to load saved configs:', e)
    }
  }
}

const autoSave = () => {
  if (!currentConfigName.value) {
    if (props.periods.length > 0) {
      currentConfigName.value = 'Default Configuration'
    } else {
      return
    }
  }
  
  const existingIndex = savedConfigs.value.findIndex(c => c.name === currentConfigName.value)
  const configData = {
    name: currentConfigName.value,
    periods: props.periods,
    lastModified: new Date().toISOString()
  }
  
  if (existingIndex >= 0) {
    savedConfigs.value[existingIndex] = configData
  } else {
    savedConfigs.value.push(configData)
  }
  
  const toSave = savedConfigs.value.map(c => ({
    name: c.name,
    periods: c.periods.map(p => ({
      ...p,
      start: p.start.toISOString(),
      end: p.end.toISOString()
    })),
    lastModified: c.lastModified
  }))
  localStorage.setItem('ha_bayesian_configs', JSON.stringify(toSave))
  localStorage.setItem('ha_bayesian_last_config', currentConfigName.value)
}

const createNewConfig = () => {
  if (!newConfigName.value.trim()) return
  
  const name = newConfigName.value.trim()
  
  if (savedConfigs.value.some(c => c.name === name)) {
    alert(`Configuration "${name}" already exists. Please choose a different name.`)
    return
  }
  
  currentConfigName.value = name
  newConfigName.value = ''
  isCreatingNew.value = false
  showConfigDialog.value = false
  
  autoSave()
  emit('configCreated', name)
}

const switchConfig = (configName: string) => {
  const config = savedConfigs.value.find(c => c.name === configName)
  if (config) {
    currentConfigName.value = configName
    showConfigDialog.value = false
    localStorage.setItem('ha_bayesian_last_config', configName)
    emit('configSwitched', [...config.periods], configName)
  }
}

const deleteConfig = (configName: string) => {
  if (!confirm(`Delete configuration "${configName}"?`)) return
  
  savedConfigs.value = savedConfigs.value.filter(c => c.name !== configName)
  
  const toSave = savedConfigs.value.map(c => ({
    name: c.name,
    periods: c.periods.map(p => ({
      ...p,
      start: p.start.toISOString(),
      end: p.end.toISOString()
    })),
    lastModified: c.lastModified
  }))
  localStorage.setItem('ha_bayesian_configs', JSON.stringify(toSave))
  
  if (currentConfigName.value === configName) {
    if (savedConfigs.value.length > 0) {
      switchConfig(savedConfigs.value[0].name)
    } else {
      currentConfigName.value = 'Default Configuration'
      emit('configSwitched', [], 'Default Configuration')
    }
  }
}

const loadLastConfig = () => {
  const lastConfigName = localStorage.getItem('ha_bayesian_last_config')
  
  if (lastConfigName && savedConfigs.value.some(c => c.name === lastConfigName)) {
    switchConfig(lastConfigName)
  } else if (savedConfigs.value.length > 0) {
    const sortedConfigs = [...savedConfigs.value].sort((a, b) => 
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
    )
    switchConfig(sortedConfigs[0].name)
  } else {
    currentConfigName.value = 'Default Configuration'
  }
}

defineExpose({
  autoSave,
  getCurrentConfigName: () => currentConfigName.value,
  setCurrentConfigName: (name: string) => { currentConfigName.value = name }
})

onMounted(() => {
  loadSavedConfigs()
  loadLastConfig()
})
</script>

<style scoped>

.config-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
  margin-bottom: 1.5rem;
}

.config-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.current-config {
  color: #333;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.auto-save-indicator {
  font-size: 0.8rem;
  color: #4CAF50;
}

.no-config {
  color: #999;
  font-style: italic;
}

.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}

.dialog h3 {
  margin: 0 0 1rem 0;
  color: #333;
}

.dialog-content {
  margin-bottom: 1.5rem;
}

.create-new-section {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e0e0e0;
}

.config-list h4 {
  margin: 0 0 1rem 0;
  color: #333;
  font-size: 1rem;
}

.config-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  margin-bottom: 0.5rem;
}

.config-item.active {
  border-color: #4CAF50;
  background: #e8f5e9;
}

.config-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.config-name {
  font-weight: 500;
  color: #333;
}

.config-details {
  font-size: 0.8rem;
  color: #666;
}

.config-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.current-badge {
  background: #4CAF50;
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 500;
}

.delete-btn {
  min-width: auto;
  padding: 0.25rem 0.5rem;
}

.empty-state {
  text-align: center;
  color: #999;
  padding: 2rem;
  background: #f8f9fa;
  border-radius: 4px;
}

.dialog-info {
  margin: 0.5rem 0 0 0;
  color: #666;
  font-size: 0.9rem;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (max-width: 768px) {
  .config-controls {
    flex-direction: column;
    gap: 1rem;
  }
  
  .config-item {
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
  }
  
  .config-actions {
    justify-content: center;
  }
  
  .dialog {
    width: 95%;
    padding: 1rem;
  }
}
</style>