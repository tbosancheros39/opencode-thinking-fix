# Changelog

All notable changes to `opencode-thinking-fix`.

## [3.2.0] - 2026-08-19

### Added
- **R1 `strip` sentinel**: `deepseek-r1` / `deepseek-reasoner` now use `reasoningKey: 'strip'` — the request is admitted to `patchRequestBody` to actively *remove* reasoning fields (they 400 when reasoning is echoed back), but excluded from response-side caching. All other `null` routes stay `null` (never fabricate, never strip). Unknown models default to `null` unchanged.
- **L7 ship-gate script** (`tests/live-minimax-replay.mjs`) validates the production MiniMax path — bare model id `minimax-m3` → port 3458 (Anthropic `/v1/messages` wire, `reasoningKey: 'anthropic'`). Mock-upstream mode verifies the proxy unshifts the cached turn-1 `thinking` block into the tool-call turn's `content[]`; `L7_LIVE=1` exercises the live endpoint.
- **F11 per-model reasoning key (glm-5.2)**: the OpenCode Go gateway rejects the `reasoning` field on glm-5.2 `/v1/chat/completions` echo (400 "Extra inputs are not permitted") but accepts `reasoning_content`. `fixedUpstreamRoute` now maps `opencode-go/glm-5.2` on chat/completions to `reasoningKey: 'reasoning_content'`; live-verified two-turn through the deployed proxy (turn-2 HTTP 200, `patched fields:["reasoning_content"] source:"hit"`). Pin tests G13/G14 added (glm-5.2 → `reasoning_content`; glm-5.1/5.3 → `reasoning` unchanged). Scope note: only glm-5.2 was live-validated; other Go models were not changed by F11 and retain the existing `reasoning` behavior — the F11 comment was scoped/softened rather than claiming exhaustive model validation. The `fixedUpstreamRoute` prefix regex intentionally accepts `opencode-go-messages/` and `opencode-go-responses/` provider names (three-wire split future-proofing; see `docs/adr-0002-deferred-wire-split.md`).
- `MINIMAX_REASONING_DETAILS_SHAPE` env (default `minimal`). Note: the `reasoning_details` handler is **unused in the opencode-go deployment** (MiniMax always routes as `anthropic`); it is retained defensively for port-3457 universal mode / provider-native MiniMax.
- **Option C — derived session keys**: when `x-session-id` is absent, the proxy derives a session key as `derived:` + `sha256(authHeader + '||' + modelName + '||' + firstUserMessageText)` truncated to 32 hex characters; the `x-session-id` header wins when present. The key is fixed at the first user message, so cross-talk is bounded to sessions sharing auth + model + first prompt, and replayed text remains valid model reasoning (quality-level impact, never a 400).

### Changed
- **MiniMax replay shape (F6)**: replayed `reasoning_details` entries are now `{ type: 'reasoning.text', text }` by default (or `{ type: 'reasoning.text', format: 'openai-responses-v1', index, text }` when `MINIMAX_REASONING_DETAILS_SHAPE=full`). Previously `{ text, type: 'thinking' }`. Ships as `minimal` pending live confirmation — no MiniMax API key was available in the build environment.
- **Skip-not-truncate (F4)**: `BoundedSessionMap.set` drops oversized reasoning values instead of truncating them, and now returns a boolean (true = stored). Call sites use the return value to gate the `stats.stored` increment.
- Public copy rebranded to reasoning-preservation framing: description, tagline, and agent docs no longer lead with the historical 400-error symptom (retained only as a deprecated note in README).

### Fixed
- **StringDecoder (F1)**: SSE chunks are decoded through `node:string_decoder` so a multibyte UTF-8 character split across two chunks is no longer corrupted.
- **Response hop-by-hop header strip (F2)**: `transfer-encoding`/`connection`/etc. are removed from upstream response headers before `writeHead`, covering all three response paths.
- **`x-session-id` hop-by-hop (F3)**: the local session header is no longer forwarded upstream.
- **Redacted-thinking guard (F7)**: `extractReasoningFromJson` explicitly excludes `redacted_thinking` blocks (belt-and-suspenders on top of the `type === 'thinking'` equality).
- **Mode-gated body tweaks (F9/F10)**: Kimi sampling-param stripping and MiniMax `reasoning_split` injection now run only in model-routing mode (`!UPSTREAM_URL`), not in OpenCode Go fixed-upstream mode.
- **Test suite imports real core.js (D5)**: `tests/test-proxy.js` now exercises production `proxy/core.js` directly (95 assertions) instead of an extracted copy.

