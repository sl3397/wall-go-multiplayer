#!/bin/bash
# Start both the WebSocket server and the frontend for local development
# Usage: ./start-dev.sh

echo "Starting Wall Go Multiplayer (dev mode)..."
echo ""

# Start WebSocket server in background
echo "Starting WebSocket server on :8080..."
cd "$(dirname "$0")/server" && npm install --silent 2>/dev/null && node server.js &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Start frontend
echo "Starting frontend..."
cd "$(dirname "$0")" && npm run dev &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

echo ""
echo "Open http://localhost:5173 in two browser tabs to test remote play."
echo "Press Ctrl+C to stop both."

# Wait for either to exit
wait $SERVER_PID $FRONTEND_PID
