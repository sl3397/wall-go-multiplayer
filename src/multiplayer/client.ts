import type { GameSnapshot, Player } from '@/lib/types'
import { serializeSnapshot, deserializeSnapshot } from './serialize'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export interface MultiplayerCallbacks {
  onStatusChange?: (status: ConnectionStatus) => void
  onStateUpdate?: (snapshot: GameSnapshot) => void
  onOpponentLeft?: () => void
  onOpponentJoined?: () => void
  onReset?: () => void
}

export class MultiplayerClient {
  private ws: WebSocket | null = null
  private callbacks: MultiplayerCallbacks = {}
  private applyingRemote = false
  private serverUrl: string
  roomCode: string | null = null
  side: Player | null = null

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl
  }

  setCallbacks(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.callbacks.onStatusChange?.('connecting')
      try {
        this.ws = new WebSocket(this.serverUrl)
      } catch (e) {
        reject(e)
        return
      }
      this.ws.onopen = () => {
        this.callbacks.onStatusChange?.('connected')
        resolve()
      }
      this.ws.onclose = () => {
        this.callbacks.onStatusChange?.('disconnected')
      }
      this.ws.onerror = (e) => {
        reject(e)
      }
      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }
    })
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
      case 'joined':
        this.roomCode = msg.roomCode
        this.side = msg.side
        if (msg.type === 'joined') {
          this.callbacks.onOpponentJoined?.()
        }
        break
      case 'opponent_joined':
        this.callbacks.onOpponentJoined?.()
        break
      case 'opponent_left':
        this.callbacks.onOpponentLeft?.()
        break
      case 'state':
        if (msg.snapshot) {
          this.applyingRemote = true
          const snapshot = deserializeSnapshot(JSON.stringify(msg.snapshot))
          this.callbacks.onStateUpdate?.(snapshot)
          this.applyingRemote = false
        }
        break
      case 'reset':
        this.callbacks.onReset?.()
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

  sendState(snapshot: GameSnapshot) {
    if (!this.ws || this.ws.readyState !== 1) return
    if (this.applyingRemote) return
    const data = serializeSnapshot(snapshot)
    this.ws.send(JSON.stringify({ type: 'state', snapshot: JSON.parse(data) }))
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
    this.leaveRoom()
    this.ws?.close()
    this.ws = null
  }

  get isRemoteApplying() {
    return this.applyingRemote
  }
}