## [3.1.4] - 2026-08-18

### Changed
- **Proxy-owned structured JSONL logging**: the proxy writes its own `writeLog` JSONL stream (ungated) with session identifiers truncated in logs; DEBUG-gated console output goes to journald.

## [3.1.3] - 2026-08-18

### Added
- **Anthropic-wire dialect detection for OpenCode Go routes**: `/v1/messages` + MiniMax/Qwen resolve to `reasoningKey: 'anthropic'`; cached thinking is replayed by unshifting a `{ type: 'thinking', thinking }` block into the assistant turn's `content[]`.

## [3.1.2] - 2026-08-18

### Changed
- **Bounded cache/session memory**: per-session turn caps and LRU session eviction bound memory growth.
- **Raw-stream preservation**: SSE responses forward raw bytes; the parser is a side channel and never re-serializes.
- **Hop-by-hop header removal**: `transfer-encoding`/`connection`/etc. stripped from forwarded responses.
- **Safer parser failure handling**: malformed SSE chunks are ignored without killing the stream.

## [3.1.1] - 2026-08-17

### Fixed
- **Corrected MiMo routing**: `mimo` routes to `api.xiaomimimo.com/v1` (not MiniMax).
- **Non-streaming reasoning caching**: buffered JSON responses are parsed for reasoning and cached too.
- **Fixed partial-turn patching**: reasoning is flushed only on `finish_reason`/`message_stop`, never on content arrival.

## [3.1.0] - 2026-08-17

### Added
- **v3 proxy rewrite**: raw-byte SSE forwarding (parsed only to cache, never re-serialized), lazy patching (untouched body when reasoning already present), correct per-turn note placement, keep-alive connections + upstream timeout.
- **Dialect-aware patching**: each route declares a `reasoningKey` (`reasoning_content`, `reasoning_details`, `reasoning`, or `null`); only the field the upstream expects is echoed, ending cross-provider poisoning.
- **R1 no-echo route**: `deepseek-reasoner` (R1) must not receive reasoning echoed back; routes with `reasoningKey: null`.
- **Safe passthrough for unknown models**: unknown providers and echo-rejecting models (Qwen, GPT, Claude, Gemini, Llama, Mistral) default to `reasoningKey: null` — never fabricate reasoning.

## [2.0.0] - 2026-06-24

### Changed (breaking)
- **Proxy memory leak fixed**: replaced unbounded `Map` with `LRUCache(500)`, O(1) eviction, zero timer overhead.
- **SIGTERM/SIGINT cleanup**: `process.on` handlers drain active sessions and close the HTTP server cleanly. 5-second force-exit safety net.
- **SSE parser replaced**: hand-rolled state machine → `eventsource-parser` (368k dependents). Built-in `maxBufferSize: 1MB` guard.
- **Plugin `export default` removed**: named export `{ ThinkingFixPlugin }` only. Bare default caused TUI double-load at 71ms+73ms.
- **`engines` field added**: `node >=18` required (node:http, structuredClone).
- **`oc-plugin: ["server"]` field added**: explicit server-only target for OpenCode 1.3.x loader.

### Added
- `eventsource-parser` runtime dependency.
- Provider docs evidence: all 5 providers (DeepSeek, Z.AI, Kimi, MiniMax, Xiaomi MiMo) officially confirm the `reasoning_content` bug in their published documentation.

### Removed
- `export default` bare export from plugin.
- Hand-rolled SSE parser (~100 lines replaced by 18-line `eventsource-parser` integration).

### Fixed
- Plugin 175→92 lines (-47%). Proxy 409→422 lines (net: +13, but SSE parser is now battle-tested and memory-safe).

## [1.1.9] - 2026-06-23

### Added
- **File-based logging**: JSON-lines log at `~/.local/share/opencode/thinking-fix.log`, captures `plugin_loaded`, `inspect`, `patched`, and `error` events with timestamps.
- **`inspect` event**: logs field coverage on every request, `isReasoningModel`, `assistantTurns`, `missingContent`, `missingReasoningContent`, `missingReasoning`, proving plugin activity even when zero patches needed.
- **Console fallback**: `writeLog` catches file write failures and emits `console.error` so failures are visible somewhere.

