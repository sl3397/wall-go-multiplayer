import type { GameSnapshot, Player } from '@/lib/types'
import { serializeSnapshot, deserializeSnapshot } from './serialize'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export interface MultiplayerCallbacks {
  onStatusChange?: (status: ConnectionStatus) => void
  onStateUpdate?: (snapshot: GameSnapshot) => void
  onOpponentLeft?: () => void
  onOpponentJoined?: () => void
  onOpponentRejoined?: () => void
  onReset?: () => void
  onRejoined?: (snapshot: GameSnapshot | null) => void
}

export class MultiplayerClient {
  private ws: WebSocket | null = null
  private callbacks: MultiplayerCallbacks = {}
  private applyingRemote = false
  private serverUrl: string
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = false
  private reconnectDelay = 2000
  roomCode: string | null = null
  side: Player | null = null

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl
  }

  setCallbacks(callbacks: MultiplayerCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.shouldReconnect = true
      this.callbacks.onStatusChange?.('connecting')

      let resolved = false

      try {
        this.ws = new WebSocket(this.serverUrl)
      } catch (e) {
        reject(e)
        return
      }

      this.ws.onopen = () => {
        resolved = true
        this.callbacks.onStatusChange?.('connected')
        this.startHeartbeat()
        this.reconnectDelay = 2000
        resolve()
      }

      this.ws.onclose = () => {
        this.callbacks.onStatusChange?.('disconnected')
        this.stopHeartbeat()
        if (!resolved) {
          reject(new Error('WebSocket connection failed'))
        } else if (this.shouldReconnect) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = () => {
        if (!resolved) {
          reject(new Error('WebSocket connection failed'))
        }
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.callbacks.onStatusChange?.('connecting')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.shouldReconnect) return

      try {
        this.ws = new WebSocket(this.serverUrl)

        this.ws.onopen = () => {
          this.callbacks.onStatusChange?.('connected')
          this.startHeartbeat()
          this.reconnectDelay = 2000

          // Rejoin room if we were in one
          if (this.roomCode && this.side) {
            this.ws?.send(JSON.stringify({ type: 'rejoin', roomCode: this.roomCode, side: this.side }))
          }
        }

        this.ws.onclose = () => {
          this.callbacks.onStatusChange?.('disconnected')
          this.stopHeartbeat()
          if (this.shouldReconnect) {
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000)
            this.scheduleReconnect()
          }
        }

        this.ws.onerror = () => {
          // Error is followed by close
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }
      } catch {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000)
        this.scheduleReconnect()
      }
    }, this.reconnectDelay)
  }

  private handleMessage(data: any) {
    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }

    switch (msg.type) {
      case 'created':
        this.roomCode = msg.roomCode
        this.side = msg.side
        break
      case 'joined':
        this.roomCode = msg.roomCode
        this.side = msg.side
        this.callbacks.onOpponentJoined?.()
        break
      case 'rejoined':
        this.roomCode = msg.roomCode
        this.side = msg.side
        if (msg.snapshot) {
          this.applyingRemote = true
          try {
            const snapshot = deserializeSnapshot(JSON.stringify(msg.snapshot))
            this.callbacks.onRejoined?.(snapshot)
          } catch (e) {
            console.error('[WallGo] Failed to deserialize rejoin snapshot:', e)
            this.callbacks.onRejoined?.(null)
          } finally {
            this.applyingRemote = false
          }
        } else {
          this.callbacks.onRejoined?.(null)
        }
        break
      case 'opponent_joined':
        this.callbacks.onOpponentJoined?.()
        break
      case 'opponent_rejoined':
        this.callbacks.onOpponentRejoined?.()
        break
      case 'opponent_left':
        this.callbacks.onOpponentLeft?.()
        break
      case 'state':
        if (msg.snapshot) {
          this.applyingRemote = true
          try {
            const snapshot = deserializeSnapshot(JSON.stringify(msg.snapshot))
            this.callbacks.onStateUpdate?.(snapshot)
          } catch (e) {
            console.error('[WallGo] Failed to deserialize snapshot:', e)
          } finally {
            this.applyingRemote = false
          }
        }
        break
      case 'reset':
        this.callbacks.onReset?.()
        break
      case 'pong':
        break
    }
  }

  createRoom() {
    if (!this.ws || this.ws.readyState !== 1) return
    this.ws.send(JSON.stringify({ type: 'create' }))
  }

  joinRoom(code: string) {
    if (!this.ws || this.ws.readyState !== 1) return
    this.ws.send(JSON.stringify({ type: 'join', roomCode: code }))
  }

  rejoinRoom(code: string, side: Player) {
    if (!this.ws || this.ws.readyState !== 1) return
    this.roomCode = code
    this.side = side
    this.ws.send(JSON.stringify({ type: 'rejoin', roomCode: code, side }))
  }

  sendState(snapshot: GameSnapshot) {
    if (!this.ws || this.ws.readyState !== 1) return
    if (this.applyingRemote) return
    try {
      const data = serializeSnapshot(snapshot)
      this.ws.send(JSON.stringify({ type: 'state', snapshot: JSON.parse(data) }))
    } catch (e) {
      console.error('[WallGo] Failed to send state:', e)
    }
  }

  sendReset() {
    if (!this.ws || this.ws.readyState !== 1) return
    this.ws.send(JSON.stringify({ type: 'reset' }))
  }

  leaveRoom() {
    if (!this.ws || this.ws.readyState !== 1) return
    this.ws.send(JSON.stringify({ type: 'leave' }))
    this.roomCode = null
    this.side = null
  }

  disconnect() {
    this.shouldReconnect = false
    this.leaveRoom()
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }))
        } catch {
          // ignore
        }
      }
    }, 25000)
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  get isRemoteApplying() {
    return this.applyingRemote
  }

  get isConnected() {
    return this.ws !== null && this.ws.readyState === 1
  }
}
