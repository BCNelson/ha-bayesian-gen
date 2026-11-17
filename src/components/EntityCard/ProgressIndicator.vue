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
  background: linear-gradient(90deg, var(--app-info-soft), var(--app-surface-muted));
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
  border: 2px solid var(--app-border);
  border-top: 2px solid var(--app-true);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.mini-spinner.analyzing {
  border-top-color: var(--app-info);
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.progress-status-label {
  font-weight: 500;
  color: var(--app-text);
  font-size: 0.9rem;
}

.progress-status-message {
  color: var(--app-text-2);
  font-size: 0.8rem;
  font-style: italic;
}

.status-queued {
  background: var(--app-warning-soft);
}

.status-fetching {
  background: var(--app-info-soft);
}

.status-fetched {
  background: var(--app-true-soft);
}

.status-analyzing {
  background: var(--app-accent-soft);
}

.status-error {
  background: var(--app-false-soft);
}
</style>