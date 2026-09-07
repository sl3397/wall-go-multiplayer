import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { readFile, stat } from 'fs/promises'
import { join, extname, resolve } from 'path'
import { fileURLToPath } from 'url'
import Redis from 'ioredis'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PORT = process.env.PORT || 8080
const ROOM_TTL = 1800 // 30 minutes in seconds

const DIST_DIR = resolve(__dirname, '..', 'dist')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { tls: { rejectUnauthorized: false } })
  : null

if (redis) {
  redis.on('error', (err) => console.error('[Redis] Error:', err))
  redis.on('connect', () => console.log('[Redis] Connected'))
} else {
  console.warn('[Redis] No REDIS_URL set, running without persistence')
}

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0])
    if (urlPath === '/') urlPath = '/index.html'

    const filePath = join(DIST_DIR, urlPath)

    if (!filePath.startsWith(DIST_DIR)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    try {
      const stats = await stat(filePath)
      if (stats.isFile()) {
        const data = await readFile(filePath)
        const ext = extname(filePath).toLowerCase()
        const contentType = MIME_TYPES[ext] || 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': contentType })
        res.end(data)
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    } catch {
      const indexPath = join(DIST_DIR, 'index.html')
      try {
        const data = await readFile(indexPath)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(data)
      } catch {
        res.writeHead(404)
        res.end('Frontend not built yet. Run: npm run build')
      }
    }
  } catch (err) {
    res.writeHead(500)
    res.end('Server error')
  }
})

const wss = new WebSocketServer({ noServer: true })

server.on('error', (err) => console.error('[Server] HTTP server error:', err))
wss.on('error', (err) => console.error('[Server] WebSocketServer error:', err))

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request)
  })
})

const rooms = new Map()

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = ''
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)]
    }
  } while (rooms.has(code))
  return code
}

function safeSend(ws, data) {
  if (!ws || ws.readyState !== 1) return
  try {
    ws.send(data)
  } catch (err) {
    console.error('[Server] Failed to send:', err)
  }
}

async function saveRoomState(code, snapshot) {
  if (!redis) return
  try {
    await redis.set(`room:${code}:state`, JSON.stringify(snapshot), 'EX', ROOM_TTL)
  } catch (err) {
    console.error('[Redis] Failed to save state:', err)
  }
}

async function getRoomState(code) {
  if (!redis) return null
  try {
    const data = await redis.get(`room:${code}:state`)
    return data ? JSON.parse(data) : null
  } catch (err) {
    console.error('[Redis] Failed to get state:', err)
    return null
  }
}

async function touchRoomTTL(code) {
  if (!redis) return
  try {
    await redis.expire(`room:${code}:state`, ROOM_TTL)
  } catch (err) {
    // non-critical
  }
}

