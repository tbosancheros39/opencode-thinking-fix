#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OpenCode Reasoning Proxy Watchdog
# Checks both proxy instances every 4 minutes and restarts if down.
# ─────────────────────────────────────────────────────────────────────────────

PROXY_DIR="$HOME/reasoning-cache-proxy"
LOG_FILE="$PROXY_DIR/watchdog.log"
CHECK_INTERVAL=240  # 4 minutes in seconds

# Health-check endpoints
HEALTH_3457="http://127.0.0.1:3457/health"
HEALTH_3458="http://127.0.0.1:3458/health"

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg" | tee -a "$LOG_FILE"
}

check_and_start() {
    local port="$1"
    local health_url="$2"
    local env_extra="$3"
    local pid

    # Check if the port responds with HTTP 200
    if curl -sf "$health_url" > /dev/null 2>&1; then
        return 0
    fi

    log "Proxy on port $port is DOWN — restarting..."

    # Kill any stale proxy process on this port
    pid=$(lsof -ti :"$port" 2>/dev/null)
    if [ -n "$pid" ]; then
        kill "$pid" 2>/dev/null
        sleep 1
    fi

    # Start proxy
    if [ -n "$env_extra" ]; then
        eval "nohup env $env_extra node $PROXY_DIR/proxy.js > /tmp/proxy-${port}.log 2>&1 </dev/null &"
    else
        nohup node "$PROXY_DIR/proxy.js" > "/tmp/proxy-${port}.log" 2>&1 </dev/null &
    fi

    sleep 2

    # Verify it came up
    if curl -sf "$health_url" > /dev/null 2>&1; then
        log "Proxy on port $port restarted successfully"
    else
        log "ERROR: Proxy on port $port FAILED to restart"
    fi
}

# ── Main loop ────────────────────────────────────────────────────────────────
log "Watchdog started — checking every ${CHECK_INTERVAL}s"

while true; do
    check_and_start 3457 "$HEALTH_3457" ""
    check_and_start 3458 "$HEALTH_3458" "UPSTREAM_URL=https://opencode.ai/zen/go/v1 PORT=3458"
    sleep "$CHECK_INTERVAL"
done
