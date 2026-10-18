#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OpenCode Reasoning Proxy Watchdog
# Checks all 4 proxy instances every 4 minutes and restarts if down.
# ─────────────────────────────────────────────────────────────────────────────

PROXY_DIR="/home/anini39/opencode-thinking-fix/proxy"
LOG_FILE="/home/anini39/opencode-thinking-fix/watchdog.log"
CHECK_INTERVAL=240  # 4 minutes in seconds

log() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg" | tee -a "$LOG_FILE"
}

check_and_restart() {
    local port="$1"
    local health_url="http://127.0.0.1:${port}/health"
    local unit="$2"

    # Check if the port responds
    if curl -sf "$health_url" > /dev/null 2>&1; then
        return 0
    fi

    log "Proxy on port $port is DOWN, restarting systemd unit $unit..."
    systemctl restart "$unit"
    sleep 2

    if curl -sf "$health_url" > /dev/null 2>&1; then
        log "Proxy on port $port restarted successfully via $unit"
    else
        log "ERROR: Proxy on port $port FAILED to restart via $unit"
    fi
}

# ── Main loop ────────────────────────────────────────────────────────────────
log "Watchdog started, checking ports 3457/3458/3459/3462 every ${CHECK_INTERVAL}s"

while true; do
    check_and_restart 3457 "reasoning-cache.service"
    check_and_restart 3458 "reasoning-cache-go.service"
    check_and_restart 3459 "reasoning-cache-zen.service"
    check_and_restart 3462 "reasoning-cache-openrouter.service"
    sleep "$CHECK_INTERVAL"
done
