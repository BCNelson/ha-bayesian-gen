<template>
  <div class="generator">
    <p class="generator-intro">
      Describe when the sensor should be <strong class="txt-true">TRUE</strong> as a weekly schedule
      (e.g. weeknights 23:00–07:00). Windows that end at or before their start time run past midnight.
    </p>

    <div class="generator-section">
      <h4 class="section-title txt-true">TRUE window</h4>
      <div class="form-grid">
        <n-form-item label="From" :show-feedback="false">
          <n-time-picker
            v-model:formatted-value="settings.trueStart"
            value-format="HH:mm"
            format="HH:mm"
            :actions="null"
          />
        </n-form-item>
        <n-form-item label="To" :show-feedback="false">
          <n-time-picker
            v-model:formatted-value="settings.trueEnd"
            value-format="HH:mm"
            format="HH:mm"
            :actions="null"
          />
        </n-form-item>
        <n-form-item label="Lookback" :show-feedback="false">
          <n-input-number v-model:value="settings.lookbackDays" :min="1" :max="365" :step="1">
            <template #suffix>days</template>
          </n-input-number>
        </n-form-item>
      </div>
      <WeekdayPicker v-model:value="settings.trueWeekdays" label="Starting on" />
    </div>

    <div class="generator-section">
      <h4 class="section-title txt-false">FALSE periods</h4>
      <n-radio-group v-model:value="settings.falseMode" size="small">
        <n-radio-button value="complement">Everything else</n-radio-button>
        <n-radio-button value="window">A specific window</n-radio-button>
      </n-radio-group>

      <template v-if="settings.falseMode === 'window'">
        <div class="form-grid">
          <n-form-item label="From" :show-feedback="false">
            <n-time-picker
              v-model:formatted-value="settings.falseStart"
              value-format="HH:mm"
              format="HH:mm"
              :actions="null"
            />
          </n-form-item>
          <n-form-item label="To" :show-feedback="false">
            <n-time-picker
              v-model:formatted-value="settings.falseEnd"
              value-format="HH:mm"
              format="HH:mm"
              :actions="null"
            />
          </n-form-item>
        </div>
        <WeekdayPicker v-model:value="settings.falseWeekdays" label="Starting on" />
      </template>
    </div>

    <div class="form-grid">
      <n-form-item label="Ignore periods shorter than" :show-feedback="false">
        <n-input-number v-model:value="settings.minDurationMinutes" :min="0" :step="5">
          <template #suffix>min</template>
        </n-input-number>
      </n-form-item>
      <n-form-item label="Trim around transitions" :show-feedback="false">
        <n-input-number v-model:value="settings.bufferMinutes" :min="0" :step="5">
          <template #suffix>min</template>
        </n-input-number>
      </n-form-item>
    </div>

    <GeneratorPreview :summary="summary" :existing-count="existingCount" @apply="apply" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NFormItem, NInputNumber, NRadioButton, NRadioGroup, NTimePicker } from 'naive-ui'
import GeneratorPreview from './GeneratorPreview.vue'
import WeekdayPicker from './WeekdayPicker.vue'
import type { TimePeriod } from '../../types/bayesian'
import { generateFromSchedule, lookbackRange, summarize, toTimePeriods } from '../../utils/periodGenerators'
import { STORAGE_KEYS, readSettings, writeJSON } from '../../utils/sessionStore'

defineProps<{
  existingCount: number
}>()

const emit = defineEmits<{
  apply: [periods: TimePeriod[], replace: boolean]
}>()

interface ScheduleGeneratorSettings {
  trueStart: string | null
  trueEnd: string | null
  trueWeekdays: number[]
  lookbackDays: number
  falseMode: 'complement' | 'window'
  falseStart: string | null
  falseEnd: string | null
  falseWeekdays: number[]
  minDurationMinutes: number
  bufferMinutes: number
}

const settings = ref<ScheduleGeneratorSettings>(
  readSettings<ScheduleGeneratorSettings>(STORAGE_KEYS.scheduleGenerator, {
    trueStart: '23:00',
    trueEnd: '07:00',
    trueWeekdays: [0, 1, 2, 3, 4], // Sun–Thu nights
    lookbackDays: 14,
    falseMode: 'complement',
    falseStart: '09:00',
    falseEnd: '17:00',
    falseWeekdays: [1, 2, 3, 4, 5],
    minDurationMinutes: 0,
    bufferMinutes: 0
  })
)

watch(settings, value => writeJSON(STORAGE_KEYS.scheduleGenerator, value), { deep: true })

// Re-anchor the lookback to "now" whenever settings change
const generated = computed(() => {
  const s = settings.value
  if (!s.trueStart || !s.trueEnd) return { trueSpans: [], falseSpans: [] }
  return generateFromSchedule({
    trueWindow: { startTime: s.trueStart, endTime: s.trueEnd, weekdays: s.trueWeekdays },
    falseWindow:
      s.falseMode === 'window' && s.falseStart && s.falseEnd
        ? { startTime: s.falseStart, endTime: s.falseEnd, weekdays: s.falseWeekdays }
        : null,
    range: lookbackRange(s.lookbackDays || 14),
    minDurationMinutes: s.minDurationMinutes ?? 0,
    bufferMinutes: s.bufferMinutes ?? 0
  })
})

const summary = computed(() => summarize(generated.value))

const apply = (replace: boolean) => {
  const s = settings.value
  emit('apply', toTimePeriods(generated.value, `Schedule ${s.trueStart}–${s.trueEnd}`), replace)
}
</script>
