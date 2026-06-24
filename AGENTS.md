# opencode-thinking-fix

Plugin + proxy + watchdog that fixes DeepSeek/Kimi/GLM/MiMo `reasoning_content` 400 errors in OpenCode CLI.

## Problem

Reasoning models (DeepSeek V4, Kimi, GLM, MiMo) in OpenCode produce HTTP 400 on multi-turn conversations because OpenCode does not preserve `reasoning_content` across turns. The API requires `reasoning_content` to be echoed back in every assistant message.

## Solution, Three Independent Layers

1. **Plugin** (`opencode-thinking-fix-universal.ts`): self-detection guard that injects `reasoning_content: ""` into assistant messages to prevent 400s. Works even if proxy is down.
2. **Proxy** (`proxy.js`): intercepts API traffic, caches real reasoning from SSE streams, injects it back on subsequent turns. One runtime dependency (`eventsource-parser`).
3. **Watchdog** (`watchdog.sh`): checks proxy health every 4 minutes, restarts if down.

## Architecture

- Port **3457**: model-based routing (15 model prefixes → upstream APIs)
- Port **3458**: fixed upstream to OpenCode Go (`https://opencode.ai/zen/go/v1`)

## File Layout

```
<project-root>/
├── plugins/opencode-thinking-fix-universal.ts   → copy to ~/.config/opencode/plugins/
├── proxy/proxy.js                               → run with node
├── watchdog/watchdog.sh                         → auto-recovery script
├── systemd/
│   ├── reasoning-cache.service                  → port 3457 systemd unit
│   ├── reasoning-cache-go.service               → port 3458 systemd unit
│   └── reasoning-proxy-watchdog.service         → watchdog systemd unit
└── tests/
    ├── test-plugin.js                           → 12 plugin tests
    └── test-proxy.js                            → 34 proxy tests
```

## Prerequisites

- Node.js (any recent version, proxy uses `eventsource-parser` as its only dep)
- OpenCode v1.17.0+ (for plugin `.ts` compilation support)
- For direct providers: valid API keys in environment (`DEEPSEEK_API_KEY`, etc.)
- For OpenCode Go: `OPENCODE_GO_API_KEY` or `~/.local/share/opencode/auth.json`
- systemd user services (optional, requires D-Bus user session)
- curl (for health check verification)

## Installation

### Step 1: Install the Plugin

```bash
mkdir -p ~/.config/opencode/plugins
cp plugins/opencode-thinking-fix-universal.ts ~/.config/opencode/plugins/
```

Plugin auto-loads from `~/.config/opencode/plugins/`. No `opencode.json` config needed. OpenCode compiles `.ts` at startup.

### Step 2: Install and Start the Proxy

```bash
mkdir -p ~/reasoning-cache-proxy
cp proxy/proxy.js ~/reasoning-cache-proxy/
cp tests/test-plugin.js ~/reasoning-cache-proxy/
cp tests/test-proxy.js ~/reasoning-cache-proxy/

# Start proxy for direct providers (port 3457)
node ~/reasoning-cache-proxy/proxy.js &

# OR via systemd:
cp systemd/reasoning-cache.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now reasoning-cache.service

# Start proxy for OpenCode Go (port 3458)
PORT=3458 UPSTREAM_URL=https://opencode.ai/zen/go/v1 node ~/reasoning-cache-proxy/proxy.js &

# OR via systemd:
cp systemd/reasoning-cache-go.service ~/.config/systemd/user/
systemctl --user enable --now reasoning-cache-go.service
```

### Step 3: Configure OpenCode

Edit `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "deepseek": {
      "baseURL": "http://127.0.0.1:3457/v1"
    },
    "opencode-go": {
      "baseURL": "http://127.0.0.1:3458/v1"
    }
  }
}
```

### Step 4: Install Watchdog (Optional)

```bash
cp watchdog/watchdog.sh ~/reasoning-cache-proxy/
chmod +x ~/reasoning-cache-proxy/watchdog.sh
cp systemd/reasoning-proxy-watchdog.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now reasoning-proxy-watchdog.service
```

### Step 5: Verify Installation

