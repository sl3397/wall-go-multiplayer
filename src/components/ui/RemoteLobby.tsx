import { useState, useRef, useEffect, useCallback } from 'react'
import GameButton from './GameButton'
import LanguageThemeSwitcher from './LanguageThemeSwitcher'
import { MultiplayerClient, type ConnectionStatus } from '@/multiplayer/client'
import { WS_SERVER_URL } from '@/multiplayer/config'
import type { Player } from '@/lib/types'

type LobbyState = 'menu' | 'creating' | 'waiting' | 'joining' | 'connected' | 'error'

export default function RemoteLobby({
  onReady,
  onBack,
}: {
  onReady: (client: MultiplayerClient, side: Player) => void
  onBack: () => void
}) {
  const [lobbyState, setLobbyState] = useState<LobbyState>('menu')
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('disconnected')
  const clientRef = useRef<MultiplayerClient | null>(null)
  const [dark, setDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme')
      if (stored === 'dark') return true
      if (stored === 'light') return false
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  })

  useEffect(() => {
    const root = document.documentElement
    if (dark) {
      root.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      root.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }, [dark])

  const connectAndCreate = useCallback(async () => {
    setLobbyState('creating')
    setErrorMsg('')
    try {
      const client = new MultiplayerClient(WS_SERVER_URL)
      clientRef.current = client
      client.setCallbacks({
        onStatusChange: (s) => setConnStatus(s),
        onOpponentJoined: () => {
          const side = client.side
          if (side) {
            setLobbyState('connected')
            setTimeout(() => onReady(client, side), 500)
          }
        },
        onOpponentLeft: () => {
          setErrorMsg('Opponent left the room')
          setLobbyState('error')
        },
      })
      await client.connect()
      client.createRoom()
      const checkCode = setInterval(() => {
        if (client.roomCode) {
          setRoomCode(client.roomCode)
          setLobbyState('waiting')
          clearInterval(checkCode)
        }
      }, 100)
      setTimeout(() => clearInterval(checkCode), 5000)
    } catch (e) {
      setErrorMsg('Failed to connect to server. Make sure the server is running.')
      setLobbyState('error')
    }
  }, [onReady])

  const connectAndJoin = useCallback(async () => {
    if (!joinCode.trim()) return
    setLobbyState('joining')
    setErrorMsg('')
    try {
      const client = new MultiplayerClient(WS_SERVER_URL)
      clientRef.current = client
      client.setCallbacks({
        onStatusChange: (s) => setConnStatus(s),
        onOpponentLeft: () => {
          setErrorMsg('Opponent left the room')
          setLobbyState('error')
        },
      })
      await client.connect()
      client.joinRoom(joinCode.trim().toUpperCase())
      const checkJoin = setInterval(() => {
        const side = client.side
        if (side) {
          setLobbyState('connected')
          clearInterval(checkJoin)
          setTimeout(() => onReady(client, side), 500)
        }
      }, 100)
      setTimeout(() => {
        clearInterval(checkJoin)
        if (!client.side) {
          setErrorMsg('Room not found or connection failed')
          setLobbyState('error')
        }
      }, 5000)
    } catch (e) {
      setErrorMsg('Failed to connect to server. Make sure the server is running.')
      setLobbyState('error')
    }
  }, [joinCode, onReady])

  useEffect(() => {
    return () => {
      // Don't disconnect here - the client is passed to Game.tsx via onReady
      // and stays alive. Disconnection is handled by App.tsx handleHome.
    }
  }, [])

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-gradient-to-br from-rose-50 via-indigo-50 to-amber-50 dark:from-zinc-900 dark:via-zinc-800 dark:to-zinc-900 p-4">
      <div className="fixed top-0 w-full flex justify-end gap-2 mb-2 p-4">
        <LanguageThemeSwitcher dark={dark} setDark={setDark} />
      </div>

      <h1 className="text-3xl font-extrabold mb-2 text-zinc-800 dark:text-zinc-100 drop-shadow animate-fade-in">
        Wall Go · Remote Play
      </h1>
      <p className="text-zinc-600 dark:text-zinc-300 mb-8 text-center max-w-sm">
        Play with a friend online. One creates a room, the other joins with the code.
      </p>

      {lobbyState === 'menu' && (
        <div className="flex flex-col gap-4 w-full max-w-xs animate-fade-in">
          <GameButton
            onClick={connectAndCreate}
            className="text-lg py-3"
          >
            Create Room
          </GameButton>
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter room code"
              maxLength={4}
              className="rounded border border-zinc-300 dark:border-zinc-600 px-3 py-2 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 text-center text-lg font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <GameButton
              onClick={connectAndJoin}
              disabled={!joinCode.trim()}
              className="text-lg py-3"
            >
              Join Room
            </GameButton>
          </div>
          <GameButton
            onClick={onBack}
            className="!bg-transparent !shadow-none !border-0 text-sm text-zinc-500 hover:underline hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            text
          >
            Back to Menu
          </GameButton>
        </div>
      )}

      {lobbyState === 'creating' && (
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full" />
          <p className="text-zinc-600 dark:text-zinc-300">Connecting to server...</p>
        </div>
      )}

      {lobbyState === 'waiting' && (
        <div className="flex flex-col items-center gap-6 animate-fade-in">
          <p className="text-zinc-600 dark:text-zinc-300">Share this code with your friend:</p>
          <div className="text-5xl font-extrabold font-mono tracking-[0.3em] px-8 py-4 rounded-2xl bg-white dark:bg-zinc-800 shadow-lg border-2 border-indigo-300 dark:border-indigo-600 text-indigo-600 dark:text-indigo-300">
            {roomCode}
          </div>
          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span>Waiting for opponent to join...</span>
          </div>
          <GameButton
            onClick={() => {
              clientRef.current?.disconnect()
              clientRef.current = null
              setLobbyState('menu')
              setRoomCode('')
            }}
            className="!bg-transparent !shadow-none !border-0 text-sm text-zinc-500 hover:underline hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            text
          >
            Cancel
          </GameButton>
        </div>
      )}

      {lobbyState === 'joining' && (
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full" />
          <p className="text-zinc-600 dark:text-zinc-300">Joining room {joinCode}...</p>
        </div>
      )}

      {lobbyState === 'connected' && (
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="text-4xl">🎮</div>
          <p className="text-zinc-600 dark:text-zinc-300">Connected! Starting game...</p>
        </div>
      )}

      {lobbyState === 'error' && (
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="text-4xl">⚠️</div>
          <p className="text-rose-500 dark:text-rose-400 text-center max-w-sm">{errorMsg}</p>
          <GameButton
            onClick={() => {
              clientRef.current?.disconnect()
              clientRef.current = null
              setLobbyState('menu')
              setRoomCode('')
              setJoinCode('')
              setErrorMsg('')
            }}
            className="text-lg py-2"
          >
            Back
          </GameButton>
        </div>
      )}

      {connStatus === 'connecting' && lobbyState !== 'creating' && lobbyState !== 'joining' && (
        <p className="text-zinc-400 text-sm mt-4">Connecting...</p>
      )}
    </div>
  )
}
