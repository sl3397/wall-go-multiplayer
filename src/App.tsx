import { useCallback, useEffect, useState } from 'react'
import Game from './components/Game'
import Footer from './components/ui/Footer'
import GameModeMenu from './components/ui/GameModeMenu'
import RemoteLobby from './components/ui/RemoteLobby'
import RuleDialog from './components/ui/RuleDialog'
import SeoHelmet from './components/SeoHelmet'
import type { AiLevel, GameMode, AiSide, Player } from './lib/types'
import type { MultiplayerClient } from './multiplayer/client'

export default function App() {
  const [showRule, setShowRule] = useState(false)
  const [mode, setMode] = useState<GameMode | null>(null)
  const [aiSide, setAiSide] = useState<AiSide>('B')
  const [aiLevel, setAiLevel] = useState<AiLevel>('middle')
  const [remoteClient, setRemoteClient] = useState<MultiplayerClient | null>(null)
  const [localSide, setLocalSide] = useState<Player | null>(null)
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

  const handleHome = useCallback(() => {
    if (remoteClient) {
      remoteClient.disconnect()
    }
    setRemoteClient(null)
    setLocalSide(null)
    setMode(null)
  }, [remoteClient])

  return (
    <>
      <SeoHelmet />
      {mode === null || mode === undefined ? (
        <GameModeMenu
          setMode={(m) => {
            setMode(m)
          }}
          setAiSide={setAiSide}
          setAiLevel={setAiLevel}
          setShowRule={setShowRule}
          onRemotePlay={() => setMode('remote')}
        />
      ) : mode === 'remote' && !remoteClient ? (
        <RemoteLobby
          onReady={(client, side) => {
            setRemoteClient(client)
            setLocalSide(side)
          }}
          onBack={handleHome}
        />
      ) : (
        <Game
          gameMode={mode}
          aiSide={aiSide}
          aiLevel={aiLevel}
          setGameMode={setMode}
          setShowRule={setShowRule}
          dark={dark}
          setDark={setDark}
          remoteClient={remoteClient}
          localSide={localSide}
          onRemoteHome={handleHome}
        />
      )}
      <Footer />
      <RuleDialog open={showRule} onClose={() => setShowRule(false)} />
    </>
  )
}
