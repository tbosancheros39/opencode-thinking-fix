# opencode-thinking-fix

Plugin + proxy + watchdog that preserve reasoning content across multi-turn OpenCode conversations with DeepSeek, Kimi, GLM, MiMo, MiniMax, and OpenCode Go.

## Problem

Reasoning models emit chain-of-thought in provider-specific fields (`reasoning_content`, `reasoning`, or `thinking` blocks). OpenCode and other coding clients drop those fields when serializing subsequent turns. Providers require the reasoning to be passed back — some reject requests without it, others silently lose prior context. Either outcome degrades multi-turn coherence and tool-call accuracy. This repository preserves the fields and replays the actual reasoning text.

## Solution, Three Independent Layers

1. **Plugin** (`opencode-thinking-fix-universal.ts`): dual V1/V2 entrypoint. V1 injects `reasoning_content: ""` / `reasoning: ""` into assistant messages; V2 injects `native.openaiCompatible.reasoning_content` on the `context` hook. Works even if the proxy is down.
2. **Proxy** (`proxy.js`): intercepts API traffic, caches real reasoning from SSE streams, injects it back on subsequent turns. One runtime dependency (`eventsource-parser`).
3. **Watchdog** (`watchdog.sh`): checks proxy health every 4 minutes, restarts if down.

## Architecture

- Port **3457**: model-based routing (model prefixes → upstream APIs)
- Port **3458**: fixed upstream to OpenCode Go chat + Responses (`https://opencode.ai/inference/go/openai/v1`)
- Port **3463**: fixed upstream to OpenCode Go Anthropic messages (`https://opencode.ai/inference/go/anthropic/v1`)
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
│   ├── reasoning-cache-go.service               → port 3458 systemd unit (chat + Responses)
│   ├── reasoning-cache-go-anthropic.service     → port 3463 systemd unit (Anthropic wire)
│   ├── reasoning-cache-zen.service              → port 3459 systemd unit
│   ├── reasoning-cache-openrouter.service       → port 3462 systemd unit
│   └── reasoning-proxy-watchdog.service         → watchdog systemd unit
└── tests/
    ├── test-plugin.js                           → 12 plugin tests
    └── test-proxy.js                            → 214 proxy tests
```

## Prerequisites

- Node.js (any recent version, proxy uses `eventsource-parser` as its only dep)
- OpenCode v1.17.9+ (V1 plugin) or v2.0+ (V2 plugin, `@opencode/plugin`)
- For direct providers: valid API keys in environment (`DEEPSEEK_API_KEY`, etc.)
- For OpenCode Go: `OPENCODE_GO_API_KEY` or `~/.local/share/opencode/auth.json`
- systemd user services (optional, requires D-Bus user session)
- curl (for health check verification)

## Installation

### Step 1: Install the Plugin

```bash
mkdir -p ~/.config/opencode/plugins
cp plugins/opencode-thinking-fix-universal.ts ~/.config/opencode/plugins/
# Manual V1 copies need the shared plugin package; npm installs and V2 hosts provide it.
cd ~/.config/opencode && npm i @opencode/plugin
```

Plugin auto-loads from `~/.config/opencode/plugins/`. No `opencode.json` config needed. OpenCode compiles `.ts` at startup.

V2: add the npm package to `plugins` in `opencode.json(c)` (`{"plugins": ["opencode-thinking-fix"]}`); the default export provides `setup()`.

### Step 2: Install and Start the Proxy

```bash
# the units run the script from a checkout at ~/opencode-thinking-fix
git clone https://github.com/tbosancheros39/opencode-thinking-fix ~/opencode-thinking-fix
cd ~/opencode-thinking-fix
npm install --omit=dev
```

A fresh checkout needs `npm install --omit=dev` before any start or systemd enable. It pulls `eventsource-parser`, the one runtime dep. Without it the proxy dies at boot with `ERR_MODULE_NOT_FOUND: Cannot find package 'eventsource-parser'`. Fix: `cd ~/opencode-thinking-fix && npm install --omit=dev`.

```bash
# Start proxy for direct providers (port 3457)
node proxy/proxy.js &

# OR via systemd:
cp systemd/reasoning-cache.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now reasoning-cache.service

# Start proxy for OpenCode Go (port 3458)
PORT=3458 UPSTREAM_URL=https://opencode.ai/inference/go/openai/v1 node ~/opencode-thinking-fix/proxy/proxy.js &

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
node --version   # Node 24 or newer
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
$env:UPSTREAM_URL = 'https://opencode.ai/inference/go/openai/v1'
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
`UPSTREAM_URL=https://opencode.ai/inference/go/openai/v1` if the OpenCode Go route is needed.

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
cp watchdog/watchdog.sh ~/opencode-thinking-fix/watchdog/
chmod +x ~/opencode-thinking-fix/watchdog/watchdog.sh
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
node ~/opencode-thinking-fix/tests/test-plugin.js  # 12/12 should pass
node ~/opencode-thinking-fix/tests/test-proxy.js   # 214/214 should pass
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

