# Changelog

All notable changes to `opencode-thinking-fix`.

## 3.3.0 - 2026-08-30

- OpenRouter support: a third fixed-upstream proxy (port 3462, `openrouter.ai/api/v1`) caches and replays reasoning for models served through OpenRouter. The passive-tap corpus shows the same drop there (22 confirmed, session-identity verified).
- Path fix for clients that send OpenRouter's full official prefix (`/api/v1/...`) instead of `/v1/...`; the proxy no longer doubles the prefix, with dedicated tests.
- The OpenCode Zen free-tier lane is routed explicitly: bare ids and `opencode/*` ids alike resolve to `zen/v1` with the `reasoning_content` carrier instead of falling through to the DeepSeek default.
- `REASONING_KEY` environment override: fixed-upstream lanes can declare the reasoning field their upstream expects (zen/v1 and OpenRouter use `reasoning_content`).
- The README now leads with the evidence: 1,968 captured drops, 2.29M erased characters, 68% of them with zero model change, plus a 5-minute repro and a skeptic's checklist.
- Test suite grows to 127 assertions, covering the new routes and path handling.

## 3.2.0 - 2026-08-19

- DeepSeek R1 (`deepseek-reasoner`) now strips reasoning fields instead of echoing them. R1 rejects echoed reasoning with a 400; every other route is unchanged, and unknown models still default to passthrough.
- OpenCode Go: glm-5.2 on `/v1/chat/completions` now replays `reasoning_content`. The gateway rejects the `reasoning` field on that model; live-verified across two turns.
- Session keys are derived from the request when the client sends no `x-session-id` (auth header + model + first user prompt, hashed). Cross-talk stays bounded, and replayed text is always valid reasoning for that model.
- Cache bounds: oversized reasoning values are skipped rather than truncated; sessions and turns are capped.
- SSE chunks decode through `node:string_decoder`, so a multibyte character split across two chunks survives.
- Hop-by-hop headers are stripped on responses, and `x-session-id` no longer leaks upstream.
- Test suite runs against the real `proxy/core.js` (95 assertions).

## 3.1.x - 2026-08-17/18

- v3 proxy rewrite: raw-byte streaming (responses forwarded as-is, the stream parsed only to cache reasoning), lazy patching (untouched body when reasoning is already present), and per-turn note placement so turn 3+ replays its own thinking, not turn 1's.
- Dialect-aware patching: each route declares which field to echo (`reasoning_content`, `reasoning_details`, `reasoning`, or nothing). Echoing everything poisoned cross-provider replays.
- Anthropic-wire support for OpenCode Go: MiniMax and Qwen on `/v1/messages` replay thinking blocks.
- MiMo routes to `api.xiaomimimo.com/v1`; buffered responses are cached too; reasoning flushes only on turn end, never mid-stream.

## 2.0.0 - 2026-06-24 (breaking)

- Replaced the unbounded session map with an LRU cache (500 sessions). The old one leaked memory.
- SSE parsing now uses `eventsource-parser` instead of a hand-rolled state machine.
- Plugin installs cleanly through the TUI; the bare `export default` was removed after it caused a double-load.
- Node >= 18 required.

## 1.0.0 - 2026-06-22

- Initial release: plugin, proxy, and watchdog for DeepSeek, Kimi, GLM, and MiMo reasoning replay. Two-proxy architecture: direct providers on port 3457, OpenCode Go on port 3458.
