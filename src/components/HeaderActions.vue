<template>
  <div class="header-actions">
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button quaternary size="small" :aria-label="`Theme: ${themeLabel}`" @click="cycleTheme">
          <span class="theme-icon" aria-hidden="true">{{ themeIcon }}</span>
          <span class="action-text">{{ themeLabel }}</span>
        </n-button>
      </template>
      Theme: {{ themeLabel }} (click to change)
    </n-tooltip>
    <n-button quaternary size="small" @click="confirmReset">
      <span class="action-text-always">Reset</span>
    </n-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NTooltip, useDialog } from 'naive-ui'

export type ThemePreference = 'auto' | 'light' | 'dark'

const props = defineProps<{
  theme: ThemePreference
}>()

const emit = defineEmits<{
  'update:theme': [value: ThemePreference]
  reset: []
}>()

const dialog = useDialog()

const ORDER: ThemePreference[] = ['auto', 'light', 'dark']
const themeLabel = computed(() => ({ auto: 'Auto', light: 'Light', dark: 'Dark' })[props.theme])
const themeIcon = computed(() => ({ auto: '◐', light: '☀', dark: '☾' })[props.theme])

const cycleTheme = () => {
  const next = ORDER[(ORDER.indexOf(props.theme) + 1) % ORDER.length]
  emit('update:theme', next)
}

const confirmReset = () => {
  dialog.warning({
    title: 'Reset session?',
    content:
      'This clears the current periods, period generator settings and selected entities. ' +
      'Your Home Assistant connection and other saved period sets are kept.',
    positiveText: 'Reset',
    negativeText: 'Cancel',
    onPositiveClick: () => emit('reset')
  })
}
</script>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.theme-icon {
  font-size: 1rem;
  line-height: 1;
}

.action-text {
  margin-left: 0.35rem;
}

@media (max-width: 640px) {
  .action-text {
    display: none;
  }
}
</style>
