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
    
    <n-form-item label="Long-Lived Access Token" path="token">
      <n-input
        v-model:value="formModel.token"
        type="password"
        show-password-on="click"
        placeholder="Enter your access token"
        :disabled="props.isConnected"
      />
      <template #feedback>
        Get this from your Home Assistant profile page
      </template>
    </n-form-item>
    
    <n-collapse>
      <n-collapse-item title="CORS Setup Instructions" name="cors">
        <n-alert type="info" :show-icon="false">
          <n-text>Add this to your </n-text>
          <n-code>configuration.yaml</n-code>
          <n-text>:</n-text>
          <n-code code="http:
  cors_allowed_origins:
    - &quot;http://localhost:5173&quot;
    - &quot;http://127.0.0.1:5173&quot;" language="yaml" />
          <n-text>Then restart Home Assistant.</n-text>
        </n-alert>
      </n-collapse-item>
    </n-collapse>
    
    <n-space vertical>
      <n-button 
        type="primary" 
        block 
        attr-type="submit"
        :loading="isConnecting"
        :disabled="props.isConnected"
      >
        {{ props.isConnected ? 'Connected' : (isConnecting ? 'Connecting...' : 'Connect') }}
      </n-button>
      
      <n-alert 
        v-if="error || props.connectionError" 
        type="error"
        closable
        @close="error = ''"
      >
        {{ error || props.connectionError }}
        <template v-if="(error || props.connectionError)?.includes('CORS')">
          <n-divider />
          <n-text strong>CORS Error Solution:</n-text>
          <br />
          <n-text>Add this to your Home Assistant </n-text>
          <n-code>configuration.yaml</n-code>
          <n-text>:</n-text>
          <n-code code="http:
  cors_allowed_origins:
    - &quot;http://localhost:5173&quot;
    - &quot;http://127.0.0.1:5173&quot;" language="yaml" />
          <n-text>Then restart Home Assistant and try connecting again.</n-text>
        </template>
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
  NCode,
  NText,
  NDivider,
  type FormInst,
  type FormRules
} from 'naive-ui'
import type { HAConnection } from '../types/homeAssistant'

const props = defineProps<{
  isConnected?: boolean
  connectionError?: string | null
  isAutoConnecting?: boolean
}>()

const emit = defineEmits<{
  connect: [connection: HAConnection]
  connectionStatus: [status: boolean]
}>()

const formRef = ref<FormInst | null>(null)
const isConnecting = ref(false)
const error = ref('')

const formModel = reactive({
  url: '',
  token: ''
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
          new URL(value)
          return true
        } catch {
          return new Error('Please enter a valid URL')
        }
      },
      trigger: ['blur']
    }
  ],
  token: [
    {
      required: true,
      message: 'Please enter your access token',
      trigger: ['blur', 'input']
    }
  ]
}

onMounted(() => {
  const savedUrl = localStorage.getItem('ha_url')
  const savedToken = localStorage.getItem('ha_token')
  
  if (savedUrl) formModel.url = savedUrl
  if (savedToken) formModel.token = savedToken
})

const handleConnect = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  
  isConnecting.value = true
  error.value = ''
  
  const connection: HAConnection = {
    url: formModel.url,
    token: formModel.token
  }
  
  localStorage.setItem('ha_url', formModel.url)
  localStorage.setItem('ha_token', formModel.token)
  
  emit('connect', connection)
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