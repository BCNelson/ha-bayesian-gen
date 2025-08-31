<template>
  <div class="connection-form">
    <h2>Connect to Home Assistant</h2>
    <form @submit.prevent="handleConnect">
      <div class="form-group">
        <label for="url">Home Assistant URL</label>
        <input
          id="url"
          v-model="url"
          type="url"
          placeholder="http://homeassistant.local:8123"
          required
        />
        <small>Include the protocol (http/https) and port if needed</small>
      </div>
      
      <div class="form-group">
        <label for="token">Long-Lived Access Token</label>
        <input
          id="token"
          v-model="token"
          type="password"
          placeholder="Enter your access token"
          required
        />
        <small>Get this from your Home Assistant profile page</small>
      </div>
      
      <div class="cors-notice">
        <p><strong>📝 Note:</strong> You may need to configure CORS in Home Assistant for this to work.</p>
        <details>
          <summary>Click here for CORS setup instructions</summary>
          <div class="cors-setup">
            <p>Add this to your <code>configuration.yaml</code>:</p>
            <pre><code>http:
  cors_allowed_origins:
    - "http://localhost:5173"
    - "http://127.0.0.1:5173"</code></pre>
            <p>Then restart Home Assistant.</p>
          </div>
        </details>
      </div>
      
      <div class="form-actions">
        <button type="submit" :disabled="isConnecting">
          {{ isConnecting ? 'Connecting...' : 'Connect' }}
        </button>
      </div>
      
      <div v-if="error || props.connectionError" class="error">
        {{ error || props.connectionError }}
        <div v-if="(error || props.connectionError)?.includes('CORS')" class="cors-help">
          <p><strong>CORS Error Solution:</strong></p>
          <p>Add this to your Home Assistant <code>configuration.yaml</code>:</p>
          <pre><code>http:
  cors_allowed_origins:
    - "http://localhost:5173"
    - "http://127.0.0.1:5173"</code></pre>
          <p>Then restart Home Assistant and try connecting again.</p>
        </div>
      </div>
      
      <div v-if="props.isAutoConnecting" class="info">
        Connecting automatically with saved credentials...
      </div>
      
      <div v-if="props.isConnected" class="success">
        Connected successfully!
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
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

const url = ref('')
const token = ref('')
const isConnecting = ref(false)
const error = ref('')

onMounted(() => {
  const savedUrl = localStorage.getItem('ha_url')
  const savedToken = localStorage.getItem('ha_token')
  
  if (savedUrl) url.value = savedUrl
  if (savedToken) token.value = savedToken
})

const handleConnect = () => {
  isConnecting.value = true
  error.value = ''
  
  const connection: HAConnection = {
    url: url.value,
    token: token.value
  }
  
  localStorage.setItem('ha_url', url.value)
  localStorage.setItem('ha_token', token.value)
  
  emit('connect', connection)
}

watch(() => [props.isConnected, props.connectionError], () => {
  isConnecting.value = false
})
</script>

<style scoped>
.connection-form {
  max-width: 500px;
  margin: 0 auto;
  padding: 2rem;
  background: #f5f5f5;
  border-radius: 8px;
}

h2 {
  margin-bottom: 1.5rem;
  color: #333;
}

.form-group {
  margin-bottom: 1.5rem;
}

label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #555;
}

input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

input:focus {
  outline: none;
  border-color: #4CAF50;
}

small {
  display: block;
  margin-top: 0.25rem;
  color: #777;
  font-size: 0.875rem;
}

.form-actions {
  margin-top: 1.5rem;
}

button {
  width: 100%;
  padding: 0.75rem;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.3s;
}

button:hover:not(:disabled) {
  background: #45a049;
}

button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.error {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #ffebee;
  color: #c62828;
  border-radius: 4px;
}

.success {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #e8f5e9;
  color: #2e7d32;
  border-radius: 4px;
}

.info {
  margin-top: 1rem;
  padding: 0.75rem;
  background: #e3f2fd;
  color: #1976d2;
  border-radius: 4px;
}

.cors-help {
  margin-top: 1rem;
  padding: 1rem;
  background: #fff3e0;
  border: 1px solid #ffcc02;
  border-radius: 4px;
}

.cors-help p {
  margin: 0.5rem 0;
}

.cors-help code {
  background: #f5f5f5;
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
  font-family: monospace;
}

.cors-help pre {
  background: #f8f8f8;
  padding: 0.75rem;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0.5rem 0;
}

.cors-help pre code {
  background: none;
  padding: 0;
}

.cors-notice {
  margin: 1rem 0;
  padding: 1rem;
  background: #e3f2fd;
  border: 1px solid #2196f3;
  border-radius: 4px;
  font-size: 0.9rem;
}

.cors-notice p {
  margin: 0 0 0.5rem 0;
  color: #1976d2;
}

.cors-notice details {
  margin-top: 0.5rem;
}

.cors-notice summary {
  cursor: pointer;
  color: #1976d2;
  font-weight: 500;
}

.cors-notice summary:hover {
  text-decoration: underline;
}

.cors-setup {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #bbdefb;
}

.cors-setup p {
  color: #333;
  margin: 0.5rem 0;
}

.cors-setup pre {
  background: #f8f8f8;
  padding: 0.75rem;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0.5rem 0;
}

.cors-setup code {
  background: #f5f5f5;
  padding: 0.2rem 0.4rem;
  border-radius: 3px;
  font-family: monospace;
}

.cors-setup pre code {
  background: none;
  padding: 0;
}
</style>