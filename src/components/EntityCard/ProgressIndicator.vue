<template>
  <div class="entity-progress-bar">
    <div :class="['progress-status', `status-${entityStatus.status}`]">
      <div class="progress-status-icon">
        <span v-if="entityStatus.status === 'queued'">⏳</span>
        <div v-else-if="entityStatus.status === 'fetching'" class="mini-spinner"></div>
        <span v-else-if="entityStatus.status === 'fetched'">📦</span>
        <div v-else-if="entityStatus.status === 'analyzing'" class="mini-spinner analyzing"></div>
        <span v-else-if="entityStatus.status === 'error'">✗</span>
      </div>
      <span class="progress-status-label">{{ getStatusLabel(entityStatus.status) }}</span>
      <span v-if="entityStatus.message" class="progress-status-message">{{ entityStatus.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface EntityStatus {
  status: 'queued' | 'fetching' | 'fetched' | 'analyzing' | 'completed' | 'error'
  message?: string
}

defineProps<{
  entityStatus: EntityStatus
}>()

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'queued': return 'Queued for analysis'
    case 'fetching': return 'Fetching history'
    case 'fetched': return 'Data fetched'
    case 'analyzing': return 'Analyzing states'
    case 'completed': return 'Analysis complete'
    case 'error': return 'Analysis failed'
    default: return status
  }
}
</script>

<style scoped>

.entity-progress-bar {
  background: linear-gradient(90deg, #e3f2fd, #f8f9fa);
  border-radius: 4px;
  padding: 0.5rem;
  margin-bottom: 0.75rem;
}

.progress-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.progress-status-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
}

.mini-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #e0e0e0;
  border-top: 2px solid #4CAF50;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.mini-spinner.analyzing {
  border-top-color: #2196F3;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.progress-status-label {
  font-weight: 500;
  color: #333;
  font-size: 0.9rem;
}

.progress-status-message {
  color: #666;
  font-size: 0.8rem;
  font-style: italic;
}

.status-queued {
  background: rgba(255, 193, 7, 0.1);
}

.status-fetching {
  background: rgba(33, 150, 243, 0.1);
}

.status-fetched {
  background: rgba(76, 175, 80, 0.1);
}

.status-analyzing {
  background: rgba(156, 39, 176, 0.1);
}

.status-error {
  background: rgba(244, 67, 54, 0.1);
}
</style>