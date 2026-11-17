<template>
  <div class="weekday-picker">
    <span class="weekday-label">{{ label }}</span>
    <n-checkbox-group :value="value" @update:value="update">
      <n-space :size="8" :wrap="true">
        <n-checkbox v-for="(day, index) in DAYS" :key="day" :value="index" :label="day" />
      </n-space>
    </n-checkbox-group>
    <n-space :size="4" class="weekday-presets">
      <n-button v-for="preset in PRESETS" :key="preset.label" size="tiny" quaternary @click="update(preset.days)">
        {{ preset.label }}
      </n-button>
    </n-space>
  </div>
</template>

<script setup lang="ts">
import { NButton, NCheckbox, NCheckboxGroup, NSpace } from 'naive-ui'

defineProps<{
  value: number[]
  label?: string
}>()

const emit = defineEmits<{
  'update:value': [value: number[]]
}>()

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PRESETS = [
  { label: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'School nights (Sun–Thu)', days: [0, 1, 2, 3, 4] },
  { label: 'Weekends', days: [0, 6] }
]

const update = (value: (string | number)[]) => {
  emit('update:value', value.map(Number).sort((a, b) => a - b))
}
</script>

<style scoped>
.weekday-picker {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.weekday-label {
  font-size: 0.85rem;
  color: var(--app-text-2);
}

.weekday-presets {
  margin-left: -0.35rem;
}
</style>