```bash
# Plugin: check opencode logs for "Plugin loaded"
# Proxy health:
curl http://127.0.0.1:3457/health  # → {"ok":true}
curl http://127.0.0.1:3458/health  # → {"ok":true}

# Run tests:
node ~/reasoning-cache-proxy/test-plugin.js  # 12/12 should pass
node ~/reasoning-cache-proxy/test-proxy.js   # 34/34 should pass
```

## How the Plugin Works

- Hook: `experimental.chat.messages.transform`
- **Input (`input`)**: always `{}` (empty, confirmed by GitHub #25494). DO NOT try to detect model via `input.model`.
- **Output (`output.messages`)**: array of messages for the current conversation.
- **Self-detection**: scans messages for ANY assistant message with `reasoning_content` OR `reasoning` field.
  - If found → reasoning model → patches ALL assistant messages to have BOTH fields.
  - If not found → non-reasoning model → passes through untouched (zero modification).
- **Important**: Plugin wraps messages in `{ info: Message }` or bare `Message`, handle both via `msg?.info ?? msg`.
- **Non-reasoning models** (Qwen/GPT/Claude) reject unknown fields with 400, never inject reasoning fields for them.
- **Fail-open**: if proxy is down, plugin injects `""` to prevent 400s.

## How the Proxy Works

- Intercepts `POST /v1/chat/completions` requests.
- Parses SSE response streams.
- Extracts `delta.reasoning_content` (native providers) AND `delta.reasoning` (OpenCode Go).
- Caches reasoning text keyed by `x-session-id` header + assistant index.
- On subsequent requests: reads cache, injects real text into both `reasoning_content` and `reasoning` fields.
- Falls back to empty string `""` if no cache exists.
- Non-streaming responses: piped directly without parsing.
- Health check: `GET /health` returns `{"ok":true,"uptime":N}`.

## Model Routing Table (Port 3457)

| Prefix | Upstream | Reasoning |
|---|---|---|
| `deepseek` | `https://api.deepseek.com` | Yes |
| `kimi`, `moonshot` | `https://api.moonshot.ai/v1` | Yes |
| `glm`, `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | Yes |
| `minimax`, `mimo` | `https://api.minimax.io/v1` | Yes |
| `gpt`, `o1` | `https://api.openai.com` | No |
| `claude`, `anthropic` | `https://api.anthropic.com` | No |
| `qwen` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | No |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | No |
| `llama` | `https://api.together.xyz` | No |
| `mistral` | `https://api.mistral.ai` | No |
| (unknown) | Falls back to DeepSeek | No |

## Critical Facts for AI Agents

1. Plugin's `messages.transform` hook receives `input: {}` always, never try to detect model via `input.model`.
2. Plugin wraps messages as `{ info: Message }` or bare `Message`, handle both via `msg?.info ?? msg`.
3. Non-reasoning models (Qwen/GPT/Claude) reject unknown fields with 400, never inject reasoning fields for them.
4. DeepSeek docs: "reasoning_content must be passed back to the API in all subsequent requests".
5. OpenCode Go uses `delta.reasoning` in SSE (not `reasoning_content`), proxy handles both.
6. Plugin is fail-open: if proxy is down, plugin injects `""` to prevent 400s.
7. Proxy uses `eventsource-parser` plus Node.js built-ins (`http`, `https`, `url`).

## Troubleshooting

- **Plugin not loading**: check `~/.config/opencode/plugins/` (plural with 's'), not `plugin/`. OpenCode reads from `plugins/` directory.
- **Broken plugin dependency**: check for `@opencode-ai/plugin` in `~/.config/opencode/node_modules/`, delete it if present (causes conflicts).
- **Proxy not starting**: check port conflicts with `lsof -i :3457` or `lsof -i :3458`.
- **Cache not working**: verify `x-session-id` header is being forwarded by OpenCode to the proxy.
- **Watchdog**: check logs with `journalctl --user -u reasoning-proxy-watchdog.service -f`.
- **Unit file not found**: run `systemctl --user daemon-reload` after copying `.service` files.
- **`systemctl --user` fails**: ensure D-Bus user session is running. On non-systemd distros, use direct `node` invocation instead.
- **Tests fail**: ensure proxy is running on the expected port before executing tests.