## F12 — Z.ai Preserved Thinking (provider body injection, 2026-09-01)

Implemented in `proxy/core.js` as `applyProviderBodyInjections(modelName, body, routeTarget)`, called from `proxy.js` next to F9 (Kimi sampling-params) and F10 (MiniMax `reasoning_split`).

- **Rule.** If the model name starts with `glm` or `zhipu` AND `routeTarget.base` matches a Z.ai-reachable host allowlist, inject `body.thinking = { ...body.thinking, clear_thinking: false }`.
- **Allowlist** (in `isZAiReachableBase`): `open.bigmodel.cn` (BigModel direct, port 3457), `api.z.ai` (Z.ai intl, forward-compat), `opencode.ai/zen/go*` and `opencode.ai/inference/go*` (Go gateway, ports 3458 and 3463), `openrouter.ai` (port 3462). Anything else → no injection.
- **Skip conditions.** (a) `body.thinking === false` (client explicitly disabled thinking — incoherent to force preserved thinking on top). (b) `body` is null/array. (c) `routeTarget` is null. (d) `modelName` is empty.
- **Return shape.** `{ body, modified, injections: [{ tag, field, value }] }`. `proxy.js` logs each injection via `writeLog({ event: 'provider_injection', ... })`.
- **Docs authority.** `https://docs.z.ai/guides/capabilities/thinking-mode` (Preserved Thinking section) and `https://docs.z.ai/api-reference/llm/chat-completion` (`thinking.clear_thinking`, default `true`).
- **Distinction from F9/F10.** F9 and F10 are gated by `!UPSTREAM_URL` (port 3457 only). F12 is **not** — Preserved Thinking is a Z.ai contract, not a port-3457 behavior. The host allowlist replaces the `!UPSTREAM_URL` gate.

## F19 — InclusionAI Ling 3.0 Flash route (2026-09-03)

Implemented in `proxy/core.js` `ROUTES` as three new entries in 2026-09-03; two remain, because the Zen `-fin-free` entry was retired on 2026-10-23. No code change to the proxy logic — only the route table.

- **Rule.** Models starting with `inclusionai/ling-3.0-flash` (with or without `:free` suffix) resolve to `https://openrouter.ai/api/v1` with `reasoningKey: 'reasoning_content'`. The prefixed form `opencode/ling-3.0-flash-fin-free` used to resolve to the OpenCode Zen free-tier lane; on 2026-10-23 that form was retired — `ling-3.0-flash-fin-free` is absent from the live Zen catalogue, so the route was removed. The OpenRouter `inclusionai/ling-3.0-flash` entries remain.
- **OpenRouter response shape.** `choices[0].message.reasoning` (string) + `choices[0].message.reasoning_details` (array of `{type: "reasoning.text", text, format: "unknown", index}`). OpenRouter accepts `reasoning_content` as an input alias of `reasoning` on messages and normalizes on outbound to the upstream (Novita, DeepInfra). The passback key `reasoning_content` is what the proxy stores and re-injects; the response field the proxy caches is `delta.reasoning` (and `delta.reasoning_details` for the array form).
- **Skip conditions.** None — these routes are unconditionally active. Non-reasoning models (`gpt`, `claude`, etc.) are not affected because the route only fires when the model name starts with `inclusionai/ling-3.0-flash`.
- **Live verification.** Two-turn reasoning-continuity test on port 3457: turn 1 emitted 271 chars of reasoning on a 7×6 step-by-step; turn 2 (with cached `reasoning_content` echoed back) referenced the prior step ("The user previously asked for 7 times 6, and I was in the process of showing step-by-step work. The result of 7 × 6 is 42.") and continued to 42+5=47. Upstream was Novita.
- **Docs authority.** `https://openrouter.ai/inclusionai/ling-3.0-flash` (model page, $0.021/M input, $0.063/M output, 262K context); `https://ant-ling.com/en/docs/api-reference/openai/` (native ant-ling OpenAI-compatible API with `thinking.type: enabled|disabled` and `reasoning.effort: high|xhigh`); `https://huggingface.co/inclusionAI/Ling-3.0-flash` (model card, `ling3` reasoning parser default, `chat_template_kwargs: {"enable_thinking": false}` to disable); `https://github.com/inclusionAI` (org page; `vllm-ling-v3` for self-host); `https://arxiv.org/abs/2606.15079` (Ling/Ring 2.6 technical report).
- **Distinction from F12.** F12 injects `body.thinking.clear_thinking: false` (host-allowlisted Z.ai contract). F19 adds three lines to the route table; it does not modify request bodies, only chooses upstream and passback key.