wss.on('connection', (ws) => {
  let currentRoom = null
  let playerSide = null

  ws.on('error', (err) => {
    console.error('[Server] WebSocket error:', err)
  })

  ws.on('message', async (data) => {
    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      safeSend(ws, JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
      return
    }

    switch (msg.type) {
      case 'create': {
        if (currentRoom) {
          safeSend(ws, JSON.stringify({ type: 'error', message: 'Already in a room' }))
          return
        }
        const code = generateRoomCode()
        currentRoom = code
        playerSide = 'R'
        rooms.set(code, { host: ws, guest: null })
        safeSend(ws, JSON.stringify({ type: 'created', roomCode: code, side: 'R' }))
        break
      }

      case 'join': {
        if (currentRoom) {
          safeSend(ws, JSON.stringify({ type: 'error', message: 'Already in a room' }))
          return
        }
        const room = rooms.get(msg.roomCode)
        if (!room) {
          safeSend(ws, JSON.stringify({ type: 'error', message: 'Room not found' }))
          return
        }
        if (room.guest) {
          safeSend(ws, JSON.stringify({ type: 'error', message: 'Room is full' }))
          return
        }
        currentRoom = msg.roomCode
        playerSide = 'B'
        room.guest = ws
        safeSend(ws, JSON.stringify({ type: 'joined', roomCode: msg.roomCode, side: 'B' }))
        if (room.host && room.host.readyState === 1) {
          safeSend(room.host, JSON.stringify({ type: 'opponent_joined' }))
        }
        break
      }

      case 'rejoin': {
        // A player reconnecting to an existing room
        const room = rooms.get(msg.roomCode)
        if (!room) {
          // Room might still exist in Redis but not in memory (server restarted)
          // Recreate room in memory - the player who rejoins first becomes host temporarily
          // The other player will also rejoin and take the guest slot
          // We need to figure out which side this player was
          const savedState = await getRoomState(msg.roomCode)
          if (savedState) {
            // Room exists in Redis, recreate in memory
            rooms.set(msg.roomCode, { host: ws, guest: null })
            currentRoom = msg.roomCode
            playerSide = msg.side || 'R'
            if (msg.side === 'B') {
              // This player was guest, but we need a host...
              // Just set them as guest in a new room object
              rooms.set(msg.roomCode, { host: null, guest: ws })
            }
            safeSend(ws, JSON.stringify({ type: 'rejoined', roomCode: msg.roomCode, side: playerSide, snapshot: savedState }))
            await touchRoomTTL(msg.roomCode)
          } else {
            safeSend(ws, JSON.stringify({ type: 'error', message: 'Room not found or expired' }))
          }
          return
        }

        // Room exists in memory - rejoin with the correct side
        currentRoom = msg.roomCode
        playerSide = msg.side

        if (msg.side === 'R' && !room.host) {
          room.host = ws
        } else if (msg.side === 'B' && !room.guest) {
          room.guest = ws
        }

        // Send current state from Redis
        const savedState = await getRoomState(msg.roomCode)
        safeSend(ws, JSON.stringify({ type: 'rejoined', roomCode: msg.roomCode, side: playerSide, snapshot: savedState }))

        // Notify opponent if they're connected
        const opponent = msg.side === 'R' ? room.guest : room.host
        if (opponent && opponent.readyState === 1) {
          safeSend(opponent, JSON.stringify({ type: 'opponent_rejoined' }))
        }
        await touchRoomTTL(msg.roomCode)
        break
      }

      case 'state': {
        const room = rooms.get(currentRoom)
        if (!room) return
        const target = playerSide === 'R' ? room.guest : room.host
        if (target && target.readyState === 1) {
          safeSend(target, JSON.stringify({ type: 'state', snapshot: msg.snapshot }))
        }
        // Save to Redis for persistence
        await saveRoomState(currentRoom, msg.snapshot)
        break
      }

      case 'reset': {
        const room = rooms.get(currentRoom)
        if (!room) return
        const target = playerSide === 'R' ? room.guest : room.host
        if (target && target.readyState === 1) {
          safeSend(target, JSON.stringify({ type: 'reset' }))
        }
        // Clear Redis state for new game
        if (redis) {
          try {
            await redis.del(`room:${currentRoom}:state`)
          } catch (e) {
            // non-critical
          }
        }
        break
      }

      case 'leave': {
        leaveRoom(ws, currentRoom)
        currentRoom = null
        break
      }

      case 'ping': {
        safeSend(ws, JSON.stringify({ type: 'pong' }))
        break
      }
    }
  })

  ws.on('close', () => {
    leaveRoom(ws, currentRoom)
  })
})

function leaveRoom(ws, roomCode) {
  if (!roomCode) return
  const room = rooms.get(roomCode)
  if (!room) return
  if (room.host === ws) {
    // Don't delete room immediately - allow reconnection
    // Just mark host as disconnected
    room.host = null
    if (room.guest && room.guest.readyState === 1) {
      safeSend(room.guest, JSON.stringify({ type: 'opponent_left' }))
    }
    // If both slots empty, clean up
    if (!room.guest) {
      rooms.delete(roomCode)
    }
  } else if (room.guest === ws) {
    room.guest = null
    if (room.host && room.host.readyState === 1) {
      safeSend(room.host, JSON.stringify({ type: 'opponent_left' }))
    }
    if (!room.host) {
      rooms.delete(roomCode)
    }
  }
}

// Heartbeat: check for dead connections every 30 seconds
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return
    try {
      ws.ping()
    } catch (err) {
      console.error('[Server] Ping failed:', err)
    }
  })
}, 30000)

wss.on('close', () => {
  clearInterval(heartbeatInterval)
})

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err)
})

process.on('unhandledRejection', (err) => {
  console.error('[Server] Unhandled rejection:', err)
})

server.listen(PORT, () => {
  console.log(`Wall Go server running on http://localhost:${PORT}`)
})
