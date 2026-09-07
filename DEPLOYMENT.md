# Wall Go Multiplayer - Deployment Guide

This guide explains how to deploy the Wall Go multiplayer game so you and your friend can play remotely (e.g., one in China, one in the US).

## Architecture

- **Frontend**: React + Vite app (the game UI)

- **Backend**: Simple WebSocket relay server (relays moves between two players)

## Quick Start (Local Testing)

### 1. Start the WebSocket server

```bash
cd server
npm install
npm start
```

Server runs on `ws://localhost:8080`

### 2. Start the frontend

In a separate terminal:

```bash
npm install --legacy-peer-deps
npm run dev
```

Open the URL shown in terminal (usually `http://localhost:5173`)

### 3. Test with two browser tabs

1. Open the app in two browser tabs
2. In tab 1: Click "Remote Play" → "Create Room" → note the 4-letter code
3. In tab 2: Click "Remote Play" → enter the code → "Join Room"
4. Both tabs transition to the game. Red player (creator) goes first.

## Production Deployment

### Option A: Render.com (Recommended, free tier)

#### Deploy the WebSocket Server

1. Go to <https://render.com> and create an account
2. Click "New +" → "Web Service"
3. Connect your GitHub repo (or use the `server/` directory)
4. Settings:

   - **Name**: `wall-go-server`

   - **Region**: Singapore (best for China-US connectivity)

   - **Runtime**: Node

   - **Build Command**: `cd server && npm install`

   - **Start Command**: `node server/server.js`

   - **Plan**: Free
5. Click "Create Web Service"
6. Note the URL: `wss://wall-go-server.onrender.com`

#### Deploy the Frontend

1. Go to <https://vercel.com> or <https://netlify.com>
2. Import your GitHub repo
3. Settings:

   - **Build Command**: `npm run build`

   - **Output Directory**: `dist`

   - **Environment Variables**:

     - `VITE_WS_SERVER_URL` = `wss://wall-go-server.onrender.com`
4. Deploy

### Option B: Railway.app

1. Go to <https://railway.app>
2. Deploy from GitHub repo
3. Set up two services:

   - **Server**: Start command `node server/server.js`, port `8080`

   - **Frontend**: Build command `npm run build`, output `dist/`
4. Set environment variable `VITE_WS_SERVER_URL` on the frontend service

### Option C: Self-hosted VPS (DigitalOcean/Vultr/LightSail)

1. Rent a VPS in Singapore or Japan region (\~$5/month)
2. Install Node.js 20+
3. Clone the repo
4. Start the server:

   ```bash
   cd server && npm install && PORT=8080 node server.js
   ```
5. Serve the frontend build with nginx or `vite preview`
6. Use a reverse proxy (nginx) to handle WebSocket upgrade

## Environment Configuration

Create a `.env` file in the project root:

```
VITE_WS_SERVER_URL=wss://your-server-url.com
```

For local development, use `ws://localhost:8080`.

## How Remote Play Works

1. **Player 1** clicks "Remote Play" → "Create Room" → gets a 4-letter code
2. **Player 2** clicks "Remote Play" → enters the code → "Join Room"
3. Both players enter the game. Player 1 is Red, Player 2 is Blue.
4. Red goes first. Each move is synced in real-time via WebSocket.
5. You can only interact when it's your turn. The opponent's moves appear automatically.
6. When the game ends, click "New Game" to start a fresh round.

## Notes for China-US Connectivity

- The WebSocket server should be in **Singapore or Japan** for best latency to both sides

- **Avoid Firebase/Google services** (may be blocked in China)

- Vercel and Netlify CDN work in China for serving the frontend

- For the WebSocket server, Render.com's Singapore region or a Chinese cloud (Alibaba/Tencent) with overseas nodes works best

- Turn-based games like Wall Go tolerate latency well (even 200-300ms is fine)

