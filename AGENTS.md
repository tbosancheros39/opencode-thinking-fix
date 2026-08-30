# opencode-thinking-fix

Plugin + proxy + watchdog that preserve reasoning content across multi-turn OpenCode conversations with DeepSeek, Kimi, GLM, MiMo, MiniMax, and OpenCode Go.

## Problem

Reasoning models emit chain-of-thought in provider-specific fields (`reasoning_content`, `reasoning`, or `thinking` blocks). OpenCode and other coding clients drop those fields when serializing subsequent turns. Providers require the reasoning to be passed back — some reject requests without it, others silently lose prior context. Either outcome degrades multi-turn coherence and tool-call accuracy. This repository preserves the fields and replays the actual reasoning text.

## Solution, Three Independent Layers

1. **Plugin** (`opencode-thinking-fix-universal.ts`): self-detection guard that injects `reasoning_content: ""` into assistant messages to prevent 400s. Works even if proxy is down.
2. **Proxy** (`proxy.js`): intercepts API traffic, caches real reasoning from SSE streams, injects it back on subsequent turns. One runtime dependency (`eventsource-parser`).
3. **Watchdog** (`watchdog.sh`): checks proxy health every 4 minutes, restarts if down.

## Architecture

- Port **3457**: model-based routing (model prefixes → upstream APIs)
- Port **3458**: fixed upstream to OpenCode Go (`https://opencode.ai/zen/go/v1`)
- Port **3459**: fixed upstream to OpenCode Zen (`https://opencode.ai/zen/v1`); set `REASONING_KEY=reasoning_content`
- Port **3462**: fixed upstream to OpenRouter (`https://openrouter.ai/api/v1`); set `REASONING_KEY=reasoning_content`

## File Layout

```
<project-root>/
├── plugins/opencode-thinking-fix-universal.ts   → copy to ~/.config/opencode/plugins/
├── proxy/core.js                                → pure proxy logic (required)
├── proxy/proxy.js                               → run with node
├── watchdog/watchdog.sh                         → auto-recovery script
├── systemd/
│   ├── reasoning-cache.service                  → port 3457 systemd unit
│   ├── reasoning-cache-go.service               → port 3458 systemd unit
│   └── reasoning-proxy-watchdog.service         → watchdog systemd unit
└── tests/
    ├── test-plugin.js                           → 12 plugin tests
    └── test-proxy.js                            → 127 proxy tests
```

## Prerequisites

- Node.js (any recent version, proxy uses `eventsource-parser` as its only dep)
- OpenCode v1.17.9+ (for plugin `.ts` compilation support)
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
cp proxy/core.js ~/reasoning-cache-proxy/
cp proxy/proxy.js ~/reasoning-cache-proxy/

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

### Windows installation

The plugin and proxy run natively on Windows. The Bash watchdog and systemd
units do not; use Task Scheduler or NSSM for automatic proxy restarts.

Open PowerShell and install Node.js LTS if it is not already installed:

```powershell
winget install OpenJS.NodeJS.LTS
node --version   # Node 18 or newer
npm --version
```

From the cloned project directory, install dependencies and copy the plugin:

```powershell
npm ci
$pluginDir = Join-Path $env:APPDATA 'OpenCode\plugins'
New-Item -ItemType Directory -Force $pluginDir | Out-Null
Copy-Item .\plugins\opencode-thinking-fix-universal.ts $pluginDir -Force
```

Create a private runtime directory and copy **both** proxy files. `core.js`
is required by `proxy.js`:

```powershell
$proxyDir = Join-Path $env:LOCALAPPDATA 'OpenCode\reasoning-cache-proxy'
New-Item -ItemType Directory -Force $proxyDir | Out-Null
Copy-Item .\proxy\core.js, .\proxy\proxy.js $proxyDir -Force
```

Start the proxy in the current PowerShell window:

```powershell
$env:PORT = '3457'
node (Join-Path $proxyDir 'proxy.js')
```

For OpenCode Go, use a second PowerShell window:

```powershell
$env:PORT = '3458'
$env:UPSTREAM_URL = 'https://opencode.ai/zen/go/v1'
node (Join-Path $proxyDir 'proxy.js')
```

The global OpenCode configuration is `%APPDATA%\OpenCode\opencode.json`; a
project configuration is `.opencode\opencode.json`. Set the provider base URL
to `http://127.0.0.1:3457/v1` (or port `3458` for OpenCode Go), then restart
OpenCode. Verify from PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:3457/health
Invoke-RestMethod http://127.0.0.1:3458/health
```

To run the local regression tests on Windows (development-only):

```powershell
node .\tests\test-plugin.js
node .\tests\test-proxy.js
```

For a background service, install NSSM with `winget install NSSM.NSSM`, then
run (adjust the path if Node is installed elsewhere):

```powershell
nssm install ReasoningCacheProxy 'C:\Program Files\nodejs\node.exe' "$proxyDir\proxy.js"
nssm set ReasoningCacheProxy AppDirectory $proxyDir
nssm set ReasoningCacheProxy AppEnvironmentExtra PORT=3457
nssm start ReasoningCacheProxy
```

Repeat with a second service and `PORT=3458` plus
`UPSTREAM_URL=https://opencode.ai/zen/go/v1` if the OpenCode Go route is needed.

