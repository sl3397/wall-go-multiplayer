import { PLAYER_LIST, type AiLevel, type PlayerAction, type State, type Player, type WallDir, type Pos } from '@/lib/types'
import GameButton from './ui/GameButton'
import Navbar from './ui/Navbar'
import Board from './Board/Board'
import { useTranslation } from 'react-i18next'
import { useGame } from '@/store/index'
import { checkGameEnd } from '@/utils/game'
import { useRef, useEffect, useCallback, useState } from 'react'
import { TurnManager } from '@/agents/TurnManager'
import { HumanAgent, RandomAgent, MinimaxAgent } from '@/agents'
import { snapshotFromState } from '@/store/gameState'
import ConfirmDialog from './ui/ConfirmDialog'
import TurnTimer from './ui/TurnTimer'
import type { MultiplayerClient } from '@/multiplayer/client'

export default function Game({
  gameMode,
  aiSide,
  aiLevel,
  setGameMode,
  setShowRule,
  dark,
  setDark,
  remoteClient,
  localSide,
  onRemoteHome,
}: {
  gameMode: 'pvp' | 'ai' | 'remote'
  aiSide: 'R' | 'B'
  aiLevel: AiLevel
  setGameMode: (m: 'pvp' | 'ai' | 'remote' | null) => void
  setShowRule: (b: boolean) => void
  dark: boolean
  setDark: (d: boolean | ((d: boolean) => boolean)) => void
  remoteClient: MultiplayerClient | null
  localSide: Player | null
  onRemoteHome: () => void
}) {
  const isRemote = gameMode === 'remote'

  const {
    board,
    turn,
    phase,
    result,
    selected,
    legal,
    placeStone,
    selectStone,
    moveTo,
    buildWall,
    setPhase,
    resetGame,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useGame()
  const live = checkGameEnd(board, [...PLAYER_LIST])
  const { t } = useTranslation()
  const [showConfirm, setShowConfirm] = useState(false)
  const [timeLeft, setTimeLeft] = useState(90_000)
  const turnTimeLimit = 90_000
  const [turnStart, setTurnStart] = useState<number | null>(null)

  // --- TurnManager (only for pvp/ai modes) ---
  const turnManagerRef = useRef<TurnManager | null>(null)
  const humanAgentRef = useRef<HumanAgent | null>(null)
  const latestStateRef = useRef<State | null>(null)
  useEffect(() => {
    latestStateRef.current = useGame.getState()
  }, [board, turn, selected, legal, phase, result])
  const turnManagerStartedRef = useRef(false)

  const setupTurnManager = useCallback(() => {
    if (!gameMode || isRemote) return
    const human = new HumanAgent()
    humanAgentRef.current = human
    const aiMap = {
      practice: new RandomAgent(),
      easy: new MinimaxAgent(2),
      middle: new MinimaxAgent(4),
      hard: new MinimaxAgent(6),
    }
    const ai = aiMap[aiLevel]
    const agents =
      gameMode === 'ai'
        ? aiSide === 'R'
          ? { R: ai, B: human }
          : { R: human, B: ai }
        : { R: human, B: human }
    turnManagerRef.current = new TurnManager({
      agents,
      getGameState: () => snapshotFromState(latestStateRef.current!),
      applyAction: async (action: PlayerAction) => {
        if (action.type === 'place') {
          placeStone(action.pos)
        } else if (action.type === 'move') {
          if (action.from) selectStone(action.from)
          moveTo(action.pos)
        } else if (action.type === 'wall' && action.dir) {
          if (action.from) selectStone(action.from)
          buildWall(action.pos, action.dir)
        }
      },
      isGameOver: (state) => state.phase === 'finished' || !!state.result,
      turnTimeLimit,
      onTurnStart: (state) => {
        if (state.phase !== 'playing') return
        setTurnStart(Date.now())
        setTimeLeft(turnTimeLimit)
      },
    })
    turnManagerStartedRef.current = false
  }, [gameMode, isRemote, aiSide, aiLevel, buildWall, moveTo, placeStone, selectStone])

  useEffect(() => {
    if (!gameMode) {
      useGame.getState().setHumanSide(null)
      return
    }
    if (isRemote) {
      useGame.getState().setHumanSide(localSide)
    } else if (gameMode === 'ai') {
      useGame.getState().setHumanSide(aiSide === 'R' ? 'B' : 'R')
    } else {
      useGame.getState().setHumanSide(null)
    }
  }, [gameMode, aiSide, isRemote, localSide])

  useEffect(() => {
    if (!gameMode) return
    setPhase('placing')
    if (!isRemote) {
      setupTurnManager()
    }
  }, [gameMode, aiSide, setPhase, setupTurnManager, isRemote])

  useEffect(() => {
    if (isRemote) return
    if (!turnManagerRef.current) return
    if ((phase === 'placing' || phase === 'playing') && !turnManagerStartedRef.current) {
      turnManagerRef.current.startLoop()
      turnManagerStartedRef.current = true
    }
  }, [phase, isRemote])

  const handlePlayerAction = useCallback((action: PlayerAction) => {
    humanAgentRef.current?.submitAction(action)
  }, [])

  // --- Remote mode: state sync ---
  const isApplyingRemoteRef = useRef(false)

  useEffect(() => {
    if (!isRemote || !remoteClient) return

    remoteClient.setCallbacks({
      onStateUpdate: (snapshot) => {
        isApplyingRemoteRef.current = true
        useGame.getState().loadSnapshot(snapshot)
        isApplyingRemoteRef.current = false
      },
      onReset: () => {
        isApplyingRemoteRef.current = true
        useGame.getState().resetGame()
        useGame.getState().setPhase('placing')
        isApplyingRemoteRef.current = false
      },
      onOpponentLeft: () => {
        setShowConfirm(false)
        onRemoteHome()
      },
    })

    const unsub = useGame.subscribe((state) => {
      if (!isApplyingRemoteRef.current && remoteClient) {
        const snap = snapshotFromState(state)
        remoteClient.sendState(snap)
      }
    })

    return () => {
      unsub()
    }
  }, [isRemote, remoteClient, onRemoteHome])

  const isHumanTurn = !isRemote && (turnManagerRef.current?.['agents']?.[turn] instanceof HumanAgent)
  const isLocalTurn = isRemote
    ? (localSide !== null && turn === localSide && phase !== 'finished')
    : (phase === 'placing' || isHumanTurn)

  const onTurnEnd = useCallback(() => {
    if (phase !== 'playing') return
    setTimeout(() => {
      if (live.finished) setPhase('finished')
    }, 0)
  }, [phase, live, setPhase])

  // Turn timer update (only for non-remote modes)
  useEffect(() => {
    if (isRemote) return
    if (turnStart === null) return
    let frame: number
    let stopped = false
    const update = () => {
      if (stopped) return
      setTimeLeft(Math.max(0, turnTimeLimit - (Date.now() - turnStart)))
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
  }, [turnStart, isRemote])

  useEffect(() => {
    if (phase === 'finished') {
      setTurnStart(null)
      setTimeLeft(0)
    }
  }, [phase])

  useEffect(() => {
    onTurnEnd()
  }, [onTurnEnd, turn, phase, result, live])

  // Remote: direct store calls
  const handleRemotePlace = useCallback((pos: Pos) => {
    useGame.getState().placeStone(pos)
  }, [])
  const handleRemoteSelect = useCallback((pos: Pos) => {
    useGame.getState().selectStone(pos)
  }, [])
  const handleRemoteMove = useCallback((pos: Pos) => {
    useGame.getState().moveTo(pos)
  }, [])
  const handleRemoteWall = useCallback((pos: Pos, dir: WallDir) => {
    useGame.getState().buildWall(pos, dir)
  }, [])

  const handleHome = () => {
    const inProgress =
      phase !== 'finished' && board.some((row) => row.some((c) => c.stone !== null))
    if (inProgress) setShowConfirm(true)
    else {
      if (isRemote) onRemoteHome()
      else {
        setGameMode(null)
        resetGame()
      }
    }
  }

  const handleNewRemoteGame = () => {
    isApplyingRemoteRef.current = true
    resetGame()
    setPhase('placing')
    isApplyingRemoteRef.current = false
    remoteClient?.sendReset()
  }

  return (
    <div
      className={[
        'flex flex-col items-center gap-4 py-4 min-h-dvh min-w-0',
        'bg-gradient-to-br from-rose-50 via-indigo-50 to-amber-50 dark:from-zinc-900 dark:via-zinc-700 dark:to-zinc-900',
        'transition-color',
        'box-border',
        'p-4 pb-12',
      ].join(' ')}
    >
      {!isRemote && (
        <TurnTimer timeLeft={timeLeft} timeLimit={turnTimeLimit} turn={turn} phase={phase} />
      )}
      {isRemote && (
        <div className="text-sm font-medium px-3 py-1.5 rounded-full bg-white/70 dark:bg-zinc-800/80 shadow-sm border border-zinc-200 dark:border-zinc-700">
          {phase !== 'finished' && (
            isLocalTurn ? (
              <span className="text-emerald-600 dark:text-emerald-400">● Your turn</span>
            ) : (
              <span className="text-zinc-500 dark:text-zinc-400">
                <span className="inline-block w-3 h-3 rounded-full border-2 border-zinc-300 dark:border-zinc-500 border-t-transparent animate-spin mr-1 align-middle" />
                Opponent's turn
              </span>
            )
          )}
          {phase === 'finished' && (
            <span className="text-zinc-500 dark:text-zinc-400">Game over</span>
          )}
        </div>
      )}
      <Navbar
        onUndo={isRemote ? undefined : undo}
        onRedo={isRemote ? undefined : redo}
        canUndo={!isRemote && canUndo}
        canRedo={!isRemote && canRedo}
        phase={phase}
        onHome={handleHome}
        dark={dark}
        setDark={setDark}
      />
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-800 dark:text-zinc-100 drop-shadow animate-fade-in flex items-center gap-2">
        {phase === 'finished' && result ? (
          result.tie ? (
            <>{t('game.tie', '🤜🤛 Draw!')}</>
          ) : result.winner ? (
            <>
              {t('game.winner', '🥇 Winner:')}
              <span
                className={
                  result.winner === 'R'
                    ? 'inline-block w-6 h-6 rounded-full bg-rose-500 dark:bg-rose-400 border-2 border-rose-300 dark:border-rose-500 shadow-sm mx-1 align-middle'
                    : 'inline-block w-6 h-6 rounded-full bg-indigo-500 dark:bg-indigo-400 border-2 border-indigo-300 dark:border-indigo-500 shadow-sm mx-1 align-middle'
                }
                aria-label={result.winner === 'R' ? t('game.red', 'Red') : t('game.blue', 'Blue')}
              />
              {isRemote && result.winner === localSide && ' (You!)'}
            </>
          ) : null
        ) : (
          <>
            Wall Go{' '}
            {isRemote ? '· ' + (localSide === 'R' ? '🔴 Red' : '🔵 Blue') + ' ' : '· '}
            {phase === 'placing'
              ? t('game.phase.placing', 'Placement Phase')
              : phase === 'playing'
                ? t('game.phase.playing', 'Action Phase')
                : t('game.phase.finished', 'Scoring Phase')}
          </>
        )}
      </h1>
      <div className="flex gap-4 animate-fade-in items-center">
        {(phase === 'placing'
          ? PLAYER_LIST.map((p) => [p, 0])
          : Object.entries(live.score ?? {})
        ).map(([p, s]) => (
          <span
            key={p}
            className="flex items-center gap-2 font-mono text-lg px-2 py-1 rounded bg-white/70 dark:bg-zinc-800/80 shadow-sm border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 transition-all duration-300"
          >
            <span
              className={
                p === 'R'
                  ? 'inline-block w-5 h-5 rounded-full bg-rose-500 dark:bg-rose-400 border-2 border-rose-300 dark:border-rose-500 shadow-sm mr-1'
                  : 'inline-block w-5 h-5 rounded-full bg-indigo-500 dark:bg-indigo-400 border-2 border-indigo-300 dark:border-indigo-500 shadow-sm mr-1'
              }
              aria-label={p === 'R' ? t('game.red', 'Red') : t('game.blue', 'Blue')}
            />
            {s}
          </span>
        ))}
        {phase === 'finished' && (
          <GameButton
            onClick={() => {
              if (isRemote) {
                handleNewRemoteGame()
              } else {
                setGameMode(null)
                resetGame()
                setPhase('selecting')
              }
            }}
            ariaLabel={t('game.again', 'Play Again')}
            variant="success"
          >
            {isRemote ? '🔄 New Game' : t('game.again', 'Play Again')}
          </GameButton>
        )}
      </div>
      <div className="board-container flex flex-col aspect-ratio-1 items-center w-[min(800px,100dvh-280px)] max-w-[calc(100dvw-32px)] transition-all">
        <Board
          board={board}
          phase={phase}
          turn={turn}
          selected={selected ?? null}
          legal={legal}
          placeStone={
            isLocalTurn
              ? isRemote
                ? (pos) => handleRemotePlace(pos)
                : (pos) => handlePlayerAction({ type: 'place', pos })
              : undefined
          }
          selectStone={
            isLocalTurn && phase === 'playing'
              ? isRemote
                ? (pos) => handleRemoteSelect(pos)
                : (pos) => selectStone(pos)
              : undefined
          }
          moveTo={
            isLocalTurn && phase === 'playing'
              ? isRemote
                ? (pos) => handleRemoteMove(pos)
                : (pos) => handlePlayerAction({ type: 'move', pos })
              : undefined
          }
          buildWall={
            isLocalTurn && phase === 'playing'
              ? isRemote
                ? (pos, dir) => handleRemoteWall(pos, dir)
                : (pos, dir) => handlePlayerAction({ type: 'wall', pos, dir })
              : undefined
          }
        />
      </div>
      <div className="w-full flex justify-center mt-3 animate-fade-in">
        <GameButton onClick={() => setShowRule(true)} text ariaLabel={t('menu.rule', 'Game Rules')}>
          {t('menu.rule', 'Game Rules')}
        </GameButton>
      </div>
      <ConfirmDialog
        open={showConfirm}
        title={t('menu.home', 'Home')}
        message={t(
          'menu.confirmHome',
          'The game is not finished. Are you sure you want to return to the home screen?\nYour current progress will be lost.',
        )}
        confirmText={t('common.confirm', 'Confirm')}
        cancelText={t('common.cancel', 'Cancel')}
        onConfirm={() => {
          setShowConfirm(false)
          if (isRemote) onRemoteHome()
          else {
            setGameMode(null)
            resetGame()
          }
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}
