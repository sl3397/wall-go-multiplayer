import type { GameSnapshot } from '@/lib/types'

export function serializeSnapshot(snapshot: GameSnapshot): string {
  return JSON.stringify({
    board: snapshot.board,
    turn: snapshot.turn,
    selected: snapshot.selected ?? null,
    legal: Array.from(snapshot.legal),
    stepsTaken: snapshot.stepsTaken,
    phase: snapshot.phase,
    players: snapshot.players,
    stonesLimit: snapshot.stonesLimit,
    stonesPlaced: snapshot.stonesPlaced,
    result: snapshot.result ?? null,
    skipReason: snapshot.skipReason ?? null,
  })
}

export function deserializeSnapshot(data: string): GameSnapshot {
  const obj = JSON.parse(data)
  return {
    board: obj.board,
    turn: obj.turn,
    selected: obj.selected ?? undefined,
    legal: new Set(obj.legal),
    stepsTaken: obj.stepsTaken,
    phase: obj.phase,
    players: obj.players,
    stonesLimit: obj.stonesLimit,
    stonesPlaced: obj.stonesPlaced,
    result: obj.result ?? undefined,
    skipReason: obj.skipReason ?? undefined,
  }
}
