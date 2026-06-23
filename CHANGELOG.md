# Changelog

All notable changes to `opencode-thinking-fix`.

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
