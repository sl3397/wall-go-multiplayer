// Auto-detect WebSocket server URL:
// 1. If VITE_WS_SERVER_URL is set (env var), use it
// 2. Otherwise, connect to the same host the page is served from
//    (http:// → ws://, https:// → wss://)
export function getWsServerUrl(): string {
  const envUrl = (import.meta.env.VITE_WS_SERVER_URL as string) || ''
  if (envUrl) return envUrl

  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}`
  }

  return 'ws://localhost:8080'
}

export const WS_SERVER_URL = getWsServerUrl()
