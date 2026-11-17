<template>
  <div class="generator-preview">
    <div class="preview-stats">
      <div class="stat stat-true">
        <span class="stat-label">TRUE</span>
        <span class="stat-value">{{ summary.trueCount }} periods</span>
        <span class="stat-sub">{{ formatHours(summary.trueHours) }}</span>
      </div>
      <div class="stat stat-false">
        <span class="stat-label">FALSE</span>
        <span class="stat-value">{{ summary.falseCount }} periods</span>
        <span class="stat-sub">{{ formatHours(summary.falseHours) }}</span>
      </div>
    </div>

    <n-alert v-if="warning" type="warning" :show-icon="false" class="preview-warning">
      {{ warning }}
    </n-alert>

    <div class="preview-actions">
      <n-button type="primary" :disabled="!canApply" @click="$emit('apply', true)">
        Replace periods
      </n-button>
      <n-button :disabled="!canApply" @click="$emit('apply', false)">
        Add to existing
      </n-button>
      <n-text depth="3" class="existing-hint">
        {{ existingCount }} period{{ existingCount === 1 ? '' : 's' }} currently defined
      </n-text>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NAlert, NButton, NText } from 'naive-ui'
import type { GenerationSummary } from '../../utils/periodGenerators'

const props = defineProps<{
  summary: GenerationSummary
  existingCount: number
}>()

defineEmits<{
  apply: [replace: boolean]
}>()

const canApply = computed(() => props.summary.trueCount > 0 || props.summary.falseCount > 0)

const warning = computed(() => {
  const s = props.summary
  if (!canApply.value) return 'Nothing to generate with the current settings.'
  if (s.trueCount === 0) return 'No TRUE periods – analysis needs at least one of each.'
  if (s.falseCount === 0) return 'No FALSE periods – analysis needs at least one of each.'
  const total = s.trueHours + s.falseHours
  if (total > 0 && (s.trueHours / total < 0.05 || s.falseHours / total < 0.05)) {
    return 'TRUE and FALSE time is very unbalanced; probabilities for the smaller side may be noisy.'
  }
  return ''
})

const formatHours = (h: number) => {
  if (h >= 48) return `${(h / 24).toFixed(1)} days`
  return `${h.toFixed(1)} h`
}
</script>

<style scoped>
.generator-preview {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--app-border);
  border-radius: 8px;
  background: var(--app-surface-muted);
}

.preview-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.stat {
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  border-left: 4px solid;
  background: var(--app-surface);
}

.stat-true {
  border-left-color: var(--app-true);
}

.stat-false {
  border-left-color: var(--app-false);
}

.stat-label {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--app-text-3);
}

.stat-value {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--app-text);
}

.stat-sub {
  font-size: 0.85rem;
  color: var(--app-text-2);
}

.preview-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.existing-hint {
  margin-left: auto;
  font-size: 0.85rem;
}

@media (max-width: 600px) {
  .existing-hint {
    margin-left: 0;
    width: 100%;
  }
}
</style>
