# opencode-thinking-fix

[![npm version](https://img.shields.io/npm/v/opencode-thinking-fix)](https://www.npmjs.com/package/opencode-thinking-fix)
[![Test](https://github.com/tbosancheros39/opencode-thinking-fix/actions/workflows/test.yml/badge.svg)](https://github.com/tbosancheros39/opencode-thinking-fix/actions/workflows/test.yml)
[![npm downloads](https://img.shields.io/npm/dm/opencode-thinking-fix)](https://www.npmjs.com/package/opencode-thinking-fix)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/tbosancheros39/opencode-thinking-fix/blob/master/LICENSE.md)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

```bash
npm install opencode-thinking-fix
```

> Restores reasoning content that clients and SDKs drop from multi-turn conversations — DeepSeek, Kimi, GLM, MiMo, MiniMax, and OpenCode Go.
>
> **Zero config.** Install via `Ctrl+P`, restart OpenCode, done. The plugin auto-detects reasoning models and only patches when needed.
>
> Docs: [OpenCode Plugins](https://opencode.ai/docs/plugins)

Your AI has a secret notebook.

When DeepSeek or Kimi answers you, it scribbles notes first. "Let me think... the user wants a login page... I should use React Hook Form... check the API docs..." These notes are `reasoning_content`. You never see them. But the AI needs them.

The client and its SDK throw the notebook away. Next turn, the AI reaches for it — but the request already went to the API without it. The request carries no notes, or a blank notebook. The AI doesn't crash, but it forgot everything it was thinking. That is why your AI seems dumber on turn 2. It's not dumber. It just lost its notes.

The drop happens in SDK serializers and client transforms (truthy checks, missing type members, stripped signatures), not in the providers — the providers are doing exactly what their docs say.

**Without the plugin:** "Build me a login page." → AI builds it. "Now add password reset." → AI lost its notes, conversation degrades.

**With the plugin:** "Build me a login page." → AI builds it, notes saved. "Now add password reset." → AI reads its notes: "I used React Hook Form for login, I'll extend that for password reset." → Works.

---

## ELI15 — what this thing actually does

Imagine you're doing homework with a friend (the AI) over text messages. Your friend is smart but **forgetful between messages**. Every time they answer, they first scribble their thinking on a **sticky note** (that's `reasoning_content`) — but you never see the note, and the note gets **thrown away** before your friend reads the next message.

So when you say "ok now change the color," your friend has no memory of *why* they picked the blue button, gets confused, and gives a worse answer (the "dumber on turn 2" feeling).

Three facts make this messy:

1. **The sticky notes are non-standard.** Normal chat apps don't have a "thinking note" field. So the tool that carries your messages back and forth (OpenCode, Cursor, Roo, etc.) simply **doesn't know the note exists** and drops it.
2. **The teachers (Chinese AI companies: DeepSeek, Kimi, GLM, MiMo, MiniMax) demand the note back.** Their rules say: "if you don't hand me the exact sticky note from last time, I refuse to answer."
3. **Some teachers are picky about the note being present**, not missing. Kimi K2.7-Code accepts a present-but-empty note. Others (DeepSeek, Kimi K2.5/2.6, GLM, MiMo) accept a blank one but then they "forget" and do worse.

What this repo does about it:

- **The plugin** is a tiny note-checker that runs inside OpenCode. It looks at every message and, if a note is missing, it slips a blank note in so the teacher doesn't yell. Cheap, but the teacher still forgets (blank note = no memory).
- **The proxy** is a smarter middle-man that sits between OpenCode and the teacher. It **reads the real sticky note off each answer, remembers it, and pastes the actual writing back** into the next message. Now the teacher remembers, and your friend stays sharp. (v3 rewrote the proxy so it does this with almost zero slowdown — see below.)
- **The watchdog** is just a babysitter that restarts the proxy if it ever crashes.

Bottom line: **the proxy is what makes the AI actually remember its thinking. The plugin is a safety net. The watchdog keeps the lights on.**

---

## v3 proxy rewrite — performance + correctness

The proxy (`proxy/proxy.js`) was rewritten to remove the slowdown you were hitting:

- **Raw-byte streaming.** Responses are now forwarded as-is; the stream is parsed *only* to cache the note. No more re-building every token before sending it to you.
- **Lazy patching.** If OpenCode already hands the notes back correctly (newer builds do), the proxy does **nothing** — zero JSON rewriting, zero overhead.
- **Correct note placement (the big bug fix).** Earlier versions pasted every note into the *first* slot, so turn 3+ forgot everything. v3 stores each note in its own correct slot, so every turn replays *its own* thinking.
- **Keep-alive connections + upstream timeout.** Fewer TLS handshakes, no hung requests.

## v3.1 — dialect-aware patching (intel-driven)

Provider-specific research showed the field name is **not universal** and the "echo everything" heuristic was
causing cross-provider poisoning. v3.1 fixes that:

- **Echo only the field the upstream expects.** Each route declares a `reasoningKey`:
  `reasoning_content` (DeepSeek/Kimi/Moonshot/GLM/Zhipu/MiMo), `reasoning_details`
  (MiniMax split mode), `reasoning` (OpenCode Go / fixed-upstream). Previously the proxy
  filled all three fields, so a GLM turn stored under `reasoning` could poison a later
  DeepSeek replay that expects `reasoning_content`.
- **R1 vs V4 split.** `deepseek-reasoner` (R1) must **not** receive reasoning echoed back
  (400 if you do) while V4 must. R1 uses the v3.2 `reasoningKey: 'strip'` sentinel,
  which actively removes reasoning fields before forwarding.
- **Never fabricate reasoning.** Unknown models and providers that reject echo
  (Qwen, GPT, Claude, Gemini, Llama, Mistral, Cerebras-hosted GLM) default to
  `reasoningKey: null` — the body is forwarded untouched.

### "Another way" — do you even need the plugin now?

The reasoning-drop is fixed at the wire layer by the proxy, so you have three options:

| Approach | Pros | Cons |
|----------|------|------|
| **Proxy-only (recommended)** — keep a *slim* plugin that only tags sessions with `x-session-id`, let the proxy do all note-handling | Real reasoning replay, near-zero overhead, correct across all turns | One extra localhost process to run |
| **Native / disable thinking** — point at the provider's Anthropic-compatible endpoint (e.g. DeepSeek `/anthropic`) or set `thinking: disabled` | No extra process, simplest | Loses ~20–40% reasoning quality on hard coding tasks |
| **Full plugin + proxy** (old default) | Maximum safety net | Plugin's per-message transform adds overhead inside OpenCode |

**Recommendation:** run the proxy, and slim the plugin down to *just* the `x-session-id` header injection (delete its message-transform hook). That gives you real reasoning replay with the least overhead.

## Plugin optionality and derived sessions

As of 3.2.0, the plugin is optional. The shipped npm plugin still contains the transform hook; without it, derived keys keep caching functional; with it, you add exact session IDs + schema padding. The proxy derives session identity from the request when `x-session-id` is absent. Formula: `sha256(authHeader + '||' + modelName + '||' + firstUserMessageText)`, prefixed with `derived:` and truncated to 32 hex characters; header wins when present. The key is fixed at the first user message, so cross-talk is bounded to sessions sharing the same auth header, model, and first user prompt; replayed text is still valid reasoning for that model, so the impact is quality-level, never a 400.

---

## Quick Install

**This is an OpenCode plugin. Install it inside OpenCode, no terminal needed.**

| Method | Command | Best for |
|--------|---------|----------|
| **TUI** | `Ctrl+P` → type `install plugin` → `opencode-thinking-fix` | First-time users |
| **CLI** | `opencode plugin opencode-thinking-fix` | Scripting |
| **Manual** | Add `"plugin": ["opencode-thinking-fix"]` to `opencode.json` | Version pinning |

### Method 1: TUI (press `Ctrl+P` while OpenCode is running)

1. Press `Ctrl+P` to open the command palette.
2. Type `install plugin` and press `Enter`.
3. Press `Tab` to switch the install scope to **Global** (recommended, works across all projects).
4. Type `opencode-thinking-fix`.
5. Press `Enter`. Restart OpenCode.

Check `~/.local/share/opencode/thinking-fix.log` for `plugin_loaded`. See [Is it working?](#is-it-working).

### Method 2: CLI (shell command)

```bash
opencode plugin opencode-thinking-fix
```

For a specific version:

```bash
opencode plugin opencode-thinking-fix@3.2.0
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

Restart OpenCode after adding. Check `~/.local/share/opencode/thinking-fix.log` for `plugin_loaded`. See [Is it working?](#is-it-working).

See also: [OpenCode plugin docs](https://opencode.ai/docs/plugins)

> **On Windows?** See [Windows notes](#windows-notes) for PowerShell commands, NSSM service setup, and config paths.

---

- [What problem this fixes](#what-problem-this-fixes)
- [Option 1: Plugin (safety net)](#option-1-plugin-safety-net)
- [Option 2: Proxy (replays real reasoning)](#option-2-proxy-replays-real-reasoning)
- [Option 3: Watchdog (auto-recovery)](#option-3-watchdog-auto-recovery)
- [How they work together](#how-they-work-together)
- [Affected models](#affected-models)
- [Model routing](#model-routing)
- [Is it working?](#is-it-working)
- [This bug is everywhere](#this-bug-is-everywhere)
- [Files in this repo](#files-in-this-repo)

---

## What problem this fixes

You ask DeepSeek a question. It picks a tool, calls it, works fine. Then you ask a follow-up — and the AI has lost the reasoning it produced on every earlier turn.

The client/SDK dropped the field before it reached the API — the providers are doing exactly what their docs say. The drop happens in SDK serializers and client transforms.

> **Deprecated:** the historical symptom of this drop — `HTTP 400: The reasoning_content in the thinking mode must be passed back to the API` — is **resolved** by this fix. This repo is about the drop itself, not the error it used to cause.

DeepSeek V4 (and Kimi K2.7, GLM 5.x, MiMo V2.5) require that `reasoning_content` from every prior assistant turn gets included in subsequent API requests. The [docs](https://api-docs.deepseek.com/guides/thinking_mode) say it clearly: if you do not pass back `reasoning_content` correctly, the API rejects the request. All five providers confirm this in their official documentation:

- **DeepSeek**: "[The reasoning_content will be ignored by the API](https://api-docs.deepseek.com/guides/thinking_mode)", but the conversation history must contain the field.
- **Z.AI / GLM**: "[Key: return reasoning_content to keep the reasoning coherent](https://docs.z.ai/en/api/thinking)."
- **Kimi / Moonshot**: "[You must keep the reasoning_content in the multi-round conversation... otherwise an error will be thrown](https://platform.moonshot.ai/docs/guide/thinking-mode)."
- **MiniMax**: "[The complete model response must be append to the conversation history](https://platform.minimaxi.com/document/ChatCompletion%20v2)."
- **Xiaomi MiMo**: "[Any assistant message with tool calls... must preserve its full reasoning_content field, otherwise the API will return a 400 error](https://dev.mi.com/doc/llm-api). Affected frameworks include TRAE, Cursor, Roo Code, Codex, GitHub Copilot CLI, Zed, AutoGen."

The field is non-standard per OpenAI, so SDKs and clients ignore it — the drop is
systemic, not a single tool's bug. This repo fixes it. Three layers, pick what you need.

---

## Option 1: plugin (safety net)

### Install via npm (recommended)

See [Quick Install](#quick-install) above, use OpenCode TUI (`Ctrl+P`) or CLI (`opencode plugin opencode-thinking-fix`).

### Manual install (for local development)

Drop the plugin file in your OpenCode plugins directory and restart:

```bash
mkdir -p ~/.config/opencode/plugins
cp plugins/opencode-thinking-fix-universal.ts ~/.config/opencode/plugins/
```

It scans outgoing messages for any assistant turn that already has `reasoning_content`. If it finds one (meaning you are using a reasoning model), it adds `reasoning_content: ""` to every assistant turn missing it. If it finds nothing (Qwen, GPT, Claude, they never produce this field), it does nothing.

It also handles `reasoning` for the OpenCode Go provider, and patches empty `content` fields that OpenAI-compatible SDKs sometimes omit.

No config file changes. No build step. OpenCode compiles `.ts` plugins when it starts.

**The catch:** the plugin fills in empty strings, not your model's actual prior thinking. DeepSeek, Kimi K2.5/K2.6, GLM, and MiMo accept empty strings fine, your conversation works but the model does not see its earlier reasoning. Kimi K2.7 Code requires the field to be present; present-but-empty is accepted.

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

Port 3457 auto-routes based on model name using the built-in route table. Port 3458 is a fixed-upstream proxy specifically for the OpenCode Go provider. It handles the provider's supported chat and Anthropic message dialects, while passing unsupported response formats through unchanged. Both are handled by the same `proxy.js` binary, just different environment variables.

```bash
# Linux / macOS / Windows (Node.js required)
node proxy/proxy.js

# OpenCode Go proxy
PORT=3458 UPSTREAM_URL=https://opencode.ai/zen/go/v1 node proxy/proxy.js
```

> **Windows PowerShell:** use `$env:PORT=3457; node proxy/proxy.js` (PowerShell) or `set PORT=3457 && node proxy/proxy.js` (CMD).

### OpenCode Go setup (explicit and credentials-safe)

The npm package intentionally does **not** run a `postinstall` script. It never
reads `auth.json`, edits your OpenCode configuration, starts a process, or
enables a service without your explicit action.

1. In OpenCode, run `/connect` and select **OpenCode Go**. Keep the credential
   in OpenCode's own local auth store; never paste it into this repository,
   `opencode.json`, a shell script, or a public issue.
2. Install the package and start its Go proxy manually:

```bash
npm install opencode-thinking-fix
PORT=3458 UPSTREAM_URL=https://opencode.ai/zen/go/v1 \
  node node_modules/opencode-thinking-fix/proxy/proxy.js
```

3. Point only the OpenCode Go provider at the local proxy. The `baseURL` must
   be under `provider.<id>.options`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "opencode-go": {
      "options": {
        "baseURL": "http://127.0.0.1:3458/v1"
      }
    }
  }
}
```

The proxy forwards the authorization header supplied by OpenCode to the
configured upstream and does not persist the credential. Stop the proxy when
it is not needed. The systemd and watchdog options below are deliberately
opt-in alternatives for operators who want automatic restarts.

### Install as systemd services (auto-start at boot)

```bash
mkdir -p ~/.config/systemd/user
cp systemd/reasoning-cache.service ~/.config/systemd/user/
cp systemd/reasoning-cache-go.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now reasoning-cache.service
systemctl --user enable --now reasoning-cache-go.service
```

Then point OpenCode at it, in your `opencode.json`:

```json
{
  "provider": {
    "deepseek-v4-pro": {
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

One runtime dependency (`eventsource-parser`). The proxy uses Node.js built-in `http`, `https`, and `url` for everything else.

**Interleaved thinking support:** GLM-5+ and MiniMax-M3 emit reasoning AFTER content in the same turn (interleaved thinking between tool calls). The proxy accumulates ALL reasoning across an entire assistant turn and flushes only on `finish_reason`, never on `delta.content` arrival. This prevents split/lost reasoning blocks.

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

The plugin is the safety net. If the proxy goes down, the plugin still injects empty strings so reasoning is never missing from the request. If the proxy is up, its cached text takes priority because the plugin sees the field is already filled in. Either way, your conversation keeps its thinking.

---

## Affected models

| Model | Plugin helps | Proxy helps | What it needs |
|---|---|---|---|
| DeepSeek V4 Pro / Flash | Yes | Nice to have | Accepts `""` (tool-call turns need real text) |
| Kimi K2.5 / K2.6 | Yes | Nice to have | Accepts `""` |
| **Kimi K2.7 Code** | **Not enough alone** | **Required** | Field must be *present*; real text keeps it coherent |
| GLM-5.x / Zhipu | Yes | Nice to have | Accepts `""` |
| MiMo V2.5 | Yes | Nice to have | `reasoning_content` on `api.xiaomimimo.com/v1` |
| **MiniMax-M3** | Yes | **Recommended** | `reasoning_details[]` array; ~40% quality loss if stripped. Proxy injects `reasoning_split:true` to keep thinking separate from content. |
| OpenCode Go | Yes | Recommended for chat/message routes | Chat uses `reasoning`; Anthropic messages are handled; unsupported response formats pass through |
| Qwen, GPT, Claude, Gemini, Llama, Mistral | No | No | No reasoning_content |

---

## Model routing (proxy port 3457)

The proxy auto-routes by model name prefix. All routes:

| Prefix | Upstream | Reasoning |
|---|---|---|
| `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-chat` | `https://api.deepseek.com` | Yes (`reasoning_content`) |
| `deepseek-reasoner` | `https://api.deepseek.com` | **No — actively stripped** (R1 contract: reasoning must NOT be echoed) |
| `kimi`, `moonshot` | `https://api.moonshot.ai/v1` | Yes (`reasoning_content`) |
| `glm`, `zhipu` | `https://open.bigmodel.cn/api/paas/v4` | Yes (`reasoning_content`) |
| `minimax` | `https://api.minimax.io/v1` | Yes (`reasoning_details`, `reasoning_split:true`) |
| `mimo` | `https://api.xiaomimimo.com/v1` | Yes (`reasoning_content`) |
| `gpt`, `o1` | `https://api.openai.com` | No |
| `claude`, `anthropic` | `https://api.anthropic.com` | No |
| `qwen` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | No |
| `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai` | No |
| `llama` | `https://api.together.xyz` | No |
| `mistral` | `https://api.mistral.ai` | No |

Unknown models fall back to `https://api.deepseek.com` with reasoning disabled.

---

## Is it working?

The plugin writes a structured JSON log: `~/.local/share/opencode/thinking-fix.log`.

628 unique sessions. 12,551 inspect events (the hook fires twice per message by design — first pass patches, second confirms clean). 297 reasoning model sessions patched, 331 non-reasoning correctly skipped. Zero false patches.

Before and after, from a real session:

```
Before:  reasoning dropped on every turn → AI forgets its thinking
After:   34 fields patched across a 104-message session → reasoning replays correctly
```

Here is a live excerpt from that session:

```json
{"ts":"2026-06-25T01:41:50.572Z","event":"inspect","isReasoningModel":true,
 "totalMessages":104,"patchedFields":34,"turns":[
   {"index":1,"fields":["text","reasoning"]},
   {"index":5,"fields":["text"]},
   {"index":9,"fields":["text"]},
   {"index":42,"fields":["reasoning"]}
 ]}
```

**No output?** Either you are on a non-reasoning model (correct, no patching needed) or the plugin did not load. Check:

```bash
grep plugin_loaded ~/.local/share/opencode/thinking-fix.log
```

Proxy health:

```bash
curl http://127.0.0.1:3457/health          # → {"ok":true,"uptime":1225}
curl http://127.0.0.1:3458/health          # → {"ok":true,"uptime":1225}
journalctl --user -u reasoning-cache.service -f
journalctl --user -u reasoning-cache-go.service -f
```

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
  opencode-thinking-fix-universal.ts   # self-detection plugin
proxy/
  core.js                               # pure logic: routes, cache, patching, parser
  proxy.js                              # HTTP server + side effects (1 dep)
watchdog/
  watchdog.sh                           # auto-recovery watchdog
systemd/
  reasoning-cache.service               # proxy systemd unit (port 3457)
  reasoning-cache-go.service            # OpenCode Go proxy unit (port 3458)
  reasoning-proxy-watchdog.service      # watchdog systemd unit
```

## Release highlights

- **v3.2.0:** R1 `strip` sentinel (actively remove reasoning for `deepseek-r1`/`deepseek-reasoner`), multibyte-safe SSE decoding (StringDecoder), response hop-by-hop header stripping, oversized-reasoning skip-not-truncate, MiniMax replay shape behind `MINIMAX_REASONING_DETAILS_SHAPE` (default `minimal`), a real-core test suite (95 assertions), glm-5.2 go-mode `reasoning_content` key (F11, live-verified), derived session keys (Option C), and `x-session-id` no longer forwarded upstream. See the changelog.
- **v3.1.4:** proxy-owned structured JSONL logging with session identifiers truncated in logs.
- **v3.1.3:** Anthropic-wire dialect detection for OpenCode Go routes.
- **v3.1.2:** bounded cache/session memory, raw-stream preservation, hop-by-hop header removal, and safer parser failure handling.
- **v3.1.1:** corrected MiMo routing, non-streaming reasoning caching, and fixed partial-turn patching.
- **v3.1:** provider-aware reasoning fields, including the DeepSeek R1 no-echo route and safe passthrough for unknown models.

---

## Tested on

| Platform | Plugin | Proxy | Watchdog | Systemd |
|----------|--------|-------|----------|---------|
| **Linux** (Kubuntu 24.04) | ✅ | ✅ | ✅ (bash) | ✅ |
| **macOS** | ✅ | ✅ | ✅ (bash) | ❌ (use launchd) |
| **Windows** | ✅ | ✅ | ❌ (bash) | ❌ |

OpenCode v1.17.9+, DeepSeek V4 Pro, Kimi K2.5/K2.6/K2.7, GLM-5.x, MiMo V2.5, MiniMax-M3, OpenCode Go.

### Windows notes

**Plugin and proxy work fully on Windows.** The proxy (`proxy.js`) uses one runtime dependency (`eventsource-parser`) plus Node.js built-in modules (`http`, `https`, `url`). No platform-specific code. Start it with:

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