### Step 3: Configure OpenCode

Authenticate OpenCode Go through its `/connect` command, then edit
`~/.config/opencode/opencode.json` (Windows: `%APPDATA%\OpenCode\opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "deepseek": {
      "options": {
        "baseURL": "http://127.0.0.1:3457/v1"
      }
    },
    "opencode-go": {
      "options": {
        "baseURL": "http://127.0.0.1:3458/v1"
      }
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
node ~/reasoning-cache-proxy/test-proxy.js   # 95/95 should pass
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
- Go Anthropic wire: MiniMax/Qwen on `/v1/messages` resolve to `reasoningKey: 'anthropic'`; cached thinking is replayed by unshifting a `{ type: 'thinking', thinking }` block into the assistant turn's `content[]`.
- On subsequent requests: reads cache, injects real text into both `reasoning_content` and `reasoning` fields.
- Falls back to empty string `""` if no cache exists.
- Non-streaming responses: piped directly without parsing.
- Health check: `GET /health` returns `{"ok":true,"uptime":N}`.

## Model Routing Table (Port 3457)

| Prefix | Upstream | Reasoning |
|---|---|---|
| Zen free-tier bare ids (`x-preview-f-free`, `hy3-free`, `mimo-v2.5-free`, `muse-spark-1.2-contributor-free`, `deepseek-v4-flash-free`, `ling-3.0-flash-fin-free`, `laguna-s-2.1-free`, `big-pickle`, `ox-alpha-free`, `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`) | `https://opencode.ai/zen/v1` | Yes (`reasoning_content`) |
| `opencode/` + free ids (same set with prefix) | `https://opencode.ai/zen/v1` | Yes (`reasoning_content`) |
| `deepseek` | `https://api.deepseek.com` | Yes |
| `deepseek-chat` | `https://api.deepseek.com` | Yes — non-thinking alias, passback is a no-op |
| `deepseek-r1`, `deepseek-reasoner` | `https://api.deepseek.com` | Legacy — retired by DeepSeek 2026-07-24; kept as compat guard (`'strip'` sentinel) |
| `kimi`, `moonshot` | `https://api.moonshot.ai/v1` | Yes |
| `glm`, `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | Yes |
| `minimax` | `https://api.minimax.io/v1` | Yes (`reasoning_details`) |
| `mimo` | `https://api.xiaomimimo.com/v1` | Yes (`reasoning_content`) |
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

## v3.2 Invariants (do not break)

1. `patchRequestBody` returns `{ body, assistantCount, modified, report }`; `report.turns[].fields` is ALWAYS an array. `proxy.js` consumes the report (`assistantTurns`/`missingText`/`missingReasoning`/`turns.reduce`). Never drop or reshape it.
2. `reasoningKey` semantics: `'strip'` = R1 only (delete reasoning fields, never cache); `null` = true passthrough (Qwen/GPT/Claude/unknown — never strip, never fabricate); other strings = cache + inject that field only.
3. Raw-byte SSE forwarding; the parser is a side channel, never re-serialize. Lazy patching: untouched body when reasoning already present.
4. Go mode never consults `ROUTES`: `/messages` + (minimax|qwen) → `'anthropic'`; glm-5.2 on `/chat/completions` → `'reasoning_content'`; `REASONING_KEY` env (when set) overrides to that key; else `'reasoning'`. Kimi strip / `reasoning_split` are 3457-only (`!UPSTREAM_URL`).
5. Logging: proxy = console→journal (DEBUG-gated) + `writeLog` JSONL (ungated); plugin keeps its own `writeLog`. No winston/pino. systemd units stay `Type=simple`/journal/`%h`.
6. Git: agents never run git commit/push/add/checkout. Working tree only; human publishes via branch + squash merge.
7. Upstream path handling (`upstreamPathFor` in core.js): if the client URL already starts with the upstream's official base path (e.g. OpenRouter `/api/v1`), forward as-is; never double the prefix.

## Troubleshooting

- **Plugin not loading**: check `~/.config/opencode/plugins/` (plural with 's'), not `plugin/`. OpenCode reads from `plugins/` directory.
- **Broken plugin dependency**: check for `@opencode-ai/plugin` in `~/.config/opencode/node_modules/`, delete it if present (causes conflicts).
- **Proxy not starting**: check port conflicts with `lsof -i :3457` or `lsof -i :3458`.
- **Cache not working**: verify `x-session-id` header is being forwarded by OpenCode to the proxy.
- **Watchdog**: check logs with `journalctl --user -u reasoning-proxy-watchdog.service -f`.
- **Unit file not found**: run `systemctl --user daemon-reload` after copying `.service` files.
- **`systemctl --user` fails**: ensure D-Bus user session is running. On non-systemd distros, use direct `node` invocation instead.
- **Tests fail**: ensure proxy is running on the expected port before executing tests.