### Changed
- `client.app.log()` calls now use `await` for proper async handling.
- Removal of `hook_fired` debug artifact, replaced by structured `inspect` event.

### Fixed
- **TUI install flow**: Ctrl+P "install plugin" → type `opencode-thinking-fix` no longer errors. Server-only plugin with bare `export default` properly installs via TUI and CLI without TUI target warnings.

## [1.1.8] - 2026-06-23

### Fixed
- **package.json aligned with project Documents**: description shortened, `homepage` added, `peerDependenciesMeta.optional` set to `false`, `repository.url` normalized, keywords added (`mimo`, `minimax`), duplicate keywords removed.
- **Stale `node_modules/` deleted** from repo (was committed accidentally).
- **Stale npm cache entry** (`npm i opencode-thinking-fix`) removed from `~/.cache/opencode/packages/`.

## [1.1.7] - 2026-06-23

### Fixed
- **TUI plugin loading error**: removed broken `opencode-thinking-fix-tui.ts`. OpenCode tried to load it as a TUI plugin at startup and failed because it didn't export `{ tui() }`. Package is now server-only.
- **Plugin default export**: switched from v1 format (`{ server: Plugin }`) to v0 legacy format (bare `export default Plugin`), matching the proven opencode-wakatime pattern.
- **package.json**: removed `oc-plugin` field, removed `dependencies`, moved `@opencode-ai/plugin` to `peerDependencies` (type-only import, no runtime dep needed), whitelisted individual files instead of entire directories.

## [1.1.6] - 2026-06-23

### Fixed
- Exposed a no-op TUI plugin target so installation via `Ctrl+P` / `opencode plugin opencode-thinking-fix` completes without the "Package has no TUI target" warning.

## [1.1.5] - 2026-06-23

### Fixed
- **MiniMax-M3 JSON parse errors in OpenCode Go mode**: model name was not parsed in fixed-upstream mode, so `reasoning_split: true` was never injected for MiniMax models routed through port 3458. Now model name is parsed regardless of `UPSTREAM_URL`.
- **`<think>` tags leaked into `delta.content`**: added a fallback extractor that strips `<think>...</think>` blocks from content, moves them into the reasoning buffer, and forwards a sanitized SSE chunk.
- **Kimi K2.6/K2.7 parameter rejection**: strip all hardcoded sampling parameters (`temperature`, `top_p`, `top_k`, `presence_penalty`, `frequency_penalty`, `n`, and `thinking`/`reasoning_effort` for K2.7) before sending to Moonshot.

### Changed
- SSE stream parser now re-serializes and forwards modified chunks instead of forwarding the raw upstream bytes unchanged.

## [1.1.4] - 2026-06-23

### Fixed
- Strip all Moonshot-hardcoded sampling parameters for Kimi K2.6/K2.7 thinking mode, not just `top_p`/`top_k`.

## [1.1.3] - 2026-06-23

### Fixed
- Strip `top_p` and `top_k` from request body for Kimi/Moonshot models.

## [1.1.2] - 2026-06-23

### Fixed
- Interleaved thinking support: reasoning can now appear after content in the same streaming turn (GLM-5+, MiniMax-M3). Removed premature flush on content appearance.
- Inject `reasoning_split: true` for MiniMax models to keep reasoning out of `content`.

## [1.1.1] - 2026-06-23

### Fixed
- Parse MiniMax-M3 `reasoning_details[]` array format and replay it on subsequent turns.

## [1.1.0] - 2026-06-23

### Fixed
- Restored OpenCode 1.3.x plugin loader compatibility by exporting `{ server: ThinkingFixPlugin }` and adding `oc-plugin: ["server"]`.

## [1.0.1] - 2026-06-22

### Added
- MIT LICENSE.
- `files` whitelist in `package.json`.

## [1.0.0] - 2026-06-22

### Added
- Initial release: plugin + proxy + watchdog.
- Support for DeepSeek, Kimi, GLM, and MiMo `reasoning_content` replay.
- Two-proxy architecture (direct providers on port 3457, OpenCode Go on port 3458).
