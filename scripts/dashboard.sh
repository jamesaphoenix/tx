#!/bin/bash
# dashboard.sh — Start the tx dashboard (API server + Vite dev server) and open in browser
#
# Usage:
#   ./scripts/dashboard.sh          # Start and open in Brave/Chrome
#   ./scripts/dashboard.sh --no-open  # Start without opening browser

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

NO_OPEN=false
for arg in "$@"; do
  case $arg in
    --no-open) NO_OPEN=true ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

API_PORT=3001
VITE_PORT=5173
API_PID=""
VITE_PID=""

cleanup() {
  echo "Shutting down dashboard..."
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null || true
  wait 2>/dev/null
  echo "Dashboard stopped."
}

trap cleanup EXIT INT TERM

# Kill any existing processes on our ports
for port in $API_PORT $VITE_PORT; do
  pid=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "Killing existing process on port $port (PID $pid)"
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
done

# Start API server
echo "Starting API server on port $API_PORT..."
bun "$PROJECT_DIR/apps/dashboard/server/index.ts" &
API_PID=$!

# Start Vite dev server
echo "Starting Vite dev server on port $VITE_PORT..."
cd "$PROJECT_DIR/apps/dashboard" && bun run dev &
VITE_PID=$!
cd "$PROJECT_DIR"

# Wait for servers to be ready
echo "Waiting for servers..."
for i in $(seq 1 30); do
  api_ok=false
  vite_ok=false
  curl -s "http://localhost:$API_PORT/api/stats" >/dev/null 2>&1 && api_ok=true
  curl -s "http://localhost:$VITE_PORT" >/dev/null 2>&1 && vite_ok=true

  if $api_ok && $vite_ok; then
    echo "API server ready on http://localhost:$API_PORT"
    echo "Dashboard ready on http://localhost:$VITE_PORT"
    break
  fi
  sleep 1
done

# Open in browser (Brave first, then Chrome fallback)
if [ "$NO_OPEN" = false ]; then
  if open -a "Brave Browser" "http://localhost:$VITE_PORT" 2>/dev/null; then
    echo "Opened in Brave Browser"
  elif open -a "Google Chrome" "http://localhost:$VITE_PORT" 2>/dev/null; then
    echo "Opened in Google Chrome"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:$VITE_PORT"
    echo "Opened in default browser"
  else
    echo "Open http://localhost:$VITE_PORT in your browser"
  fi
fi

echo ""
echo "Dashboard running. Press Ctrl+C to stop."
wait
