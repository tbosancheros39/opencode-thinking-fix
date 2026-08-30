# opencode-thinking-fix

[![npm version](https://img.shields.io/npm/v/opencode-thinking-fix)](https://www.npmjs.com/package/opencode-thinking-fix)
[![Test](https://github.com/tbosancheros39/opencode-thinking-fix/actions/workflows/test.yml/badge.svg)](https://github.com/tbosancheros39/opencode-thinking-fix/actions/workflows/test.yml)
[![npm downloads](https://img.shields.io/npm/dm/opencode-thinking-fix)](https://www.npmjs.com/package/opencode-thinking-fix)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/tbosancheros39/opencode-thinking-fix/blob/master/LICENSE.md)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

```bash
npm install opencode-thinking-fix
```

> Restores reasoning content that clients and SDKs drop from multi-turn conversations — DeepSeek, Kimi, GLM, MiMo, MiniMax, OpenCode Go, and OpenRouter.
>
> **Zero config.** Install via `Ctrl+P`, restart OpenCode, done. The plugin detects reasoning models and only patches when needed.
>
> Docs: [OpenCode Plugins](https://opencode.ai/docs/plugins)

## The problem

When DeepSeek or Kimi answers you, it scribbles notes first. "Let me think... the user wants a login page... I should use React Hook Form... check the API docs..." These notes are `reasoning_content`. You never see them. But the AI needs them — the provider docs require the notes to be sent back on every later turn.

The client and its SDK throw the notebook away. Next turn, the AI reaches for it, but the request already went out without it. The AI doesn't crash. It just forgot everything it was thinking. That is why your AI seems dumber on turn 2. It's not dumber. It lost its notes.

The drop happens in SDK serializers and client transforms (truthy checks, missing type members, stripped signatures), not in the providers. The providers do exactly what their docs say.

**Without the fix:** "Build me a login page." → AI builds it. "Now add password reset." → notes gone, the answer comes back generic.

**With the fix:** "Now add password reset." → AI reads its notes: "I used React Hook Form for login, I'll extend that." → works.

## See it happen in 5 minutes

You need OpenCode and any reasoning model. No proxy, no plugin — this reproduces the drop on a stock install.

1. Start a session with a reasoning model (free tier works, e.g. `opencode/hy3-free`) and give it a real task. It thinks, answers, and emits `reasoning_content`.
2. Ask a follow-up that depends on the first answer, then capture the outgoing request. Every `reasoning_content` field from turn 1 arrives empty or missing.
3. The same request through the SDK alone keeps the field. The client is the difference.

Captured evidence for exactly this sequence: [`proof/free-models/`](proof/free-models/). The A/B controls that isolate the field as the only variable: [`proof/curl-control-results.txt`](proof/curl-control-results.txt).

## Why you've probably never seen it

This bug is conditional, and the conditions are "you work the tool hard":

- **Short sessions never hit it.** The drop happens on turn 2+, worst after tool calls. A two-message chat looks fine.
- **Most gateways don't enforce the contract.** On the free `opencode/zen` tier and OpenRouter, a missing field is accepted, so nothing errors. The model just quietly loses context. No 400, no warning, only worse answers.
- **Non-reasoning models are unaffected.** GPT, Claude, Qwen, Gemini never emit the field.

If you run long sessions, heavy tool calls, model switching, or subagents, you have probably been hit and blamed the model. That is who this fix is for. If you send three messages a day, you may genuinely never notice — and the plugin detects that and does nothing.

## The evidence

We ran four passive taps (DeepSeek, OpenCode Go, OpenCode Zen, OpenRouter) that forwarded traffic byte-for-byte untouched and logged only metadata. They ran for a week of real work, then were retired. Methodology and raw data: [`proof/` directory](proof/).

- **1,968 drops captured** — a turn that carried reasoning earlier in the same session arrives at the API without it.
- **2.29 million characters** of reasoning erased over a week of real traffic.
- **68% of drops happened with zero model change** — same model, same session. Not a model-switch artifact.
- **OpenRouter drops it too** — 22 drops with confirmed session identity on models served through openrouter.ai, plus the same pattern on DeepSeek and OpenCode Go lanes.
- **The SDK is innocent.** `@ai-sdk/openai-compatible` round-trips the field correctly; the drop happens in the client's own transform. Captured side by side in [`proof/free-models/`](proof/free-models/).

Every number is recomputable from [`proof/reasoning-drop/drops.csv`](proof/reasoning-drop/drops.csv) and [`proof/reasoning-drop/switches.csv`](proof/reasoning-drop/switches.csv).

## For the skeptics

Three objections come up every time this is posted. Fair questions, with the evidence:

**"Works on my side."** Probably true. The drop is silent on most gateways — no 400, just worse answers, so nothing looks broken unless you compare turn-3 quality with and without. The A/B controls hold everything constant except the field. And the 68% stat rules out model switching as the explanation.

**"Your config is broken."** The configs this was captured on are published, redacted, in [`proof/` directory](proof/). The root cause is in the client's message transform, not config — the SDK control shows the field surviving when only the client is removed from the path.

**"The model cards already say to pass reasoning back."** They do. That is the point. The provider requires the field; the client drops it. The model card is the spec this repo implements.

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

Bottom line: the proxy is what makes the AI actually remember its thinking. The plugin is a seatbelt for the rare hard 400 that still slips through. The watchdog keeps the lights on.

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
- **Legacy DeepSeek aliases vs V4.** DeepSeek retired the `deepseek-chat` / `deepseek-reasoner` aliases on 2026-07-24; the current catalog is `deepseek-v4-flash`, `deepseek-v4-pro`, and the experimental `deepseek-v4-flash-vision-exp`. While the R1 alias was live it had the inverted contract (echoed reasoning → 400), which is why the proxy carries a `strip` route: it actively removes reasoning fields before forwarding, kept today only as a compatibility guard for clients that still send the old name. V4 thinking mode uses the normal passback contract instead.
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

### Already installed? Update

Versions before 3.3 do not cover OpenRouter or the OpenCode Zen free-tier lane. Update inside OpenCode (`Ctrl+P` → install plugin → `opencode-thinking-fix`) or with `opencode plugin opencode-thinking-fix`, then restart. The plugin self-detects reasoning models, so updating is safe on non-reasoning setups too.

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
opencode plugin opencode-thinking-fix@3.3.0
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

- [The problem](#the-problem)
- [See it happen in 5 minutes](#see-it-happen-in-5-minutes)
- [Why you've probably never seen it](#why-youve-probably-never-seen-it)
- [The evidence](#the-evidence)
- [For the skeptics](#for-the-skeptics)
- [Option 1: Plugin (partial safety net)](#option-1-plugin-partial-safety-net)
- [Option 2: Proxy (replays real reasoning)](#option-2-proxy-replays-real-reasoning)
- [Option 3: Watchdog (auto-recovery)](#option-3-watchdog-auto-recovery)
- [How they work together](#how-they-work-together)
- [Affected models](#affected-models)
- [Model routing](#model-routing-proxy-port-3457)
- [Is it working?](#is-it-working)
- [This bug is everywhere](#this-bug-is-everywhere)
- [Files in this repo](#files-in-this-repo)

---

## What problem this fixes

You ask DeepSeek a question. It picks a tool, calls it, works fine. Then you ask a follow-up — and the AI has lost the reasoning it produced on every earlier turn.

The client/SDK dropped the field before it reached the API — the providers are doing exactly what their docs say. The drop happens in SDK serializers and client transforms.

> **Deprecated:** the historical symptom of this drop — `HTTP 400: The reasoning_content in the thinking mode must be passed back to the API` — is **resolved** by this fix. This repo is about the drop itself, not the error it used to cause.

DeepSeek V4 (and Kimi K2.7, GLM 5.x, MiMo V2.5) require that `reasoning_content` from every prior assistant turn gets included in subsequent API requests. The [docs](https://api-docs.deepseek.com/guides/thinking_mode) describe the contract, and the strictness varies by provider and endpoint: some reject the request, some ignore the field, and the conversation still loses its context either way. All five providers confirm the passback requirement in their official documentation:

- **DeepSeek**: "[The reasoning_content will be ignored by the API](https://api-docs.deepseek.com/guides/thinking_mode)", but the conversation history must contain the field.
- **Z.AI / GLM**: "[Key: return reasoning_content to keep the reasoning coherent](https://docs.z.ai/en/api/thinking)."
- **Kimi / Moonshot**: "[You must keep the reasoning_content in the multi-round conversation... otherwise an error will be thrown](https://platform.moonshot.ai/docs/guide/thinking-mode)."
- **MiniMax**: "[The complete model response must be append to the conversation history](https://platform.minimaxi.com/document/ChatCompletion%20v2)."
- **Xiaomi MiMo**: "[Any assistant message with tool calls... must preserve its full reasoning_content field, otherwise the API will return a 400 error](https://dev.mi.com/doc/llm-api). Affected frameworks include TRAE, Cursor, Roo Code, Codex, GitHub Copilot CLI, Zed, AutoGen."

The field is non-standard per OpenAI, so SDKs and clients ignore it — the drop is
systemic, not a single tool's bug. This repo fixes it. Three layers, pick what you need.

---

## Option 1: plugin (partial safety net)

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

**Why keep it when the 400 is mostly resolved?** The hard 400 no longer fires on most gateways, but it still happens once in a while: on native DeepSeek tool-call turns, on present-required models like Kimi K2.7 Code, and whenever the proxy is down mid-session. Keeping the field present costs nothing and removes that failure class entirely, so it stays as insurance rather than the main fix.

**The catch:** the plugin fills in empty strings, not your model's actual prior thinking. DeepSeek, Kimi K2.5/K2.6, GLM, and MiMo accept empty strings fine, your conversation works but the model does not see its earlier reasoning. Kimi K2.7 Code requires the field to be present; present-but-empty is accepted. On native DeepSeek tool-call turns even a present-but-empty field is treated as missing, so the proxy's real cached text is what satisfies that contract.

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

The plugin is partial insurance. The hard 400 is mostly gone from modern gateways, but it still fires once in a while — native DeepSeek tool-call turns, present-required models, or a proxy that is down mid-session. When that happens the plugin keeps the field present so the request survives; on empty-tolerant gateways the empty string is accepted, and on stricter ones the proxy's real cached text takes over because the plugin sees the field is already filled in. The proxy is the actual fix. The plugin is the seatbelt you hope never to need.

---

## Affected models

| Model | Plugin helps | Proxy helps | What it needs |
|---|---|---|---|
| DeepSeek V4 Pro / Flash | Yes | Nice to have | Accepts `""` (tool-call turns need real text) |
| DeepSeek V4 Flash Vision (exp) | Yes | Nice to have | Text + image input on a separate model id; same passback contract |
| Kimi K2.5 / K2.6 | Yes | Nice to have | Accepts `""` |
| **Kimi K2.7 Code** | **Not enough alone** | **Required** | Field must be *present*; real text keeps it coherent |
| GLM-5.x / Zhipu | Yes | Nice to have | Accepts `""` |
| MiMo V2.5 | Yes | Nice to have | `reasoning_content` on `api.xiaomimimo.com/v1` |
| **MiniMax-M3** | Yes | **Recommended** | `reasoning_details[]` array; ~40% quality loss if stripped. Proxy injects `reasoning_split:true` to keep thinking separate from content. |
| OpenCode Go | Yes | Recommended for chat/message routes | Chat uses `reasoning`; Anthropic messages are handled; unsupported response formats pass through |
| OpenRouter (reasoning models via openrouter.ai) | Yes | Recommended | Field depends on the upstream model; the fixed-upstream proxy replays `reasoning_content` and passes everything else through |
| Qwen, GPT, Claude, Gemini, Llama, Mistral | No | No | No reasoning_content |

---

## Model routing (proxy port 3457)

The proxy auto-routes by model name prefix. All routes:

| Prefix | Upstream | Reasoning |
|---|---|---|
| `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp` | `https://api.deepseek.com` | Yes (`reasoning_content`) |
| `deepseek-chat` | `https://api.deepseek.com` | Non-thinking alias (no reasoning emitted; passback is a harmless no-op) |
| `deepseek-r1`, `deepseek-reasoner` | `https://api.deepseek.com` | Legacy — retired by DeepSeek 2026-07-24; kept as a compatibility guard with active stripping |
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

### OpenRouter (port 3462)

OpenRouter wraps many upstream models, and reasoning models served through it lose their thinking the same way. Run a third fixed-upstream proxy and point your OpenRouter provider at it:

```bash
PORT=3462 UPSTREAM_URL=https://openrouter.ai/api/v1 REASONING_KEY=reasoning_content node proxy/proxy.js
```

```json
{
  "provider": {
    "openrouter": {
      "options": {
        "baseURL": "http://127.0.0.1:3462/v1"
      }
    }
  }
}
```

The passive-tap corpus includes an OpenRouter lane: 22 session-confirmed drops, concentrated on `minimax/minimax-m3:free` within one long session — enough to show the pattern exists on OpenRouter, with the full model-by-model matrix left to a follow-up corpus. See [The evidence](#the-evidence).

---

## Is it working?

The plugin writes a structured JSON log: `~/.local/share/opencode/thinking-fix.log`.

Every request logs an `inspect` event (field coverage, whether the model is a reasoning model, how many turns were patched), so the plugin is auditable even when it patches nothing. Non-reasoning models are skipped by design — zero false patches is a property of the self-detection, not a promise bolted on.

From a real 104-message session:

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
tests/
  test-proxy.js                         # 127 proxy assertions
  test-plugin.js                        # 12 plugin assertions
  live-minimax-replay.mjs               # self-contained replay gate (mock upstream)
proof/                                  # evidence: captures, controls, CSVs, repro scripts
```

## Release highlights

- **v3.2.0:** R1 `strip` sentinel (actively remove reasoning for `deepseek-r1`/`deepseek-reasoner`), multibyte-safe SSE decoding (StringDecoder), response hop-by-hop header stripping, oversized-reasoning skip-not-truncate, MiniMax replay shape behind `MINIMAX_REASONING_DETAILS_SHAPE` (default `minimal`), a real-core test suite (95 assertions), glm-5.2 go-mode `reasoning_content` key (live-verified across two turns), derived session keys, and `x-session-id` no longer forwarded upstream. See the changelog.
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
