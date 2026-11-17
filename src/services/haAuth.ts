/**
 * Authentication helpers around home-assistant-js-websocket.
 *
 * Primary path: HA's own OAuth2 login (`getAuth`). The client_id is this app's
 * origin (library default `genClientId()`); HA redirects back to the current
 * page with `?auth_callback=1&code=...&state=...`, which we exchange for tokens
 * on load and then strip from the URL.
 *
 * Secondary path: long-lived access token (`createLongLivedTokenAuth`).
 */
import {
  getAuth,
  createLongLivedTokenAuth,
  ERR_CANNOT_CONNECT,
  ERR_INVALID_AUTH,
  ERR_CONNECTION_LOST,
  ERR_HASS_HOST_REQUIRED,
  ERR_INVALID_HTTPS_TO_HTTP,
  ERR_INVALID_AUTH_CALLBACK,
  type Auth,
  type AuthData
} from 'home-assistant-js-websocket'
import type { HAConnection } from '../types/homeAssistant'

const KEY_URL = 'ha_url'
const KEY_TOKEN = 'ha_token'
const KEY_METHOD = 'ha_auth_method'
const KEY_OAUTH_TOKENS = 'ha_oauth_tokens'
/** sessionStorage: survives the OAuth redirect round-trip */
const KEY_PENDING_REMEMBER = 'ha_oauth_pending_remember'

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export const normalizeHassUrl = (url: string) => url.trim().replace(/\/+$/, '')

/* ---------- token persistence ---------- */

const shouldRemember = () => {
  const pending = safe(() => sessionStorage.getItem(KEY_PENDING_REMEMBER), null)
  if (pending !== null) return pending === 'true'
  return safe(() => localStorage.getItem(KEY_METHOD), null) === 'oauth'
}

export const saveTokens = (data: AuthData | null) => {
  safe(() => {
    if (data === null) {
      localStorage.removeItem(KEY_OAUTH_TOKENS)
      sessionStorage.removeItem(KEY_OAUTH_TOKENS)
      return
    }
    const json = JSON.stringify(data)
    // Always keep tokens for this tab session; persist only with "remember me".
    sessionStorage.setItem(KEY_OAUTH_TOKENS, json)
    if (shouldRemember()) {
      localStorage.setItem(KEY_OAUTH_TOKENS, json)
      localStorage.setItem(KEY_URL, data.hassUrl)
      localStorage.setItem(KEY_METHOD, 'oauth')
    }
  }, undefined)
}

export const loadTokens = async (): Promise<AuthData | null> =>
  safe(() => {
    const raw = sessionStorage.getItem(KEY_OAUTH_TOKENS) ?? localStorage.getItem(KEY_OAUTH_TOKENS)
    return raw ? (JSON.parse(raw) as AuthData) : null
  }, null)

/* ---------- saved connection ("remember me") ---------- */

export function getSavedConnection(): HAConnection | null {
  return safe(() => {
    const url = localStorage.getItem(KEY_URL)
    if (!url) return null
    const method = localStorage.getItem(KEY_METHOD)
    const token = localStorage.getItem(KEY_TOKEN)
    if (method === 'oauth') {
      const hasTokens = !!(sessionStorage.getItem(KEY_OAUTH_TOKENS) ?? localStorage.getItem(KEY_OAUTH_TOKENS))
      return hasTokens ? { url, method: 'oauth', remember: true } : null
    }
    // Legacy (pre-websocket) saves have url+token but no method
    if (token) return { url, method: 'token', token, remember: true }
    return null
  }, null)
}

/** Last used URL/method, for pre-filling the form even if nothing is auto-connectable */
export function getLastUsedUrl(): string | null {
  return safe(() => localStorage.getItem(KEY_URL), null)
}

function persistConnection(connection: HAConnection) {
  safe(() => {
    if (!connection.remember) {
      for (const key of [KEY_URL, KEY_TOKEN, KEY_METHOD, KEY_OAUTH_TOKENS]) localStorage.removeItem(key)
      return
    }
    localStorage.setItem(KEY_URL, normalizeHassUrl(connection.url))
    localStorage.setItem(KEY_METHOD, connection.method)
    if (connection.method === 'token' && connection.token) {
      localStorage.setItem(KEY_TOKEN, connection.token)
      localStorage.removeItem(KEY_OAUTH_TOKENS)
    } else {
      localStorage.removeItem(KEY_TOKEN)
    }
  }, undefined)
}

export function forgetCredentials() {
  safe(() => {
    for (const key of [KEY_URL, KEY_TOKEN, KEY_METHOD, KEY_OAUTH_TOKENS]) localStorage.removeItem(key)
    sessionStorage.removeItem(KEY_OAUTH_TOKENS)
    sessionStorage.removeItem(KEY_PENDING_REMEMBER)
  }, undefined)
}

/* ---------- OAuth callback ---------- */

export function isAuthCallback(): boolean {
  return safe(() => new URLSearchParams(window.location.search).has('auth_callback'), false)
}

/** Remove auth_callback/code/state from the address bar without reloading. */
export function cleanAuthCallbackUrl() {
  safe(() => {
    const url = new URL(window.location.href)
    for (const p of ['auth_callback', 'code', 'state', 'storeToken']) url.searchParams.delete(p)
    window.history.replaceState(window.history.state, '', url.toString())
  }, undefined)
}

/** Exchange the `code` from an OAuth redirect for tokens. */
export async function completeAuthCallback(): Promise<Auth> {
  try {
    return await getAuth({ saveTokens, loadTokens })
  } finally {
    cleanAuthCallbackUrl()
  }
}

/* ---------- main entry ---------- */

/**
 * Resolve an Auth for the given connection settings.
 * For OAuth without stored tokens this navigates away to the HA login page
 * and the returned promise never resolves.
 */
export async function createAuth(connection: HAConnection): Promise<Auth> {
  const hassUrl = normalizeHassUrl(connection.url)
  if (connection.method === 'token') {
    if (!connection.token) throw new Error('An access token is required')
    persistConnection(connection)
    return createLongLivedTokenAuth(hassUrl, connection.token)
  }

  safe(() => sessionStorage.setItem(KEY_PENDING_REMEMBER, String(!!connection.remember)), undefined)
  persistConnection(connection)
  return getAuth({ hassUrl, saveTokens, loadTokens })
}

/** Map library error codes (numbers) and other errors to a readable message. */
export function describeAuthError(error: unknown): string {
  switch (error) {
    case ERR_CANNOT_CONNECT:
      return 'Unable to connect to Home Assistant. Check the URL and that HA is reachable from this browser.'
    case ERR_INVALID_AUTH:
      return 'Authentication failed: the token or login is invalid or expired.'
    case ERR_CONNECTION_LOST:
      return 'Connection to Home Assistant was lost.'
    case ERR_HASS_HOST_REQUIRED:
      return 'Please enter the Home Assistant URL.'
    case ERR_INVALID_HTTPS_TO_HTTP:
      return 'This page is served over HTTPS but Home Assistant uses HTTP; browsers block that. Use an HTTPS URL for Home Assistant.'
    case ERR_INVALID_AUTH_CALLBACK:
      return 'The login callback was invalid or expired. Please log in again.'
  }
  if (error instanceof Error) return error.message
  return 'Connection failed'
}
