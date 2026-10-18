# Changelog

All notable changes to `opencode-thinking-fix`.

## 4.0.2 - 2026-10-18

- **Node 24 is the supported runtime.** `engines.node` is now `>=24` (was `>=18`) and `@types/node` moved from `^18` to `^24`, so the published package advertises the runtime it is actually built and tested against instead of one three majors behind.
- **New Zen free-tier routes** in `proxy/core.js`: `step-5-preview-free`, `muse-spark-1.3-contributor-free`, `beam-free`, `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, `longcat-2.5-preview-free`, `mimo-v2.6-flash-free`, `nemotron-3.5-super-vl-free` and `space-bunny-free`, plus their `opencode/`-prefixed twins — all on the `zen/v1` lane with `reasoning_content` as the passback key.
- **The watchdog drives systemd instead of spawning processes.** `watchdog/watchdog.sh` health-checks ports 3457/3458/3459/3462 and restarts the unit that owns the port, rather than `nohup node`-ing a second copy on top of a running service.
- `proxy/proxy.cjs` — the CommonJS shim the installed systemd units execute — is now tracked in the repository.

## 4.0.1 - 2026-10-18

- **CI: the deprecated-action warning is gone.** `actions/checkout` and `actions/setup-node` moved from `@v4` — published against the Node 20 actions runtime, which GitHub-hosted runners now force onto Node 24 and warn about on every step — to `@v7`. The build and test jobs now run on Node 24 rather than 22, and all three jobs use the `npm` cache.
- **Publishing is idempotent.** A re-run of a tag, or a version already pushed by hand, made `npm publish` fail with `E403 You cannot publish over the previously published versions` — which is exactly how the `v4.0.0` tag run went red while 4.0.0 was already on the registry. Both publish jobs now check `npm view <name>@<version>` first and exit successfully when the version is already out, so a re-run reports the truth instead of a false failure.
- **Preflight failures name the real problem.** npm answers a missing or read-only token with a bare `404 Not Found - PUT`, which reads like a missing package. The npm job now checks that `NPM_TOKEN` is non-empty, that `npm whoami` authenticates, and that the tag matches `package.json`'s version before it publishes.
- After publishing, the npm job downloads the tarball the registry actually serves and asserts `proxy/core.js`, the plugin entrypoint and `package.json` are inside it.
- Workflow-level `permissions: contents: read`, `concurrency` (publishing is never cancelled half-way), pinned `ubuntu-24.04` runners and `workflow_dispatch` for re-publishing without a new commit.

## 4.0.0 - 2026-10-17

- **OpenCode V2 plugin API.** The package now depends on `@opencode/plugin` and default-exports `Plugin.define({ id: "opencode-thinking-fix", setup })`, so it can be installed from the V2 catalog. The V1 implementation is kept on the same default export as `server()` (OpenCode >= 1.18.29), and `ThinkingFixPlugin` remains a named export.
- V2 hooks: `ctx.session.hook("model.request")` adds `x-session-id`; `ctx.session.hook("context")` injects the reasoning passback field on assistant turns via `native.openaiCompatible.reasoning_content`. V2's OpenAI Chat protocol maps that carrier to the model's configured reasoning field (`reasoning_content` or `reasoning`), and already emits an empty field natively for DeepSeek-required models.
- `@opencode-ai/plugin` is no longer a peer dependency; the V1 hook shapes are typed locally so the package has no V1 runtime import.
- Version is a major bump because the entrypoint shape changed. OpenCode 1.x users below 1.18.29 should stay on 3.x.

## 3.4.1 - 2026-09-03 (unreleased)

- **F19 — InclusionAI Ling 3.0 Flash route.** Three new entries in the port 3457 model-routing table: `inclusionai/ling-3.0-flash` and `inclusionai/ling-3.0-flash:free` (paid and free tiers on OpenRouter, with `reasoning_content` as the passback key — OpenRouter normalizes to `delta.reasoning` + `delta.reasoning_details` on the way out), and the prefixed form `opencode/ling-3.0-flash-fin-free` (which was previously falling through to the DeepSeek default route; now it goes to the OpenCode Zen free-tier lane at `zen/v1` like its bare-id twin). Ling 3.0 Flash is a 124B/5.1B-active MoE reasoning model (262K context, hybrid thinking by default) from InclusionAI / BAAI; primary distribution is OpenRouter (Novita + DeepInfra upstreams), with the OpenCode Zen free tier as a no-key alternative. Live-verified with a two-turn reasoning-continuity test: turn 1 emitted 271 chars of reasoning on a 7×6 step-by-step, turn 2 (with the cached `reasoning_content` echoed back) referenced the prior step ("The user previously asked for 7 times 6, and I was in the process of showing step-by-step work. The result of 7 × 6 is 42.") and continued to 42+5=47. No code change to the proxy logic itself — only the route table. Sources: `https://openrouter.ai/inclusionai/ling-3.0-flash` (model page), `https://ant-ling.com/en/docs/api-reference/openai/` (native ant-ling OpenAI-compatible API), `https://huggingface.co/inclusionAI/Ling-3.0-flash` (model card + `ling3` reasoning parser default), `https://github.com/inclusionAI` (org page), and `https://arxiv.org/abs/2606.15079` (Ling/Ring 2.6 technical report, agentic reasoning effort levels).

## 3.4.0 - 2026-09-01

- **F12 — Z.ai Preserved Thinking.** The proxy now injects `thinking.clear_thinking: false` on every Z.ai-reachable lane when the model starts with `glm` or `zhipu`. The Z.ai standard Chat Completions endpoint defaults `clear_thinking: true` and silently strips prior `reasoning_content` from context, which is why GLM sessions were looping with the proxy fully active. The injection is host-allowlisted (BigModel direct, OpenCode Go gateway, OpenRouter) and idempotently merged with any client-supplied `thinking` so client choices are preserved. Live-verified against the deployed `core.js` on all three lanes. Docs: `docs.z.ai/guides/capabilities/thinking-mode` (Preserved Thinking) and `docs.z.ai/api-reference/llm/chat-completion` (`thinking.clear_thinking`, default `true`).

## 3.3.4 - 2026-08-30

- README evidence section reframed: the "See it happen in 5 minutes" anchor on a single free-tier model id is gone, replaced with a generic 4-step reproduction and a dataset-first section that leads with the 2.29M char / 1,968 drops / 22-OpenRouter-drops / 68% zero-model-change numbers. "The evidence" section kept for the SDK-is-innocent and switches.csv pointers so nothing is lost.

## 3.3.3 - 2026-08-30

- README reframed the plugin's role honestly: the hard 400 is mostly resolved on modern gateways but still happens once in a while (native DeepSeek tool-call turns, present-required models like Kimi K2.7 Code, proxy downtime), so the plugin stays as cheap insurance while the proxy remains the actual fix. Also documents that native DeepSeek treats present-but-empty as missing on tool-call turns.

## 3.3.2 - 2026-08-30

- Package metadata and README updated for existing users: OpenRouter is now listed in the description and keywords, and the README carries an update note telling pre-3.3 installs to update for OpenRouter and OpenCode Zen free-tier coverage.

## 3.3.1 - 2026-08-30

- Model names corrected to the current DeepSeek catalog: `deepseek-v4-flash`, `deepseek-v4-pro`, and the experimental `deepseek-v4-flash-vision-exp` are the active ids. `deepseek-chat` / `deepseek-reasoner` are marked as aliases DeepSeek retired on 2026-07-24, and the `strip` route is reframed as a compatibility guard rather than the current contract. Docs-only change; routing behavior is unchanged.

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
