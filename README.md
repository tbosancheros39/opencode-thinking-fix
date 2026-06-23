# opencode-thinking-fix

[![npm version](https://img.shields.io/npm/v/opencode-thinking-fix)](https://www.npmjs.com/package/opencode-thinking-fix)
[![Test](https://github.com/tbosancheros39/opencode-thinking-fix/actions/workflows/test.yml/badge.svg)](https://github.com/tbosancheros39/opencode-thinking-fix/actions/workflows/test.yml)
[![npm downloads](https://img.shields.io/npm/dm/opencode-thinking-fix)](https://www.npmjs.com/package/opencode-thinking-fix)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/tbosancheros39/opencode-thinking-fix/blob/main/LICENSE.md)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

```bash
npm install opencode-thinking-fix
```

> Fix for the `reasoning_content` 400 error that kills multi-turn conversations with DeepSeek, Kimi, GLM, MiMo, and MiniMax-M3 in OpenCode.
>
> Docs: [OpenCode Plugins](https://opencode.ai/docs/plugins)

---

## Quick Install

**This is an OpenCode plugin. Install it inside OpenCode — no terminal needed.**

### Method 1: TUI (press `Ctrl+P` while OpenCode is running)

1. Press `Ctrl+P` to open the command palette.
2. Type `install plugin` and press `Enter`.
3. Press `Tab` to switch the install scope to **Global** (recommended — works across all projects).
4. Type `opencode-thinking-fix`.
5. Press `Enter`. Restart OpenCode.

You should see `[ThinkingFix] Plugin loaded — universal reasoning_content fix active` at startup.

### Method 2: CLI (shell command)

```bash
opencode plugin opencode-thinking-fix
```

For a specific version:

```bash
opencode plugin opencode-thinking-fix@1.1.4
```

Restart OpenCode after installing.

### Method 3: Manual config (add to `opencode.json`)

```json
{
  "plugin": ["opencode-thinking-fix"]
}
```

Config file location:
- **Linux/macOS:** `~/.config/opencode/opencode.json` (global) or `.opencode/opencode.json` (project)
- **Windows:** `%APPDATA%/OpenCode/opencode.json` (global) or `.opencode/opencode.json` (project)

Restart OpenCode after adding. You should see `[ThinkingFix] Plugin loaded` at startup.

See also: [OpenCode plugin docs](https://opencode.ai/docs/plugins)

---

- [What problem this fixes](#what-problem-this-fixes)
- [Option 1: Plugin (stops the crashes)](#option-1-plugin-stops-the-crashes)
- [Option 2: Proxy (replays real reasoning)](#option-2-proxy-replays-real-reasoning)
- [Option 3: Watchdog (auto-recovery)](#option-3-watchdog-auto-recovery)
- [How they work together](#how-they-work-together)
- [Affected models](#affected-models)
- [Model routing](#model-routing)
- [Is it working?](#is-it-working)
- [Running tests](#running-tests)
- [This bug is everywhere](#this-bug-is-everywhere)
- [Files in this repo](#files-in-this-repo)

---

## What problem this fixes

You ask DeepSeek a question. It picks a tool, calls it, works fine. Then you ask a follow-up and you get this:

```
HTTP 400: The reasoning_content in the thinking mode must be passed back to the API
```

DeepSeek V4 (and Kimi K2.7, GLM 5.x, MiMo V2.5) require that `reasoning_content` from every prior assistant turn gets included in subsequent API requests. The [docs](https://api-docs.deepseek.com/guides/thinking_mode) say it clearly: if you do not pass back `reasoning_content` correctly, the API returns a 400 error.

OpenCode's provider layer drops this field. Three upstream PRs ([#24250](https://github.com/anomalyco/opencode/pull/24250), [#24428](https://github.com/anomalyco/opencode/pull/24428), [#24895](https://github.com/anomalyco/opencode/pull/24895)) tried to fix it. None merged. The field is non-standard per OpenAI, so both OpenCode and the AI SDK ignore it.

This repo fixes it. Three layers, pick what you need.

---

## Option 1: plugin (stops the crashes)

### Install via npm (recommended)

See [Quick Install](#quick-install) above — use OpenCode TUI (`Ctrl+P`) or CLI (`opencode plugin opencode-thinking-fix`).

### Manual install (for local development)

Drop the plugin file in your OpenCode plugins directory and restart:

```bash
mkdir -p ~/.config/opencode/plugins
cp plugins/opencode-thinking-fix-universal.ts ~/.config/opencode/plugins/
```

It scans outgoing messages for any assistant turn that already has `reasoning_content`. If it finds one (meaning you are using a reasoning model), it adds `reasoning_content: ""` to every assistant turn missing it. If it finds nothing (Qwen, GPT, Claude — they never produce this field), it does nothing.

It also handles `reasoning` for the OpenCode Go provider, and patches empty `content` fields that OpenAI-compatible SDKs sometimes omit.

No config file changes. No build step. OpenCode compiles `.ts` plugins when it starts.

**The catch:** the plugin fills in empty strings, not your model's actual prior thinking. DeepSeek, Kimi K2.5/K2.6, GLM, and MiMo accept empty strings fine — your conversation works but the model does not see its earlier reasoning. Kimi K2.7 Code rejects empty strings entirely, it needs the real text.

---

## Option 2: proxy (replays real reasoning)

A Node.js proxy that catches API responses as they come back, pulls out the actual `reasoning_content` text, and caches it in memory. On the next request, it injects that real text back into the conversation history instead of empty strings.

Your model sees its full chain-of-thought from turn 1 on every subsequent turn. The difference is noticeable on complex multi-turn coding sessions.

### Two-proxy architecture

The proxy runs on **two ports**:

| Port | Purpose | Environment |
|---|---|---|
| **3457** | Direct providers (DeepSeek, Kimi, GLM, MiMo, GPT, Claude, Qwen, Gemini, etc.) | `PORT=3457` |
| **3458** | OpenCode Go provider | `PORT=3458` `UPSTREAM_URL=https://opencode.ai/zen/go/v1` |

Port 3457 auto-routes based on model name using the built-in route table. Port 3458 is a fixed-upstream proxy specifically for the OpenCode Go provider, which uses `delta.reasoning` (not `reasoning_content`) in its SSE streams. Both are handled by the same `proxy.js` binary — just different environment variables.

```bash
# Linux / macOS / Windows (Node.js required)
node proxy/proxy.js

# OpenCode Go proxy
PORT=3458 UPSTREAM_URL=https://opencode.ai/zen/go/v1 node proxy/proxy.js
```

> **Windows PowerShell:** use `$env:PORT=3457; node proxy/proxy.js` (PowerShell) or `set PORT=3457 && node proxy/proxy.js` (CMD).

### Install as systemd services (auto-start at boot)

```bash
mkdir -p ~/.config/systemd/user
cp systemd/reasoning-cache.service ~/.config/systemd/user/
cp systemd/reasoning-cache-go.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now reasoning-cache.service
systemctl --user enable --now reasoning-cache-go.service
```

Then point OpenCode at it — in your `opencode.json`:

```json
{
  "provider": {
    "deepseek-v4-pro": {
      "baseURL": "http://127.0.0.1:3457/v1"
    },
    "opencode-go": {
      "baseURL": "http://127.0.0.1:3458/v1"
    }
  }
}
```

Zero npm dependencies. It uses `http`, `https`, and `url` — nothing else.

**Interleaved thinking support:** GLM-5+ and MiniMax-M3 emit reasoning AFTER content in the same turn (interleaved thinking between tool calls). The proxy accumulates ALL reasoning across an entire assistant turn and flushes only on `finish_reason` — never on `delta.content` arrival. This prevents split/lost reasoning blocks.

**Kimi K2.7 Code and OpenCode Go need this.** The rest of the models benefit from it but do not technically require it.

---

## Option 3: watchdog (auto-recovery)

The watchdog script checks both proxy instances every 4 minutes and restarts any that are down:

```bash
cp watchdog/watchdog.sh ~/reasoning-cache-proxy/
cp systemd/reasoning-proxy-watchdog.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now reasoning-proxy-watchdog.service
```

---

## How they work together

```
OpenCode → [plugin patches missing reasoning_content/reasoning]
         → [proxy injects cached real text]
         → [watchdog keeps both proxies alive]
         → API
```

The plugin is the safety net. If the proxy goes down, the plugin still injects empty strings so you do not get 400s. If the proxy is up, its cached text takes priority because the plugin sees the field is already filled in. Either way, your conversation does not break.

---

## Affected models

| Model | Plugin helps | Proxy helps | What it needs |
|---|---|---|---|
| DeepSeek V4 Pro / Flash | Yes | Nice to have | Accepts `""` |
| Kimi K2.5 / K2.6 | Yes | Nice to have | Accepts `""` |
| **Kimi K2.7 Code** | **Not enough alone** | **Required** | Needs real text |
| GLM-5.x / Zhipu | Yes | Nice to have | Accepts `""` |
| MiMo V2.5 / MiniMax | Yes | Nice to have | Accepts `""` (default mode embeds `<think>` in `content`) |
| **MiniMax-M3** | Yes | **Recommended** | `reasoning_details[]` array; ~40% quality loss if stripped. Proxy injects `reasoning_split:true` to keep thinking separate from content. |
| OpenCode Go | Yes | Required | Uses `reasoning` field |
| Qwen, GPT, Claude, Gemini, Llama, Mistral | No | No | No reasoning_content |

---

## Model routing (proxy port 3457)

The proxy auto-routes by model name prefix. All 15 supported prefixes:

| Prefix | Upstream | Reasoning |
|---|---|---|
| `deepseek-v4-pro` | `https://api.deepseek.com` | Yes |
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

Unknown models fall back to `https://api.deepseek.com` with reasoning disabled.

---

## Is it working?

Turn 1 will not show anything — there is no history to patch yet. That is normal.

Turn 2+, check the console:

**Plugin working:**
```
[ThinkingFix] patched 3 field(s) across 11 message(s)
```

**Proxy working:**
```
[Cache] session abcdefgh: stored reasoning turn 0 (1842 chars)
[Cache] session abcdefgh: replayed reasoning for turn 0 (1842 chars)
```

If nothing shows up, either it is a non-reasoning model (correct) or the plugin did not load (check for `[ThinkingFix] Plugin loaded` at startup).

Quick proxy health check:

```bash
curl http://127.0.0.1:3457/health
# → {"ok":true,"uptime":42}
curl http://127.0.0.1:3458/health
# → {"ok":true,"uptime":42}
```

Proxy logs:

```bash
journalctl --user -u reasoning-cache.service -f
journalctl --user -u reasoning-cache-go.service -f
```

---

## Running tests

```bash
npm test
# or directly:
node tests/test-plugin.js
node tests/test-proxy.js
```

The plugin tests cover 12 cases: native reasoning model detection, OpenCode Go `reasoning` field detection, non-reasoning model passthrough, mixed messages, multiple assistant turns, already-complete messages, wrapper format (`{ info: Message }`), empty `reasoning_content`, empty arrays, tool_calls with reasoning and without, and null/undefined wrappers.

The proxy tests cover 15 cases: route resolution for all model prefixes, `patchRequestBody` injection from cache for both `reasoning_content` and `reasoning`, no-cache fallback to empty strings, user message isolation, multi-turn caching, and SSE stream parsing for `delta.reasoning_content`, `delta.reasoning`, content-triggered flush, and `finish_reason` flush.

---

## This bug is everywhere

OpenCode is not the only tool that drops `reasoning_content`. Here is a partial list of places this same bug shows up:

**OpenCode (anomalyco/opencode):** [#24190](https://github.com/anomalyco/opencode/issues/24190), [#24104](https://github.com/anomalyco/opencode/issues/24104), [#24722](https://github.com/anomalyco/opencode/issues/24722), [#25311](https://github.com/anomalyco/opencode/issues/25311), [#25134](https://github.com/anomalyco/opencode/issues/25134), [#25000](https://github.com/anomalyco/opencode/issues/25000), [#24124](https://github.com/anomalyco/opencode/issues/24124), [#24130](https://github.com/anomalyco/opencode/issues/24130), [#24261](https://github.com/anomalyco/opencode/issues/24261), [#24442](https://github.com/anomalyco/opencode/issues/24442), [#24569](https://github.com/anomalyco/opencode/issues/24569)

**OpenClaw:** [#71435](https://github.com/openclaw/openclaw/issues/71435), [#71050](https://github.com/openclaw/openclaw/issues/71050)

**Kilo Code:** [#9501](https://github.com/Kilo-Org/kilocode/issues/9501)

**VS Code:** [#318920](https://github.com/microsoft/vscode/issues/318920)

**OpenAI Codex:** [#24500](https://github.com/openai/codex/issues/24500)

**GitHub Copilot:** [discussion #193953](https://github.com/orgs/community/discussions/193953)

**OmniRoute:** [#1628](https://github.com/diegosouzapw/OmniRoute/issues/1628)

**Reddit:** [r/opencodeCLI](https://www.reddit.com/r/opencodeCLI/comments/1svftic/), [r/DeepSeek](https://www.reddit.com/r/DeepSeek/comments/1tqvrup/), [r/RooCode](https://www.reddit.com/r/RooCode/comments/1sw7e54/)

**Blogs covering it:** [AkitaOnRails](https://akitaonrails.com/en/2026/05/04/llm-benchmarks-deepseek-unlocked-deepclaude/), [ClawHub](https://clawhub.ai/17329971/deepseek-v4-reasoning-bug)

---

## Files in this repo

```
plugins/
  opencode-thinking-fix-universal.ts   # self-detection plugin (106 lines)
proxy/
  proxy.js                              # reasoning cache proxy (333 lines, zero deps)
tests/
  test-plugin.js                        # plugin unit tests (228 lines, 12 cases)
  test-proxy.js                         # proxy unit tests (359 lines, 15 cases)
watchdog/
  watchdog.sh                           # auto-recovery watchdog (64 lines)
systemd/
  reasoning-cache.service               # proxy systemd unit (port 3457)
  reasoning-cache-go.service            # OpenCode Go proxy unit (port 3458)
  reasoning-proxy-watchdog.service      # watchdog systemd unit
```

## Tested on

| Platform | Plugin | Proxy | Watchdog | Systemd |
|----------|--------|-------|----------|---------|
| **Linux** (Kubuntu 24.04) | ✅ | ✅ | ✅ (bash) | ✅ |
| **macOS** | ✅ | ✅ | ✅ (bash) | ❌ (use launchd) |
| **Windows** | ✅ | ✅ | ❌ (bash) | ❌ |

OpenCode v1.17.9+, DeepSeek V4 Pro, Kimi K2.5/K2.6/K2.7, GLM-5.x, MiMo V2.5, MiniMax-M3, OpenCode Go.

### Windows notes

**Plugin and proxy work fully on Windows.** The proxy (`proxy.js`) uses only Node.js built-in modules (`http`, `https`, `url`) — zero platform-specific code. Start it with:

```powershell
# PowerShell
$env:PORT=3457; node proxy\proxy.js
```

**Watchdog and systemd are Linux-only.** For Windows auto-restart, use **Task Scheduler** or **NSSM** (Non-Sucking Service Manager) to run the proxy as a Windows service:

```powershell
# Using NSSM (install once: winget install nssm)
nssm install ReasoningCacheProxy node.exe proxy\proxy.js
nssm set ReasoningCacheProxy AppDirectory C:\path\to\opencode-thinking-fix
nssm set ReasoningCacheProxy AppEnvironmentExtra PORT=3457
nssm start ReasoningCacheProxy
```

Repeat for the Go proxy on PORT=3458 with `UPSTREAM_URL=https://opencode.ai/zen/go/v1`.

**OpenCode config paths on Windows:**

| Scope | Path |
|-------|------|
| Global | `%APPDATA%\OpenCode\opencode.json` |
| Project | `<project>\.opencode\opencode.json` |
| Plugins dir | `%APPDATA%\OpenCode\plugins\` |
| npm cache | `%LOCALAPPDATA%\opencode\node_modules\` |