## Model Routing Table (Port 3457)

| Prefix | Upstream | Reasoning |
|---|---|---|
| Zen free-tier bare ids (`beam-free`, `deepseek-v4.1-flash-free`, `flint-40b-free`, `glm-5.3-flash-free`, `jev-1.13-free`, `mimo-v2.6-flash-free`, `nemotron-3.5-lightning-free`, `nemotron-3.5-super-vl-free`, plus `big-pickle`) — re-synced 2026-10-23 | `https://opencode.ai/zen/v1` | Yes (`reasoning_content`) |
| `opencode/` + free ids (same set with prefix) | `https://opencode.ai/zen/v1` | Yes (`reasoning_content`) |
| `deepseek` | `https://api.deepseek.com` | Yes |
| `deepseek-chat` | `https://api.deepseek.com` | Yes — non-thinking alias, passback is a no-op |
| `deepseek-r1`, `deepseek-reasoner` | `https://api.deepseek.com` | Legacy — retired by DeepSeek 2026-07-24; kept as compat guard (`'strip'` sentinel) |
| `kimi`, `moonshot` | `https://api.moonshot.ai/v1` | Yes |
| `glm`, `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | Yes |
| `minimax` | `https://api.minimax.io/v1` | Yes (`reasoning_details`) |
| `mimo` | `https://api.xiaomimimo.com/v1` | Yes (`reasoning_content`) |
| `inclusionai/ling-3.0-flash` (and `:free`) | `https://openrouter.ai/api/v1` | Yes — OR normalizes to `delta.reasoning` + `delta.reasoning_details`; passback as `reasoning_content` is honored (F19) |
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
4. Go mode never consults `ROUTES`: `/messages` + (minimax|qwen) → `'anthropic'`; glm-5.2 on `/chat/completions` → `'reasoning_content'`; `REASONING_KEY` env (when set) overrides to that key; else `'reasoning'`. Kimi strip / `reasoning_split` are 3457-only (`!UPSTREAM_URL`); F12 Z.ai Preserved Thinking is **all** Z.ai-reachable lanes (host-allowlisted, not port-gated).
5. Logging: proxy = console→journal (DEBUG-gated) + `writeLog` JSONL (ungated); plugin keeps its own `writeLog`. No winston/pino. systemd units stay `Type=simple`/journal/`%h`.
6. Git: agents never run git commit/push/add/checkout. Working tree only; human publishes via branch + squash merge.
7. Upstream path handling (`upstreamPathFor` in core.js): if the client URL already starts with the upstream's official base path (e.g. OpenRouter `/api/v1`), forward as-is; never double the prefix.
8. F19 (2026-09-03) routes are port-3457-only and pure ROUTES entries: `inclusionai/ling-3.0-flash` and `inclusionai/ling-3.0-flash:free` → `https://openrouter.ai/api/v1` with `reasoningKey: 'reasoning_content'` (OR normalizes on outbound); `opencode/ling-3.0-flash-fin-free` routed to `https://opencode.ai/zen/v1` until 2026-10-23, when the id disappeared from the live Zen catalogue and the entry was removed (it now resolves to DEFAULT_ROUTE). No body injection, no SSE-parser change, no plugin change. Distinction from F12: F19 is **route-only**; F12 is **body-injection** under a host allowlist.

## Troubleshooting

- **Proxy dies after a fresh clone with `ERR_MODULE_NOT_FOUND: Cannot find package 'eventsource-parser'`**: the checkout ships without installed deps. Fix: `cd ~/opencode-thinking-fix && npm install --omit=dev`, then restart the proxy or re-enable the unit.
- **Plugin fails under raw `node require()`**: designed behavior. The plugin loads through OpenCode. Register it in `opencode.json` and restart OpenCode. Do not `require()` it from node directly.
- **Plugin not loading**: check `~/.config/opencode/plugins/` (plural with 's'), not `plugin/`. OpenCode reads from `plugins/` directory.
- **Broken plugin dependency**: check for `@opencode-ai/plugin` in `~/.config/opencode/node_modules/`, delete it if present (causes conflicts).
- **Proxy not starting**: check port conflicts with `lsof -i :3457` or `lsof -i :3458`.
- **Cache not working**: verify `x-session-id` header is being forwarded by OpenCode to the proxy.
- **Watchdog**: check logs with `journalctl --user -u reasoning-proxy-watchdog.service -f`.
- **Unit file not found**: run `systemctl --user daemon-reload` after copying `.service` files.
- **`systemctl --user` fails**: ensure D-Bus user session is running. On non-systemd distros, use direct `node` invocation instead.
- **Tests fail**: ensure proxy is running on the expected port before executing tests.
