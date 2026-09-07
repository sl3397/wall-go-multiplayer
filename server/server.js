import { WebSocketServer } from 'ws'
import { createServer } from 'http'
import { readFile, stat } from 'fs/promises'
import { join, extname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const PORT = process.env.PORT || 8080

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

wss.on('connection', (ws) => {
  let currentRoom = null
  let playerSide = null
  let isAlive = true

  ws.on('pong', () => {
    isAlive = true
  })

  ws.on('message', (data) => {
    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
      return
    }

    switch (msg.type) {
      case 'create': {
        if (currentRoom) {
          ws.send(JSON.stringify({ type: 'error', message: 'Already in a room' }))
          return
        }
        const code = generateRoomCode()
        currentRoom = code
        playerSide = 'R'
        rooms.set(code, { host: ws, guest: null })
        ws.send(JSON.stringify({ type: 'created', roomCode: code, side: 'R' }))
        break
      }

      case 'join': {
        if (currentRoom) {
          ws.send(JSON.stringify({ type: 'error', message: 'Already in a room' }))
          return
        }
        const room = rooms.get(msg.roomCode)
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }))
          return
        }
        if (room.guest) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }))
          return
        }
        currentRoom = msg.roomCode
        playerSide = 'B'
        room.guest = ws
        ws.send(JSON.stringify({ type: 'joined', roomCode: msg.roomCode, side: 'B' }))
        if (room.host && room.host.readyState === 1) {
          room.host.send(JSON.stringify({ type: 'opponent_joined' }))
        }
        break
      }

      case 'state': {
        const room = rooms.get(currentRoom)
        if (!room) return
        const target = playerSide === 'R' ? room.guest : room.host
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({ type: 'state', snapshot: msg.snapshot }))
        }
        break
      }

      case 'reset': {
        const room = rooms.get(currentRoom)
        if (!room) return
        const target = playerSide === 'R' ? room.guest : room.host
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({ type: 'reset' }))
        }
        break
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' }))
        break
      }

      case 'leave': {
        leaveRoom(ws, currentRoom)
        currentRoom = null
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
    if (room.guest && room.guest.readyState === 1) {
      room.guest.send(JSON.stringify({ type: 'opponent_left' }))
    }
    rooms.delete(roomCode)
  } else if (room.guest === ws) {
    if (room.host && room.host.readyState === 1) {
      room.host.send(JSON.stringify({ type: 'opponent_left' }))
    }
    room.guest = null
  }
}

// Heartbeat: check for dead connections every 30 seconds
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState !== 1) return
    ws.ping()
  })
}, 30000)

wss.on('close', () => {
  clearInterval(heartbeatInterval)
})

server.listen(PORT, () => {
  console.log(`Wall Go server running on http://localhost:${PORT}`)
  console.log(`Open the URL above in your browser to play!`)
})
