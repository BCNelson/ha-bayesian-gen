<template>
  <n-form
    ref="formRef"
    :model="formModel"
    :rules="rules"
    label-placement="top"
    @submit.prevent="handleConnect"
  >
    <n-form-item label="Home Assistant URL" path="url">
      <n-input
        v-model:value="formModel.url"
        placeholder="http://homeassistant.local:8123"
        :disabled="props.isConnected"
      />
      <template #feedback>
        Include the protocol (http/https) and port if needed
      </template>
    </n-form-item>

    <n-form-item label="Sign-in method" path="method">
      <n-radio-group v-model:value="formModel.method" :disabled="props.isConnected">
        <n-space vertical>
          <n-radio value="oauth">Log in with Home Assistant (recommended)</n-radio>
          <n-radio value="token">Long-lived access token</n-radio>
        </n-space>
      </n-radio-group>
    </n-form-item>

    <n-form-item v-if="formModel.method === 'token'" label="Long-Lived Access Token" path="token">
      <n-input
        v-model:value="formModel.token"
        type="password"
        show-password-on="click"
        placeholder="Enter your access token"
        :disabled="props.isConnected"
      />
      <template #feedback>
        Create one under your Home Assistant profile → Security → Long-lived access tokens
      </template>
    </n-form-item>

    <n-form-item :show-feedback="false" :show-label="false">
      <n-checkbox v-model:checked="formModel.remember" :disabled="props.isConnected">
        Remember me on this browser
      </n-checkbox>
    </n-form-item>

    <n-space vertical>
      <n-button
        v-if="!props.isConnected"
        type="primary"
        block
        attr-type="submit"
        :loading="isConnecting"
      >
        {{ isConnecting ? 'Connecting...' : (formModel.method === 'oauth' ? 'Log in & Connect' : 'Connect') }}
      </n-button>

      <n-space v-else>
        <n-button @click="emit('disconnect', false)">Disconnect</n-button>
        <n-button type="error" ghost @click="handleForget">Disconnect &amp; forget credentials</n-button>
      </n-space>

      <n-alert
        v-if="error || props.connectionError"
        type="error"
        closable
        @close="error = ''"
      >
        {{ error || props.connectionError }}
      </n-alert>

      <n-alert
        v-if="props.isAutoConnecting"
        type="info"
      >
        Connecting automatically with saved credentials...
      </n-alert>

      <n-alert
        v-if="props.isConnected"
        type="success"
      >
        Connected successfully!
      </n-alert>

      <n-collapse>
        <n-collapse-item title="Troubleshooting" name="troubleshooting">
          <n-text depth="3">
            This app talks to Home Assistant over its WebSocket API, which needs no CORS setup.
            The login option additionally calls Home Assistant's <n-text code>/auth/token</n-text> endpoint from
            this page; if login fails with a network error, a reverse proxy in front of Home Assistant may be
            stripping CORS headers — use a long-lived access token instead. Pages served over HTTPS cannot
            connect to a plain-HTTP Home Assistant URL.
          </n-text>
        </n-collapse-item>
      </n-collapse>
    </n-space>
  </n-form>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, reactive } from 'vue'
import {
  NForm,
  NFormItem,
  NInput,
  NButton,
  NAlert,
  NSpace,
  NCollapse,
  NCollapseItem,
  NText,
  NRadioGroup,
  NRadio,
  NCheckbox,
  type FormInst,
  type FormRules
} from 'naive-ui'
import type { HAAuthMethod, HAConnection } from '../types/homeAssistant'
import { getLastUsedUrl, getSavedConnection } from '../services/haAuth'

const props = defineProps<{
  isConnected?: boolean
  connectionError?: string | null
  isAutoConnecting?: boolean
}>()

const emit = defineEmits<{
  connect: [connection: HAConnection]
  disconnect: [forget: boolean]
  connectionStatus: [status: boolean]
}>()

const formRef = ref<FormInst | null>(null)
const isConnecting = ref(false)
const error = ref('')

const formModel = reactive({
  url: '',
  method: 'oauth' as HAAuthMethod,
  token: '',
  remember: true
})

const rules: FormRules = {
  url: [
    {
      required: true,
      message: 'Please enter the Home Assistant URL',
      trigger: ['blur', 'input']
    },
    {
      validator(_, value) {
        if (!value) return true
        try {
          const u = new URL(value)
          return u.protocol === 'http:' || u.protocol === 'https:'
            ? true
            : new Error('URL must start with http:// or https://')
        } catch {
          return new Error('Please enter a valid URL')
        }
      },
      trigger: ['blur']
    }
  ],
  token: [
    {
      validator(_, value) {
        if (formModel.method === 'token' && !value) return new Error('Please enter your access token')
        return true
      },
      trigger: ['blur', 'input']
    }
  ]
}

onMounted(() => {
  const saved = getSavedConnection()
  if (saved) {
    formModel.url = saved.url
    formModel.method = saved.method
    formModel.token = saved.token ?? ''
  } else {
    formModel.url = getLastUsedUrl() ?? ''
  }
})

const handleConnect = async () => {
  const valid = await formRef.value?.validate().then(() => true).catch(() => false)
  if (!valid) return

  isConnecting.value = true
  error.value = ''

  const connection: HAConnection = {
    url: formModel.url,
    method: formModel.method,
    token: formModel.method === 'token' ? formModel.token : undefined,
    remember: formModel.remember
  }

  emit('connect', connection)
}

const handleForget = () => {
  formModel.token = ''
  emit('disconnect', true)
}

watch(() => [props.isConnected, props.connectionError], () => {
  isConnecting.value = false
})
</script>

<style scoped>
:deep(.n-form) {
  max-width: 500px;
}
</style>
