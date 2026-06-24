# Changelog

All notable changes to `opencode-thinking-fix`.

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
