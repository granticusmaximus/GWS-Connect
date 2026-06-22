const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const shouldUseSameOrigin = (configuredUrl?: string) => {
  if (!configuredUrl?.trim()) {
    return true
  }

  if (typeof window === 'undefined') {
    return false
  }

  try {
    const resolvedUrl = new URL(configuredUrl, window.location.origin)
    return (
      LOCALHOST_HOSTNAMES.has(resolvedUrl.hostname) &&
      !LOCALHOST_HOSTNAMES.has(window.location.hostname)
    )
  } catch {
    return false
  }
}

const resolveConfiguredApiUrl = () => {
  const configuredUrl = import.meta.env.VITE_API_URL

  if (shouldUseSameOrigin(configuredUrl)) {
    return '/api'
  }

  if (!configuredUrl?.trim()) {
    return '/api'
  }

  return trimTrailingSlash(configuredUrl)
}

const resolveConfiguredSocketUrl = () => {
  const configuredUrl = import.meta.env.VITE_SOCKET_URL

  if (shouldUseSameOrigin(configuredUrl)) {
    return undefined
  }

  if (!configuredUrl?.trim() || configuredUrl.trim() === '/') {
    return undefined
  }

  return trimTrailingSlash(configuredUrl)
}

export const API_URL = resolveConfiguredApiUrl()
export const SOCKET_URL = resolveConfiguredSocketUrl()

const resolveIceServers = (): RTCIceServer[] => {
  const stunUrls = (import.meta.env.VITE_WEBRTC_STUN_URLS || 'stun:stun.l.google.com:19302')
    .split(',')
    .map((url: string) => url.trim())
    .filter(Boolean)
  const turnUrls = (import.meta.env.VITE_WEBRTC_TURN_URLS || '')
    .split(',')
    .map((url: string) => url.trim())
    .filter(Boolean)
  const turnUsername = import.meta.env.VITE_WEBRTC_TURN_USERNAME || undefined
  const turnCredential = import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL || undefined

  const servers: RTCIceServer[] = stunUrls.map((urls: string) => ({ urls }))

  if (turnUrls.length > 0) {
    servers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential })
  }

  return servers
}

export const WEBRTC_ICE_SERVERS = resolveIceServers()
